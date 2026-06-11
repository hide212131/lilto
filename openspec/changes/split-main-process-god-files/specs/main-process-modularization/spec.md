# main-process-modularization Specification

## Purpose
main プロセスの巨大ファイルをドメイン単位へ分割しつつ、公開 IPC 契約と既存 runtime 挙動を維持し、`index.ts` を配線専用の composition root として保てるようにする。

## ADDED Requirements

### Requirement: IPC ハンドラ登録はドメイン別に分割されなければならない
システムは、main IPC のハンドラ登録をドメイン別モジュールへ分割しつつ、公開チャネル名と payload 契約を既存の `ipc-contract.ts` と characterization test に対して互換なまま維持しなければならない（MUST）。IPC の型契約は複数箇所へ再分散してはならない（MUST NOT）。

#### Scenario: IPC 登録実装を分割しても公開契約は変わらない
- **WHEN** 開発者が `ipc.ts` の登録ロジックを agent、scheduler、settings、skills、audio、session などのドメイン別モジュールへ移す
- **THEN** システムは既存の IPC 契約テストを変更せずに通過でき、`ipc-contract.ts` を唯一の型契約として維持できる

### Requirement: Agent runtime は責務別モジュールへ分離されなければならない
システムは、`agent-sdk.ts` の内部責務を、少なくともプロセスライフサイクル管理、イベントストリーム処理、エラー分類・リトライ判定、実行設定組み立ての単位へ分離できなければならない（MUST）。この分離は既存 call site と runtime テストが前提にする外向き契約を壊してはならない（MUST NOT）。

#### Scenario: Agent runtime の内部構造だけを整理できる
- **WHEN** 開発者が `agent-sdk.ts` を facade と責務別内部モジュールへ分割する
- **THEN** システムは既存の agent runtime テストで公開挙動を維持したまま、内部依存を責務単位で追跡できる

### Requirement: Skill runtime は discovery / execution / policy を独立して扱えなければならない
システムは、`skill-runtime.ts` に含まれるスキル発見、スキル実行、サンドボックスポリシー適用の責務を独立したモジュールとして扱えなければならない（MUST）。上位 runtime はそれらの調停と結果整形に集中し、各責務のポリシーを単独で変更可能にしなければならない（MUST）。

#### Scenario: Skill runtime のポリシー変更点を局所化できる
- **WHEN** 開発者が skill discovery、execution、sandbox policy のいずれかを変更またはテストしたい
- **THEN** システムは `skill-runtime.ts` 全体を横断せずに対象責務のモジュールを単独で追跡できる

### Requirement: 補助サービスは本体と補助ロジックの境界を持たなければならない
システムは、`plugin-service.ts` および `heartbeat-assistant.ts` を、公開サービスの entry point と補助ロジック群へ分けられる構造にしなければならない（MUST）。テストが薄い境界を移動する場合は、移動前に既存挙動を固定する特性テストを追加できなければならない（MUST）。

#### Scenario: サービス本体を保ったまま補助ロジックを切り出せる
- **WHEN** 開発者が plugin service または heartbeat assistant の変換・判定・補助フローを抽出する
- **THEN** システムは公開サービスの entry point を維持したまま、補助ロジックを独立モジュールへ移せる

### Requirement: Main エントリポイントは composition root に限定されなければならない
システムは、`src/main/index.ts` を Electron app lifecycle、サービス生成、依存配線、IPC 登録の composition root として保たなければならない（MUST）。個別ドメインの処理本体や詳細な判断ロジックを `index.ts` に残してはならない（MUST NOT）。

#### Scenario: main エントリポイントから責務境界が読める
- **WHEN** 開発者が `src/main/index.ts` を読んで main プロセスの起動順序を確認する
- **THEN** システムは配線と初期化順序だけを示し、個別ドメインの処理詳細は専用モジュール側で追える