# 手動テスト手順

## 事前準備
- `npm install`
- 必要な認証情報を環境変数または Pi の設定として用意する
- GUI 変更がある場合は `npm run e2e:electron` を実行できる状態にする

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
1. 「Claude OAuth で認証」を押し、外部ブラウザが起動することを確認する
2. OAuth の認証コードを UI へ入力し、認証状態が「認証が完了しました。すぐにチャットできます。」へ遷移することを確認する
3. テキスト入力欄に依頼を入力して送信し、応答が画面に表示されることを確認する
4. 空文字送信時にバリデーションエラーが表示されることを確認する

## claude-oauth-chat-bootstrap
1. テキスト入力欄に依頼を入力して送信する
2. 未認証状態で送信した場合、認証必須エラーが表示されることを確認する
3. 認証失敗後に再試行できることを確認する

## heartbeat-jobs
1. Main プロセスログで `heartbeat_tick` が定期出力されることを確認する
2. 失敗するジョブを追加しても後続ジョブが実行されることをログで確認する

## GUI 変更時の必須チェック
1. `npm run e2e:electron` を実行する
2. コマンドが成功終了することを確認する
3. `test/artifacts/electron-e2e.png` が生成されることを確認する

## Agent Skills (Live) E2E
1. 事前にアプリで Claude OAuth を完了し、`.lilto-auth.json` が作成されていることを確認する
2. `npm run e2e:electron:skills-live` を実行する（`LILTO_E2E_MOCK` は未設定または `0`）
3. 実行前クリーンアップで `~/.pi/skills` 配下のうち `SKILL.md` に `[[LILTO_SKILL_E2E_MAGIC]]` を含むスキルのみ削除され、他スキルが残ることを確認する
4. E2E が以下を順に成功させることを確認する
   - 通常の情報取得（Example Domain タイトル取得）
   - 「再現できるようにスキル化」指示で `lilto-e2e-example-title` を生成（`[[LILTO_SKILL_E2E_MAGIC]]` 埋め込み）
   - 生成スキル呼び出しで同じ成果を再取得
5. コマンドが成功終了し、`test/artifacts/electron-e2e-agent-skills-live.png` が生成されることを確認する
