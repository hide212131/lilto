## Why

Agent Skills 設定画面の「アップデートを確認」は現在の配置だと説明が目立ち、インストール済みスキル管理の操作として見つけにくい。また、ユーザーがボタンを押すまで更新検出が走らないため、起動直後に更新候補を把握できない。フォルダからインストールした skill も元フォルダの変更を追跡できず、バージョン更新や `SKILL.md` の更新時刻が変わっても更新候補として検出できない。

## What Changes

- アプリ起動直後に Agent Skills の更新検出を自動実行する。
- Agent Skills タブでは、「アップデートを確認」ボタンを「インストール済みスキル」見出し付近の更新ボタンの右隣に配置する。
- 「アップデートを確認」に関する説明文や補足テキストは表示しない。
- 手動の「アップデートを確認」ボタンは、自動検出後の再確認操作として残す。
- フォルダからインストールした user skill について、インストール元 `SKILL.md` の version と更新時刻を記録する。
- 更新確認時に、フォルダ由来 skill のインストール済み情報とインストール元情報を比較し、version または `SKILL.md` 更新時刻の差分を更新候補として返す。
- URL/既存 bundled skill の更新確認動作は維持し、フォルダ由来 skill を追加対象として扱う。

## Capabilities

### New Capabilities

- なし

### Modified Capabilities

- `lit-chat-app`: Agent Skills 設定画面の更新確認ボタンの配置、説明非表示、起動直後の自動検出表示要件を追加する。
- `skills-library-list-and-remove`: フォルダからインストールした skill の更新検出要件を追加する。

## Impact

- Renderer: 設定モーダルの Agent Skills タブ UI、ボタン配置、不要な説明文の削除、自動検出結果の初期表示。
- Main process: `skills:install` と `skills:checkUpdates` の folder source metadata 記録/比較。
- App startup / preload flow: 起動直後に `skills:checkUpdates` を呼び出す初期化処理。
- Skill runtime: `.skill-source.json` など既存 source record の拡張、version/mtime 比較。
- Tests: skill runtime unit tests、設定画面 UI tests、起動時自動検出 tests、GUI 変更後の Electron E2E。
