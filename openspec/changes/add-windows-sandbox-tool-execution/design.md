## Context

Lilt-o には既に Windows sandbox の setup と live smoke test があるが、現在の検証は主に workspace 内外の書き込み制御や named pipe / raw device access の拒否に寄っている。ユーザーが確認したいのは、Agent Skill が現実的な処理として Temp 配下の一時作業、Web 取得、許可済みフォルダ配下の exe 実行を組み合わせても動くかである。

Codex 側の現在の設定は、`sandbox_mode = "workspace-write"`、`[windows] sandbox = "elevated" | "unelevated"`、`[sandbox_workspace_write] network_access = true`、`writable_roots = [...]` で表現できる。Temp 配下にランダム作業フォルダを作るには `%TEMP%` のルートを、fixture exe を読み出して実行するには fixture exe の配置ディレクトリを writable root に含める必要がある。

## Goals / Non-Goals

**Goals:**
- Windows sandbox 配下で Skill が `%TEMP%` 配下にランダム作業フォルダを作り、結果ファイルを書けることを検証する。
- sandbox のネットワーク許可が Skill の Web 取得に効くことを検証する。
- 許可済み fixture ディレクトリ配下の exe を Skill から実行でき、その stdout/stderr/exit code を作業フォルダに記録できることを検証する。
- Lilt-o のテスト資産として、必要な `config.toml` の最小設定を再生成可能にする。

**Non-Goals:**
- 任意の外部 exe 実行を常時許可する仕組みを追加すること。
- production の通常 Skill 実行設定を自動で広げること。
- Windows sandbox 本体や Codex upstream の挙動を Lilt-o 側で再実装すること。

## Decisions

### 1. テスト Skill は repo fixture として管理する

Skill は Lilt-o のテスト資産として `test/fixtures/skills/windows-sandbox-operation/SKILL.md` に置く。通常のユーザー Skill と混ざらないように、live test が一時 `CODEX_HOME` または一時 workspace へコピーして使う。

Skill の処理は次の順序にする。

- `os.tmpdir()` / `%TEMP%` 配下に `lilto-sandbox-skill-<random>` 形式の作業フォルダを作成する。
- 安定した Web URL へアクセスし、HTTP status、取得時刻、短い本文 digest を記録する。
- fixture exe を実行し、exit code、stdout、stderr を `exe-result.json` に保存する。
- 最終的な manifest を作業フォルダに保存し、ユーザーに作業フォルダのパスと検証結果だけを返す。

### 2. fixture exe は安全性と再現性を優先する

fixture exe は `test/fixtures/sandbox-bin` 配下に置く。初期案は Windows 標準の `where.exe` または `whoami.exe` をテスト準備時にコピーする方式とし、バイナリをリポジトリへ直接コミットしない。コピー先のファイル名は `lilto-sandbox-fixture.exe` に固定し、live test のセットアップで存在確認する。

この方式なら配布物に不要な exe を含めず、Windows 実機でのみ live test が fixture を作成できる。将来 CI で完全自前 fixture が必要になった場合だけ、小さな native helper を生成するタスクへ分離する。

### 3. `config.toml` は live test 用に一時生成する

テストは一時 `CODEX_HOME` を作り、その直下に次の内容を生成する。`writable_roots` は実行時の絶対パスに展開する。

```toml
sandbox_mode = "workspace-write"

[windows]
sandbox = "elevated"
sandbox_private_desktop = false

[sandbox_workspace_write]
network_access = true
writable_roots = [
  "C:\\Users\\<user>\\AppData\\Local\\Temp",
  "C:\\path\\to\\lilto\\test\\fixtures\\sandbox-bin",
]
exclude_tmpdir_env_var = false
exclude_slash_tmp = false
```

`sandbox = "unelevated"` も `LILTO_WINDOWS_SANDBOX_MODE=unelevated` で切り替えられるようにする。Skill 運用テストでは exe 実行を観察しやすくするため `sandbox_private_desktop = false` を既定にし、`LILTO_WINDOWS_SANDBOX_PRIVATE_DESKTOP=1` のときだけ private desktop を有効にする。既存の `scripts/windows-sandbox-live-test.js` と同じく Windows 以外では skip する。

### 4. 検証は許可と拒否の両方を見る

成功系は Skill の manifest で確認する。加えて、Skill または live test 側で許可外ディレクトリへの書き込みを試し、失敗することを確認する。これにより、Temp と fixture exe だけを許可したつもりが sandbox を広げすぎていないかを検出する。

## Risks / Trade-offs

- `%TEMP%` ルートを writable root に含めると、その配下全体への書き込みを許可する。運用テストでは意図通りだが、production 設定へそのまま広げない。
- fixture exe ディレクトリを writable root に入れるため、理論上はその配下への書き込みも許可される。live test では fixture ディレクトリを一時生成にするか、実行後に内容差分を検査する。
- Web 取得先が不安定だと live test が外部要因で落ちる。標準 URL は Microsoft / example.com のような安定した URL にし、環境変数で上書き可能にする。

## Migration Plan

1. fixture Skill と fixture exe 準備処理を追加する。
2. live test 用 `config.toml` 生成処理を追加する。
3. 既存の Windows sandbox live test に Skill 運用ケースを足すか、専用 script と npm script を追加する。
4. Windows 実機で setup、Skill 実行、manifest 検証、許可外書き込み拒否を確認する。

## Open Questions

- Web 取得先は `https://example.com/` を既定にするか、Codex / OpenAI などプロダクト文脈に近い URL にするか。
- fixture exe は Windows 標準 exe のコピーで十分か、CI 再現性のために将来ネイティブ helper をビルドするか。
