## 1. テスト fixture と Skill

- [x] 1.1 `test/fixtures/skills/windows-sandbox-operation/SKILL.md` を追加し、Temp 作業フォルダ作成、Web 取得、fixture exe 実行、manifest 出力の手順を記述する
- [x] 1.2 `test/fixtures/sandbox-bin` を live test セットアップ時に作成し、Windows 標準の無害な exe を `lilto-sandbox-fixture.exe` としてコピーする
- [x] 1.3 Skill 実行結果の manifest schema を決め、Temp 作業フォルダ、Web status/digest、exe stdout/stderr/exit code を検証可能にする

## 2. config.toml 生成

- [x] 2.1 live test 用の一時 `CODEX_HOME/config.toml` 生成処理を追加する
- [x] 2.2 config に `sandbox_mode = "workspace-write"`、`[windows] sandbox`、`[windows] sandbox_private_desktop` を書き込む
- [x] 2.3 config に `[sandbox_workspace_write] network_access = true` と、Temp root / fixture exe directory の `writable_roots` を書き込む
- [x] 2.4 `LILTO_WINDOWS_SANDBOX_MODE` と `LILTO_WINDOWS_SANDBOX_PRIVATE_DESKTOP` による mode 切り替えを既存 live test と揃える
- [x] 2.5 手動運用テスト用の `config.sample.toml` を Skill fixture 配下に置く

## 3. live test

- [x] 3.1 既存 `scripts/windows-sandbox-live-test.js` に Skill 運用ケースを追加する、または専用 script を追加する
- [x] 3.2 Windows 以外では skip し、Windows では sandbox setup から Skill 実行までを一気通貫で検証する
- [x] 3.3 manifest を読み取り、Temp 書き込み、Web 取得、fixture exe 実行が成功したことを assert する
- [x] 3.4 許可外ディレクトリへの書き込みが失敗し、ファイルが残らないことを assert する

## 4. 検証

- [x] 4.1 `openspec.cmd status --change add-windows-sandbox-tool-execution` で artifacts が apply-ready であることを確認する
- [x] 4.2 `npm.cmd test -- --test-name-pattern sandbox` または該当 unit test を実行する
- [x] 4.3 Windows 実機で sandbox live test を実行し、`elevated` と必要に応じて `unelevated` の結果を記録する
