## Context

現状の Lilt-AI は Main 側で Pi SDK を動作させる基盤と最小 UI を備える一方、会話体験としてのチャット UI と、`pi-web-ui` 系からの移植方針が十分に定義されていない。  
本変更では Renderer 側にチャット UI を追加しつつ、Renderer が扱う責務と Main 側へ移す責務を明確化し、`docs/ui-porting-guidelines.md` を実装判断の一次情報にする。

制約:
- Electron Renderer ではファイル I/O を伴う依存を直接実行できない。
- 既存の `agent-bridge` / `pi-main-agent-runtime` の IPC 経路を維持し、CLI 別プロセス実行を増やさない。
- UI は `pi-web-ui` / `pi-web-ui-example` の構成を参照しつつ、Electron 向けに必要最小限の変更に留める。

## Goals / Non-Goals

**Goals:**
- ユーザー入力と応答表示を会話単位で扱うチャット UI を Renderer に実装する。
- 送信中・失敗の状態を UI 上で明示し、再送可能な操作性を確保する。
- `pi-web-ui` 系のどこを流用し、どこを Main 側へポーティングするかを文書化する。
- `docs/ui-porting-guidelines.md` を実装可能な粒度に更新する。

**Non-Goals:**
- 音声入力やウェイクワードなど、README の非対象機能を追加しない。
- Pi SDK のコア挙動や認証方式を再設計しない。
- 大規模なデザイン刷新（テーマ/ブランド再定義）を行わない。

## Decisions

### Decision 1: 会話状態は Renderer で保持し、実行責務は Main に固定する
- 採用: メッセージ配列、入力値、送信中フラグ、エラー表示状態は Renderer で管理し、問い合わせ実行は既存 IPC を通して Main に委譲する。
- 理由: UI 応答性を確保しつつ、危険操作と外部依存を Main に集中できるため。
- 代替案:
  - Main 主導で会話状態まで保持する案は、IPC 往復が増えて UI 実装が複雑化するため不採用。

### Decision 2: `pi-web-ui` の構成概念を流用し、Renderer 非対応部分のみ Main へポーティングする
- 採用: UI のコンポーネント分割・イベントフローは `pi-web-ui-example` に近づける。一方でファイル I/O、OS 依存 API、Node 依存処理は Main 側モジュールへ移して IPC で公開する。
- 理由: 既存知見を活かしつつ、Electron のプロセス境界制約を満たせるため。
- 具体スコープ:
  - ポーティング対象:
    - メッセージ表示/入力送信/送信中・失敗状態の UI 体験（`AgentInterface`/`Messages`/`Input` 相当）
    - Renderer での会話状態管理と IPC 呼び出し連携
  - 非対象（初期スコープ外）:
    - Renderer での `Agent` 実行、API キー管理、モデル/プロバイダ/設定ダイアログ
    - IndexedDB セッション永続化、履歴管理
    - 添付ファイル、REPL、Artifacts、サンドボックス Runtime Providers
  - Main 側移管:
    - 認証・トークン管理、Pi SDK 実行、ファイル I/O を伴う処理
- 代替案:
  - `pi-web-ui` 実装をそのまま Renderer へ持ち込む案は、依存不整合で実行不能リスクが高いため不採用。
  - すべて独自 UI として再実装する案は、学習コストと差分管理コストが高いため不採用。

### Decision 3: 方針の正本は docs に集約する
- 採用: 「流用する構成」「Main へ移す基準」「Renderer で禁止する依存」を `docs/ui-porting-guidelines.md` に明記する。
- 理由: 実装時に最短で参照でき、将来変更時のレビュー基準として使えるため。
- 代替案:
  - README 本文に詳細を直接記載する案は、概要ドキュメント肥大化を招くため不採用。

## Risks / Trade-offs

- [Risk] `pi-web-ui` との差分が拡大し追従しにくくなる  
  → Mitigation: 流用/変更ポイントを `docs/ui-porting-guidelines.md` に明示し、変更時に差分理由を追記する運用にする。
- [Risk] Renderer と Main の責務境界が曖昧なまま機能追加される  
  → Mitigation: `desktop-shell` の requirement を更新し、Renderer 非対応依存の Main 移管を明文化する。
- [Trade-off] Main 側モジュールを増やすことで初期実装量が増える  
  → Mitigation: 今回はチャット UI に必要な最小経路のみを対象にし、拡張は後続 change に分離する。

## Migration Plan

1. Renderer の既存入力/表示を会話 UI コンポーネントへ置き換える。
2. 既存 IPC を利用して送信中/失敗状態を UI 状態遷移へ接続する。
3. Renderer 非対応依存の有無を確認し、必要処理を Main 側モジュールへ移管する。
4. `docs/ui-porting-guidelines.md` を更新し、流用/変更/禁止事項を記載する。
5. GUI 変更として E2E を実行し、完了条件を満たす。

ロールバック方針:
- 問題発生時はチャット UI を旧最小 UI へ戻し、IPC 契約は維持したまま段階的に再適用する。

## Open Questions

- `pi-web-ui-example` のどのコンポーネント粒度まで同構成に寄せるか（最小移植範囲の境界）。
- メッセージ永続化をこの change に含めるか、別 change に分離するか（現時点では分離予定）。
