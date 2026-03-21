# 手動テスト手順

## 事前準備
- `npm install`
- 必要な認証情報を環境変数または Pi の設定として用意する
- scheduler 機能を実バイナリで確認する場合は `npm run build:native` を実行する
- GUI 変更がある場合は `npm run e2e:electron` を実行できる状態にする

## Electron UI の第一選択
1. 障害解析、仕様確認、回帰切り分けでは `live-ui-manual-verification` を最初に選ぶ
2. 主要なユーザー操作は `npm run live-ui:manual -- <cdp-port> <command>` で Playwright ベースに操作する
3. Electron 固有の難所だけ WebdriverIO Electron Service を補助的に使う
4. GUI 変更時は `/live-ui-manual-verification` 完了後に、最後のリグレッション確認として `npm run e2e:electron` を回す

## live-ui-manual-verification の最小手順
1. `npm start -- --remote-debugging-port=9222` でアプリを起動する
2. `npm run live-ui:manual -- 9222 wait-app` で接続可能になるまで待つ
3. `npm run live-ui:manual -- 9222 status-text` で初期状態を確認する
4. 必要に応じて以下を使い分ける
   - `npm run live-ui:manual -- 9222 open-settings`
   - `npm run live-ui:manual -- 9222 send-prompt "Example Domain のタイトルを教えて"`
   - `npm run live-ui:manual -- 9222 messages`
   - `npm run live-ui:manual -- 9222 screenshot test/artifacts/live-ui-manual.png`
5. Playwright で扱いにくい Electron 固有 UI に当たったときだけ、別途 WebdriverIO Electron Service に切り替える

## Windows OpenSpec 互換確認
1. PowerShell で `openspec.cmd --version` が成功することを確認する
2. `openspec.cmd new change "windows-compat-smoke"` を実行する
3. `openspec.cmd status --change "windows-compat-smoke" --json` を実行する
4. `openspec.cmd instructions apply --change "windows-compat-smoke" --json` を実行する
5. 確認後、`openspec/changes/windows-compat-smoke/` を削除する

> `npm` / `npx` も同様に `.cmd` を優先する（`npm.cmd`, `npx.cmd`）。

## desktop-shell
1. `npm start` でアプリを起動する
2. 起動時にウィンドウが表示されることを確認する
3. ウィンドウを閉じてから再度アプリをアクティブ化し、既存セッションで再表示できることを確認する

## agent-bridge
1. Settings の `Providers & Models` を開き、OAuth Provider の候補が `anthropic` / `openai-codex` / `github-copilot` / `google-gemini-cli` / `google-antigravity` の5種類表示されることを確認する
2. OAuth Provider を1つ選び「Save Provider Settings」で保存後、アプリ再起動して同じ選択値が復元されることを確認する
3. 「Claude OAuth で認証」を押し、外部ブラウザが起動することを確認する
4. OAuth の認証コードを UI へ入力し、認証状態が「認証が完了しました。すぐにチャットできます。」へ遷移することを確認する
5. テキスト入力欄に依頼を入力して送信し、応答が画面に表示されることを確認する
6. 空文字送信時にバリデーションエラーが表示されることを確認する

## claude-oauth-chat-bootstrap
1. テキスト入力欄に依頼を入力して送信する
2. 未認証状態で送信した場合、認証必須エラーが表示されることを確認する
3. 認証失敗後に再試行できることを確認する

## heartbeat-jobs
1. Main プロセスログで `heartbeat_tick` が定期出力されることを確認する
2. 失敗するジョブを追加しても後続ジョブが実行されることをログで確認する

## cron-scheduler-tool
1. `npm run build:native` 済み、または `LILTO_SCHEDULER_BIN` で scheduler daemon 実行ファイルを指せる状態にする
2. 認証済みまたは Custom Provider 設定済みの状態で「3分後に知らせて」のような依頼を送る
3. AI が `cron` ツールを使って schedule を登録し、「3分後にお知らせします」のように応答することを確認する
4. 指定時刻後に対象会話へ scheduler 通知メッセージが追加されることを確認する
5. アプリ非フォーカス時は OS 通知と未読バッジも更新されることを確認する

## GUI 変更時の必須チェック
1. `/live-ui-manual-verification` を先に実施し、修正箇所の操作と期待結果を確認する
2. `npm run e2e:electron` を実行する
3. コマンドが成功終了することを確認する
4. `test/artifacts/electron-e2e.png` が生成されることを確認する

## Agent Skills (Live) E2E
1. 事前にアプリで Claude OAuth を完了し、`.lilto-auth.json` が作成されていることを確認する
2. `npm run e2e:electron:skills-live` を実行する（`LILTO_E2E_MOCK` は未設定または `0`）
3. 実行前クリーンアップで workspace 配下の `.agents/skills/` のうち `SKILL.md` に `[[LILTO_SKILL_E2E_MAGIC]]` を含むスキルのみ削除され、他スキルが残ることを確認する
4. E2E が以下を順に成功させることを確認する
   - 通常の情報取得（Example Domain タイトル取得）
   - 「再現できるようにスキル化」指示で `lilto-e2e-example-title` を生成（`[[LILTO_SKILL_E2E_MAGIC]]` 埋め込み）
   - 生成スキル呼び出しで同じ成果を再取得
5. コマンドが成功終了し、`test/artifacts/electron-e2e-agent-skills-live.png` が生成されることを確認する

## Windows Sandbox (Live)
1. Windows で `npm run test:windows-sandbox-live` を実行する
2. 初回または setup 未完了時に UAC/権限昇格確認が出た場合は許可する
3. テストが setup 完了後に以下を確認することをログで確認する
   - workspace 内ファイル書き込みは成功する
   - workspace 外ファイル書き込みは `cmd` 経由で拒否される
   - named pipe 作成が拒否される
   - raw device access が拒否される
4. `unelevated` を試す場合は PowerShell で `$env:LILTO_WINDOWS_SANDBOX_MODE='unelevated'` を設定してから同じコマンドを実行する
5. PowerShell の絶対パス書き込みや ADS のような追加ケースは、この live test の成功条件には含めない。現在の保証範囲は [docs/windows-sandbox-security-policy.md](c:\Users\hide\lilto\docs\windows-sandbox-security-policy.md) を基準に確認する
