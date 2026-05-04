## Context

Agent Skills は設定モーダルの `Agent Skills` タブでインストール、一覧、削除、更新確認を管理している。現在の UI では「アップデートを確認」が独立した説明付きセクションになっており、ユーザーが求める「インストール済みスキル一覧の操作」から離れて見える。また、更新確認は手動操作まで走らないため、アプリ起動直後に更新候補を把握できない。

skill runtime は user skill を `CODEX_HOME/skills` に保存し、`.skill-source.json` に source URL や installedVersion を記録する。ローカルフォルダからのインストールでは、インストール元 `SKILL.md` の path / mtime / version を記録し、それを起動直後の自動検出と手動再確認の両方で使う必要がある。

## Goals / Non-Goals

**Goals:**

- アプリ起動直後に Agent Skills の更新検出を自動実行する。
- 「アップデートを確認」ボタンを「インストール済みスキル」見出し内の更新ボタン右隣に置く。
- 更新確認の説明文を表示しない。
- フォルダ由来 skill の更新確認を、インストール元 `SKILL.md` の version と mtime の比較で検出できるようにする。
- 既存の URL / bundled skill 更新確認を壊さない。

**Non-Goals:**

- 更新確認後に自動更新する挙動は追加しない。
- 起動を更新確認の完了までブロックしない。
- skill marketplace や plugin marketplace の UI は変更しない。
- `CODEX_HOME/skills` 以外を新しい primary install root として追加しない。

## Decisions

### 1. 起動直後の更新検出は非同期で実行する

アプリ起動後、renderer が初期化されたら `skills:checkUpdates` を非同期で呼び出す。起動表示やチャット操作をブロックせず、結果が返ったら Agent Skills タブの状態に反映する。失敗時はアプリ全体の起動失敗にせず、Agent Skills 側の状態として扱う。

代替案として main process 起動中に同期実行する方法もあるが、ネットワークやローカル I/O の遅延が起動体験に影響するため採用しない。

### 2. 更新確認ボタンは installed skills 見出しの action として扱う

「インストール済みスキル」見出しの右側に、既存の一覧更新ボタンと「アップデートを確認」ボタンを横並びで配置する。自動検出後も、手動ボタンは再確認操作として残す。更新確認結果は同じセクションの一覧下に表示する。

代替案として独立した「アップデート確認」セクションを残す方法もあるが、ユーザー要望は「ボタンを右隣に置くのみ」であり、説明不要なので採用しない。

### 3. フォルダ install は source record に local source metadata を保存する

フォルダまたは `SKILL.md` ファイルから install した場合、 `.skill-source.json` に以下を保存する。

- `url`: 入力された source 文字列
- `installedVersion`: インストール時点の `SKILL.md` frontmatter version
- `sourceSkillPath`: インストール元 `SKILL.md` の絶対パス
- `sourceSkillMtime`: インストール時点の `SKILL.md` `mtimeMs`

これにより、コピー後の `CODEX_HOME/skills/<name>/SKILL.md` だけでなく、元フォルダの変更を追跡できる。

### 4. 更新判定は version 差分を優先し、mtime 差分で補完する

更新確認時は、インストール済み record と現在の source を比較する。

- source の version が取得でき、installedVersion と異なる場合は更新あり。
- version が同じ、またはどちらかが取得できない場合でも、source `SKILL.md` の `mtimeMs` が record と異なれば更新あり。
- source path が消えている場合は更新なしとして扱い、処理全体を失敗させない。

mtime だけで判定すると保存し直しでも更新扱いになるが、ユーザーの「バージョンや SKILL の更新時間で」という要件に合う。version を優先することで、意味のあるバージョン差分も表示できる。

### 5. 既存 update result shape は後方互換を保つ

`SkillUpdateInfo` には既存の `skillName`, `sourceUrl`, `installedVersion`, `latestVersion`, `updateAvailable` を維持する。必要に応じて `updateCheckMethod` のような内部/表示補助フィールドを使うが、既存 UI が壊れない shape にする。

## Risks / Trade-offs

- [Risk] 起動直後の自動検出がネットワークや I/O で遅い → Mitigation: 非同期実行にし、起動と主要 UI 操作をブロックしない。
- [Risk] ローカル source path が移動/削除されると比較できない → Mitigation: その skill は更新なしとして返し、他 skill の更新確認を継続する。
- [Risk] mtime は内容変更なしでも変わる → Mitigation: version が取れる場合は version 差分を優先し、mtime は補助判定として扱う。
- [Risk] GUI 変更でボタンや結果表示が崩れる → Mitigation: UI unit test と Electron E2E で Agent Skills タブを確認し、`test/artifacts/electron-e2e.png` の生成を確認する。

## Migration Plan

- 既存の `.skill-source.json` に `sourceSkillPath` / `sourceSkillMtime` がない場合は従来の URL 系更新確認へフォールバックする。
- 新たにフォルダから install した skill から local source metadata を保存する。
- 既存フォルダ由来 skill でも `url` がローカルパスなら、更新確認時に best-effort で source `SKILL.md` を再発見する。
- 起動直後の自動検出は失敗してもアプリ起動を継続し、手動ボタンで再試行できる。

## Open Questions

- なし
