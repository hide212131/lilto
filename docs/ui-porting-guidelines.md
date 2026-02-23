# UIポーティング方針（`pi-web-ui-example` 比較）

## 目的
- Electron Renderer の UI 実装で、`pi-web-ui` / `pi-web-ui-example` のどこを流用し、どこを変更・除外するかを明確化する。
- Renderer と Main の責務境界を固定し、実装判断のブレを防ぐ。

## 今回ポーティングするもの
- チャットの基本導線:
  - メッセージ表示と入力送信の体験（`packages/web-ui/src/components/AgentInterface.ts`、`packages/web-ui/src/components/Messages.ts`、`packages/web-ui/src/components/Input.ts` の責務）
- UI状態遷移:
  - 送信中表示、失敗表示、再送可能状態への復帰
- Renderer/Main 分離前提の接続:
  - Renderer は UI 状態管理に集中し、問い合わせ実行は IPC 経由で Main に委譲

## 構成要素の棚卸し（`pi-web-ui-example` ベース）
| 参照元 | Lilt-AIでの扱い | 実装先/備考 |
|---|---|---|
| `packages/web-ui/src/components/AgentInterface.ts` | 一部流用（責務のみ） | Renderer 側で「入力 + メッセージ表示 + 送信状態管理」を実装。Agent 実行自体は流用しない。 |
| `packages/web-ui/src/components/Messages.ts` | 一部流用（表示責務） | `src/renderer/renderer.ts` で user/assistant/error メッセージ描画を実装。 |
| `packages/web-ui/src/components/Input.ts` | 一部流用（入力責務） | `src/renderer/index.html` の入力欄と送信導線に反映。 |
| `packages/web-ui/example/src/main.ts` の session/history/settings | 非流用 | 初期スコープ外。必要なら別 change で導入。 |
| `packages/web-ui/src/dialogs/*` | 非流用 | モデル選択、API key、設定UIは初期スコープ外。 |
| `packages/web-ui/src/tools/*` と `src/components/sandbox/*` | 非流用 | REPL/Artifacts/添付処理は初期スコープ外。 |

## Renderer で禁止する依存と Main 側移管基準
- 禁止依存:
  - `fs` などファイル I/O を伴う Node API
  - Electron Main 専用 API（`BrowserWindow`、`ipcMain` など）
  - Pi 実行本体（`pi-coding-agent` SDK セッション実行）
- 移管基準:
  - 機密情報（トークン/APIキー）にアクセスする処理は Main 側
  - OS 依存機能や外部プロセス制御を伴う処理は Main 側
  - Renderer は UI 状態と入力イベント処理のみを保持し、実行は IPC 越しに依頼する

## 今回ポーティングしないもの（初期スコープ外）
- Renderer 内での `Agent` 直接実行と周辺機能:
  - `@mariozechner/pi-agent-core` の `Agent` を Renderer で保持する構成
  - API キー入力ダイアログ、プロバイダ選択、モデル選択、thinking selector
- セッション管理と設定 UI:
  - IndexedDB ベースのセッション保存、履歴、タイトル編集
  - 設定ダイアログ群（Providers/Models、Proxy、Custom Providers）
- ツール/添付/Artifacts 一式:
  - 添付ファイル処理、Document 抽出、JavaScript REPL、Artifacts パネル
  - サンドボックス Runtime Providers（attachments/artifacts/console/download）

## Main 側へ移すもの（Renderer 非対応依存）
- 認証・トークン管理・機密情報の保持
- ファイル I/O や OS 依存 API を必要とする処理
- Pi SDK 実行とエージェント本体のライフサイクル管理

## 運用ルール
- 方針変更時は、この文書に「ポーティングするもの / しないもの / Main 側移管」の3区分で追記する。
- 実装差分レビュー時は、本ドキュメントの分類に対する逸脱有無を確認する。
