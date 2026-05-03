## Context

Lilt-o は Windows packaged build で `app.getPath("userData")` を `%LOCALAPPDATA%\Lilt-o` に固定している。この root は provider settings、auth-state、scheduler DB、app-managed Codex home などの保存先として正しい。

一方で、現在は `setupSkillRuntime()` の `homeDir` が既定で `appDataDir` になり、その値が `AgentRuntime`、`ClaudeAuthService`、`CodexAppServerClient`、skill CLI 起動時の `HOME` / `USERPROFILE` に流れている。これにより、子プロセスから見たユーザーのホームがアプリデータディレクトリへ変わり、Codex 以外の CLI やユーザー設定探索が OS の通常ホームを見られなくなる。

## Goals / Non-Goals

**Goals:**
- `HOME` / `USERPROFILE` は親プロセスから受け継いだ OS の通常値を維持する。
- アプリ固有の保存先は `userData`、`CODEX_HOME`、`workspaceDir` など明示的な値で渡す。
- Codex auth、Codex app-server、Agent SDK、skills CLI の環境構築をテストで固定する。
- `%LOCALAPPDATA%\Lilt-o` の userData root と既存の userData 移行方針は維持する。

**Non-Goals:**
- userData の場所を再変更しない。
- Codex 本体のホーム探索仕様は変更しない。
- GUI の見た目や操作フローは変更しない。

## Decisions

1. `homeDir` は「OS ホーム」の意味に戻す

`setupSkillRuntime()` は `homeDir` を `appDataDir` から導出しない。必要な場合だけ呼び出し元が OS ホームを渡せるが、既定では子プロセス環境の `HOME` / `USERPROFILE` を変更しない。アプリが使う root は `appDataDir` と `codexHomeDir` で表現する。

代替案として `HOME=userData` を維持して個別 CLI にだけ戻す方法もあるが、影響範囲が読みにくく、新しい起動経路を追加するたびに同じ副作用を再発させやすい。

2. 子プロセス env builder は `HOME` / `USERPROFILE` を上書きしない

`createCodexThreadFromSdk()`、`ClaudeAuthService.startOAuth()`、`CodexAppServerClient.start()`、skill install/list 系の env override から `HOME` / `USERPROFILE` 代入を外す。`CODEX_HOME` は app-managed Codex state の明示的な保存先として引き続き設定する。

3. workspace/user skill は workspace root で管理する

ユーザーがアプリから追加した skills は、現在どおり app-managed workspace の `.agents/skills` を使う。これは `HOME` を動かす代わりに `projectRoot` / `workspaceDir` を skills CLI と runtime に渡して実現する。

4. fallback auth migration は明示パスで扱う

ChatGPT auth の移行元/移行先は `CODEX_HOME` と fallback path で明示する。`HOME` を userData に変えないため、fallback が通常の `~/.codex` を指す場合も自然な意味を保つ。

## Risks / Trade-offs

- 既存の実装が `$HOME/.agents/skills` 探索に暗黙依存している可能性 → `projectRoot` と `userSkillsDir` を使うテストで、app-managed workspace skills が維持されることを確認する。
- Codex SDK/CLI 側が `HOME` 由来の設定を読む可能性 → `CODEX_HOME` を明示し、Codex state は app-managed root に固定する。
- Windows と macOS/Linux で `HOME` / `USERPROFILE` の有無が異なる → テストでは、渡した OS ホーム値が保存されるのではなく「userData に上書きされない」ことを検証する。
