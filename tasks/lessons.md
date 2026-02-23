# Lessons

## 2026-02-23

| 変更内容 | ミス/課題 | 再発防止ルール |
|---|---|---|
| `add-electron-agent-browser-e2e-gate` の design/specs/tasks を一括作成し、GUI 変更時 E2E 必須ルールをタスク化。 | proposal の Capability で `Modified` を指定すると、既存 spec 不在時に整合性が崩れる。 | 既存 `openspec/specs` の実体を確認し、存在しない capability は `Modified` ではなく `New Capabilities` として定義する。 |
| `agent-browser` を用いた Electron E2E（CDP接続）と `LILT_E2E_MOCK` モードを実装し、GUI変更の完了条件を `AGENTS.md` に反映。 | Renderer TS をモジュール（`export {}`）として書くと、ブラウザ実行で `exports` 参照が混入し UI イベントが無反応になる不具合を見落とした。 | Browser で直接読む Renderer スクリプトは CommonJS 依存コードを出さない構成にし、GUI変更時は必ず E2E でイベント発火と状態遷移を確認する。 |
| E2E スクリプト配置を整理。 | E2E スクリプトを `test/` 配下に置くと `node --test` に自動収集され、通常テスト時間を不必要に増やす。 | 手動実行前提の E2E は `scripts/` に配置し、`npm run e2e:*` でのみ起動する。 |
| README のテスト詳細を整理し、人間向けは `docs/manual-test.md`、エージェント向けは `AGENTS.md` に集約。 | 利用者別の情報配置を分けずに README へ運用詳細を書きすぎると、責務が曖昧になり更新漏れを招く。 | README は概要と参照先に留め、実行手順は対象読者ごとの専用ドキュメントへ記載する。 |
| E2E でスクリーンショットを出力する運用を維持。 | テスト証跡画像を Git 管理に含めるとリポジトリが汚れやすい。 | `test/artifacts/` を `.gitignore` に追加し、スクリーンショットはローカル証跡としてのみ扱う。 |
| `.env` を元にテンプレートファイルを作成。 | ローカル固有パスを絶対パスで共有すると環境依存になる。 | 共有用は `.env.example` にプレースホルダ値を記載し、実値は `.env` のみに保持する。 |
| OpenSpec change を同期付きでアーカイブ。 | `openspec sync` のような独立コマンドは存在せず、誤コマンドで手戻りしやすい。 | 同期が必要なアーカイブは `openspec archive <change> -y` を使い、spec 更新と archive を一括実行する。 |
