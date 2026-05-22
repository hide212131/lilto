## Context

lilto の会話実行は Main 側 `AgentRuntime` が担っていたが、従来は OpenAI Codex TypeScript SDK 直結の thread 実行と renderer の `localStorage` ベース履歴管理が分離していた。そのため、会話の永続 ID、履歴一覧、会話再開、rename/delete、通知復帰が同一の保存系を見ておらず、実装上の責務境界が曖昧だった。

今回の変更では、Codex App Server が提供する `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, `thread/list`, `thread/read`, `thread/name/set`, `thread/archive` を lilto の唯一の会話バックエンドとして扱う。Renderer は会話本文や一覧の永続化責務を持たず、Main が App Server を通じて会話状態を管理する。既存 UI が依存する `AgentLoopEvent` や unread 表示、scheduler follow-up、heartbeat assistant との紐付けは保つ必要がある。

また、移行ポリシーとして既存 `localStorage` 履歴は移行しない。移行後の初回起動で会話履歴が 0 件でも許容し、以降の新規会話から App Server 側永続化へ揃える。

## Goals / Non-Goals

**Goals:**
- Codex App Server を会話実行と履歴永続化の正とし、Main から一貫して扱う。
- Renderer の会話履歴 `localStorage` 依存を撤去し、起動時 hydrate と会話再開を IPC 経由に置き換える。
- 既存の逐次表示、thinking、tool progress、scheduler 通知復帰、rename/archive UI を維持する。
- 再起動後も App Server から会話履歴が再表示されることを前提にした仕様へ揃える。

**Non-Goals:**
- 既存 `localStorage` 履歴の自動移行
- 履歴 UI の全面 redesign や情報設計変更
- App Server に存在しない hard delete の導入
- AgentLoopEvent 契約の全面刷新

## Decisions

### 1. Main が App Server 実行と履歴 CRUD の両方を所有する
Renderer から App Server を直接触らせず、Main に `ConversationHistoryService` と App Server ベース thread wrapper を置く。これにより会話 ID、認証済み実行、エラー標準化、scheduler 紐付けを同じ保存責務で扱える。

代替案:
- Renderer から一覧 API だけ直接叩く: 認証・権限・ID 変換が分散するため不採用。
- 実行だけ App Server、履歴だけ独自保存を継続する: 再起動後再開や rename/archive の整合が崩れるため不採用。

### 2. 既存 `AgentLoopEvent` 契約は保持し、App Server 通知を変換する
UI の進行表示とテスト契約を壊さないため、`item/started`, `item/completed`, `item/agentMessage/delta`, `item/reasoning/summaryTextDelta`, `item/commandExecution/outputDelta`, `turn/completed` などを既存 loop event に変換する。これにより renderer は実行バックエンド変更を意識しない。

代替案:
- Renderer を App Server notification 直読みに合わせて作り直す: 変更範囲が広く、既存契約テストが崩れるため不採用。

### 3. 会話履歴は App Server の永続 thread ID を正とし、初回送信前に会話を確保する
空の新規セッション状態では会話 ID がまだ存在しないため、初回送信前に Main 側で `thread/start` 相当の会話作成を行い、その ID を以後の送信・rename・archive・通知復帰に使う。`freshContext` は「UI 上の新しい会話」を意味するが、送信前に必ず永続会話へ bind する。

代替案:
- 最初の `turn/start` 成功後にだけ会話 ID を採番する: 失敗時や通知復帰で会話 ID を欠落させやすく不採用。

### 4. 既存 localStorage 履歴は無視し、ゼロ件起動を許容する
今回の移行では backfill や一度限りの変換ロジックを持たない。起動直後に App Server 履歴が空でも待機状態を正常表示し、新規作成分のみ App Server 側に蓄積する。

代替案:
- localStorage から App Server へ移行する: 変換失敗時の責務が重く、ユーザー要件でも不要のため不採用。

### 5. 履歴一覧フィルタは実装実態に合わせて `vscode` と `appServer` の両方を許容する
App Server 仕様上は `sourceKinds` フィルタが利用できるが、lilto の隔離された `CODEX_HOME` 配下に保存された thread が実際には `vscode` source として列挙されるケースが確認された。そのため、履歴一覧では `sourceKinds: ["vscode", "appServer"]` を使い、将来 source 分類が安定しても履歴を取りこぼさない設計にする。

代替案:
- `appServer` のみに限定する: 実運用で履歴が 0 件になるため不採用。
- `sourceKinds` を省略する: 他クライアント由来の履歴が混ざる可能性があるため不採用。

### 6. App Server の sandbox enum は current schema に合わせて camelCase を使う
`thread/start.sandbox` と `turn/start.sandboxPolicy.type` は current App Server schema に合わせて `dangerFullAccess` / `workspaceWrite` を使う。live 検証で schema ミスマッチが実際に失敗原因になったため、設計書にも protocol 準拠を明示する。

## Risks / Trade-offs

- [App Server schema 変更] → sandbox enum や source classification が再変更されると live でのみ壊れる可能性がある。focused test に加えて live prompt 送信と再起動復元を検証手順へ残す。
- [履歴 source の解釈差] → `vscode` / `appServer` の扱いが Codex 側で将来変わる可能性がある。履歴一覧フィルタは両対応にし、影響を局所化する。
- [旧 localStorage 履歴の不在] → 移行直後に履歴が空に見える。これは要件通りであり、初回起動時に空でも正常であることを仕様化して吸収する。
- [責務集中による Main 複雑化] → Main 側に runtime と履歴管理が集まる。`ConversationHistoryService` と App Server client を分離し、UI からは IPC 契約だけ見えるようにして複雑化を限定する。

## Migration Plan

1. Main に App Server 実行 wrapper と会話履歴サービスを追加する。
2. `agent:submitPrompt` と新規会話 IPC を App Server ベースへ切り替える。
3. Renderer の会話 hydrate と履歴操作を `window.lilto` の会話 API に置き換える。
4. 既存 `localStorage` 会話データは無視し、新規会話のみ App Server に蓄積する。
5. focused test と live UI 検証で prompt 実行、履歴表示、再起動後再読込を確認する。

Rollback は、Main の App Server wrapper と履歴サービスを外し、旧 SDK 直結 runtime と renderer `localStorage` 経路へ戻すことで行える。ただし、この rollback では App Server 側に新規作成済みの会話履歴を UI に再表示しない可能性がある。

## Open Questions

- なし。実装と live 検証を通じて、履歴 sourceKinds と sandbox enum の実運用上の前提は確定した。