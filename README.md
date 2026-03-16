# Lilt-o
PC作業を人間の代わりに実行する、軽量なAIアシスタント。

## 機能
- 軽量なAIエージェントとして動作する
- macOSとWindowsの両方で動作する
- デスクトップに常駐する
- ユーザーのテキスト要求を受け取り、ブラウザ操作やファイル作成などのPC操作を実行する
- 一定間隔のハートビートで、事前登録した処理を実行する
- 音声操作への対応を目指す
  - "Hey Siri"、"OK Google"、"Alexa" などのウェイクワードで起動する
  - テキスト入力の代わりに音声入力を受け付ける

## 実装方針
- AIエージェント機能は [OpenAI Codex TypeScript SDK](https://github.com/openai/codex/tree/main/sdk/typescript) を利用する
- アプリ基盤は Electron を利用する
- Electron の Main プロセスで動くAIエージェントは `@openai/codex-sdk` を活用し、既定では `~/.codex` を `CODEX_HOME` として認証・skill・session を管理する
- Electron の Renderer プロセスで動くUIは、過去の [pi-web-ui](https://github.com/badlogic/pi-mono/tree/main/packages/web-ui) / [pi-web-ui-example](https://github.com/badlogic/pi-mono/blob/main/packages/web-ui/example) の責務分割を参考にしつつ、現行の Codex runtime に合わせて Main/Renderer 間 IPC を設計する
- ファイル入出力、認証、Codex 実行、MCP server 連携など Renderer で直接扱えない処理は Main 側へ集約する

## UIポーティング方針
- 詳細は `docs/ui-porting-guidelines.md` を参照

## Windows での OpenSpec 実行
- PowerShell 実行ポリシー環境では `npm` / `npx` / `openspec` の `.ps1` がブロックされる場合がある
- Windows では `.cmd` シムを優先して実行する
  - `npm.cmd run build`
  - `npx.cmd agent-browser --version`
  - `openspec.cmd status --json`
- OpenSpec の最小フロー確認例
  1. `openspec.cmd new change "<name>"`
  2. `openspec.cmd status --change "<name>" --json`
  3. `openspec.cmd instructions apply --change "<name>" --json`

詳細な検証手順は `docs/manual-test.md` を参照。

## 現在の実装スコープ（初期）
- Electron の Main/Renderer 最小構成
- Renderer から Main への IPC 経由で Codex runtime を呼び出す Agent Bridge
- Codex の ChatGPT OAuth 認証と API key 認証の導線（外部ブラウザ起動 / `codex login` / 状態表示）
- 固定間隔ハートビートと登録ジョブ実行
- エラーの標準化レスポンスとログ出力

## 現在の非対象
- 音声入力
- ウェイクワード検出
