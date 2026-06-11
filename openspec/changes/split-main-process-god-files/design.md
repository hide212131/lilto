## Context

フェーズ 0 で `test:unit`、CI、IPC 契約テストが整い、フェーズ 1 で未使用コードと重複の母数も削減されたが、main プロセスの中心には依然として巨大ファイルが残っている。`ipc.ts` は多数のハンドラを 1 ファイルへ集中させ、`agent-sdk.ts` と `skill-runtime.ts` はライフサイクル管理、イベント処理、設定組み立て、ポリシー適用など複数責務を横断し、`plugin-service.ts` と `heartbeat-assistant.ts` も依存境界が広いまま成長している。

フェーズ 2 の制約は、公開契約を変えずに構造だけを分割することにある。IPC のチャネル名や payload 形状、runtime の既存テストが固定している挙動、起動シーケンスの順序は維持対象であり、main プロセスの合成ルートだけを明瞭にする必要がある。

## Goals / Non-Goals

**Goals:**

- `ipc.ts` をドメイン別モジュールへ分割し、公開 IPC 契約を維持したまま責務境界を明確にする。
- `agent-sdk.ts`、`skill-runtime.ts`、`plugin-service.ts`、`heartbeat-assistant.ts` を、テスト可能で依存方向が分かる単位へ分割する。
- `src/main/index.ts` を composition root として純化し、起動と配線だけが読める状態にする。
- 既存の characterization / runtime テストを安全網として使い、フェーズ 3 以降へ渡せる main プロセス構造を整える。

**Non-Goals:**

- IPC チャネル名、payload 形状、preload が公開する API を変更すること。
- scheduler 既知バグや renderer 側 UI 変更を同時に修正すること。
- strict TypeScript 導入や dependency injection フレームワーク追加のような基盤刷新を行うこと。
- packaged build や native helper の挙動を変更すること。

## Decisions

### 1. IPC は「契約集中、登録分散」の形にする

`ipc-contract.ts` は既存どおり公開契約の中心に残し、ハンドラ登録だけを `src/main/ipc/` 配下のドメイン別モジュールへ分割する。具体的には agent、scheduler、settings、skills、audio、session など、同じ依存を共有する単位で `register*IpcHandlers` を切り出し、上位の `ipc.ts` あるいは同等の集約モジュールはそれらを束ねるだけにする。

代替としてチャネル定義まで各ドメインへ分散する案もあるが、preload と renderer が参照する型契約が再び分散し、フェーズ 3 の型一本化と衝突しやすい。そのため契約は集中、登録実装は分散の形を採る。

### 2. `agent-sdk.ts` は外向き facade を維持しつつ内側の責務を分ける

既存 call site への影響を最小化するため、`agent-sdk.ts` は薄い facade または集約エントリとして残し、その背後でプロセスライフサイクル、イベントストリーム処理、エラー分類・リトライ判定、Codex 実行設定の組み立てを別モジュールへ出す。これにより `test/agent-runtime.test.js` が固定している runtime 契約を変えずに内部依存だけを整理できる。

代替として class や public API 自体を分割し直す案もあるが、フェーズ 2 の目的は挙動保存であり、呼び出し側の差分を増やす価値が低い。

### 3. `skill-runtime.ts` は discovery / execution / policy を独立させる

スキル発見、スキル実行、サンドボックスポリシー適用は変更理由もテスト境界も異なるため、専用モジュールへ分離する。上位 runtime はこれらの調停と結果整形だけを担い、sandbox や skill source 判定のポリシーが単独で追える構成にする。

代替として utility 抽出だけに留める方法もあるが、責務境界が曖昧なままファイルだけ分かれるとフェーズ 4 の横断整理で再度やり直しになる。

### 4. `plugin-service.ts` と `heartbeat-assistant.ts` は「サービス本体」と「補助ロジック」を分ける

これらのファイルは依存先が広く、状態管理、I/O、整形ロジックが混在しやすい。フェーズ 2 では公開サービスの entry point を保ちつつ、永続化や実行 orchestration を行う本体と、変換・判定・補助フローを担う helper 群へ分離する。分割前にテストが薄い箇所は characterization test を追加してから移す。

### 5. `index.ts` は composition root に限定し、動作判断を持たせない

main プロセスのエントリポイントは、Electron app lifecycle、各サービスの生成、依存注入、IPC 登録の配線だけを行い、個別ドメインの条件分岐や処理本体を持たないようにする。起動順序に意味がある箇所は explicit な初期化順序として残し、暗黙の副作用に依存しない形へ寄せる。

## Risks / Trade-offs

- [Risk] モジュール分割で初期化順序や循環参照が崩れる
  Mitigation: facade を先に残し、移動と書き換えを分けて進め、各段階で既存テストを再実行する。
- [Risk] IPC ハンドラの登録場所を変える際に公開契約がずれる
  Mitigation: `ipc-contract.ts` を唯一の型契約として保持し、`test/ipc-characterization.test.js` を変更せずに通すことを前提にする。
- [Risk] service 分割が過剰になり、単にファイル数だけ増える
  Mitigation: 変更理由が異なる責務単位だけを抽出し、facade 配下の補助モジュールに限定する。
- [Risk] テストが薄い箇所の移動で静かな回帰が起きる
  Mitigation: `plugin-service` や `heartbeat-assistant` の薄い境界は、分割前に characterization test を追加してから移す。

## Migration Plan

1. `ipc.ts` の登録責務をドメイン別モジュールへ移し、IPC 契約テストで互換性を確認する。
2. `agent-sdk.ts` と `skill-runtime.ts` を facade + 内部モジュール構成へ分け、既存 runtime テストを維持する。
3. `plugin-service.ts` と `heartbeat-assistant.ts` を本体と補助ロジックへ分け、必要なら特性テストを補強する。
4. 最後に `index.ts` を composition root へ純化し、main プロセスの配線だけが残る状態を確認する。
5. 各段階で `npm test` を通し、必要に応じて IPC 契約テストや対象サービスの narrow test を再実行する。

## Open Questions

- IPC ドメイン分割の最初の切り方を、既存テスト名に合わせるか依存方向に合わせるか。
- `plugin-service.ts` と `heartbeat-assistant.ts` で、先に characterization test を足すべき境界がどこまで必要か。
- facade ファイルを恒久的に薄く残すか、フェーズ完了時に barrel へ置き換えるか。

## Phase 2 Outcome

- `plugin-service.ts` は helper モジュールへ、`heartbeat-assistant.ts` は state / parsing helper モジュールへ責務分離し、公開 entry point は維持した。
- `src/main/index.ts` は Electron lifecycle と service 配線を中心に残し、runtime 初期化の詳細は `main-runtime.ts` へ移した。
- phase 2 の分割では、既存の focused contract/runtime tests で十分に挙動を固定できたため、追加の characterization test は不要だった。
- フル検証として `npm test` を実行し、phase 2 完了時点で既存テストは `193 pass / 0 fail / 1 skip` だった。