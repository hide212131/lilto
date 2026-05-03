## Why

現在のアプリは Agent/Codex 関連プロセスのために `HOME` / `USERPROFILE` を `app.getPath("userData")` へ差し替えているが、外部 CLI やユーザー設定が通常のホームディレクトリを前提にしている場合に副作用が出る。
アプリ固有データの保存先と OS のホームディレクトリは役割が異なるため、アプリ側で管理する root を明示的な変数や引数として渡し、`HOME` は変更しないようにする。

## What Changes

- Agent/Codex/Skill/Auth/App Server 起動時の環境から、`HOME` / `USERPROFILE` を userData へ上書きする処理を削除する。
- アプリ固有の保存先は `app.getPath("userData")`、`CODEX_HOME`、workspace/project root など既存の明示的な設定で渡す。
- `%LOCALAPPDATA%\Lilt-o` の userData root は維持するが、それを OS ホームとして扱わない。
- 既存の認証・スキル探索・app-server 起動が、`HOME` 差し替えなしで期待する保存先を使うことをテストで固定する。

## Capabilities

### New Capabilities
- `app-environment-boundaries`: アプリ管理ディレクトリと OS ホーム環境変数の責務境界を定義する。

### Modified Capabilities

## Impact

- 影響範囲: `src/main/index.ts`, `src/main/agent-sdk.ts`, `src/main/auth-service.ts`, `src/main/codex-app-server-client.ts`, `src/main/skill-runtime.ts`
- テスト影響: Agent runtime / auth service / skill runtime / app-server client の環境構築テストを追加または更新する。
- 互換性: `%LOCALAPPDATA%\Lilt-o` の userData 移行方針は維持しつつ、子プロセスの `HOME` / `USERPROFILE` はユーザーの通常値を引き継ぐ。
