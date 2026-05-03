## Why

Windows Sandbox を有効にした Codex 環境で、Agent Skills が実運用に近い入出力を安全にこなせるかを Lilt-o 側で再現可能に検証したい。特に「Temp 配下の作業」「Web アクセス」「固定フォルダ配下の exe 実行」という組み合わせは、`config.toml` の sandbox 設定が不足していると原因切り分けが難しい。

## What Changes

- Lilt-o のテスト資産として、sandbox 運用テスト用 Agent Skill を追加する。
- テスト用 Skill は `%TEMP%` 配下にランダムな作業フォルダを作成し、Web から情報を取得し、リポジトリ内の fixture exe を実行して結果を作業フォルダへ書き込む。
- リポジトリ内に安全な fixture exe を用意する。生成元は Windows 標準の無害な実行ファイルまたは小さな自前 fixture とし、実行結果は環境情報や引数の echo 程度に限定する。
- Lilt-o のテスト用 `CODEX_HOME/config.toml` 生成またはサンプルに、Windows sandbox で上記 Skill を動かすための設定を追加する。
- live smoke test で、Skill 実行が Temp 書き込み、ネットワーク取得、fixture exe 実行を完了し、許可外の書き込みを行わないことを確認する。

## Capabilities

### New Capabilities
- `windows-sandbox-skill-operation-test`: Windows Sandbox 配下で Agent Skill の Temp 作業、Web 取得、fixture exe 実行を検証する Lilt-o テスト資産を扱う。

### Modified Capabilities
- `agent-skills`: Sandbox 実行時にも Agent Skill が必要な filesystem/network/process 条件を設定で満たせることを明確にする。
- `codex-windows-sandbox-setup`: Lilt-o が生成または案内する Windows sandbox 用 `config.toml` が、Skill 運用テストに必要な `workspace-write`、Windows sandbox mode、ネットワーク、追加 writable root を表現できることを明確にする。

## Impact

- テスト資産: `skills` または `test/fixtures` 配下の sandbox 運用テスト用 Skill、fixture exe、期待結果ファイル
- テスト実行: `scripts/windows-sandbox-live-test.js` または新規 live test script
- Codex 設定: テスト用 `CODEX_HOME/config.toml` の生成処理またはサンプル
- 参照元: `.env` の `CODEX_REPO_DIR` にある Codex 側 config schema と Windows sandbox 実装
