## Why

現状の Electron アプリでは、Main プロセス上の AI エージェント実装と Pi SDK 連携、Claude 利用時の OAuth トークン取得までの導線が未整備である。README に記載した実装方針を実装し、ユーザーが設定で迷わずに LLM 応答を得られる体験を早期に成立させる必要がある。

## What Changes

- Electron Main プロセスで動作するエージェント実装を `pi-coding-agent` SDK ベースに統一する。
- ユーザーの質問を Main プロセスのエージェントへ渡し、Pi SDK 経由で LLM 応答を返す対話フローを追加する。
- LLM 利用時のモデルアクセスを Pi の `ai` パッケージ経由に寄せ、Claude プロバイダの OAuth トークン取得と再利用を組み込む。
- 初回利用時の認証導線を UI に実装し、必要な操作をシームレスに完了できる状態（認証開始、進行状態表示、完了後の対話開始）を提供する。

## Capabilities

### New Capabilities
- `pi-main-agent-runtime`: Electron Main プロセスで `pi-coding-agent` を実行し、ユーザー入力に対して SDK 経由で応答を返す。
- `claude-oauth-chat-bootstrap`: Pi `ai` パッケージによる Claude OAuth 認証を UI から開始・完了し、認証後すぐにチャット可能にする。

### Modified Capabilities
- なし

## Impact

- Affected code:
  - Main プロセスのエージェント起動・メッセージ処理層
  - Renderer と Main 間 IPC（チャット要求、認証要求、進行状態通知）
  - 認証状態を扱う設定/セッション管理層
- Dependencies:
  - Pi モノレポの `packages/coding-agent` と `packages/ai` の参照追加または更新
- Systems:
  - Claude OAuth 認証フロー（ブラウザ遷移/コールバック処理）
  - 認証状態に応じた UI 表示と操作ガード
