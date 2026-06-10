# Lilt-o リファクタリング計画

作成日: 2026-06-10
対象: `src/`(TypeScript 約12,000行)、`test/`、`scripts/`、`native/`、リポジトリ構成

## 現状分析(調査結果)

### 規模と構成
- Electron アプリ。main プロセス 30 ファイル、renderer は Lit ベースで 6 コンポーネント、shared 7 ファイル。
- ネイティブ層: Rust 製 `scheduler-daemon`、`speech-transcriber`(macOS=Swift / Windows=Rust の2実装。これは意図的なプラットフォーム分岐)。
- テスト: `node --test` ベース。**テストは `dist/` のコンパイル済み JS を require している**ため、`npm test` のたびに tsc + vite のフルビルドが走る。

### 問題の所在(優先度順)

| # | 問題 | 根拠 |
|---|------|------|
| 1 | God ファイル | `settings-modal.ts` 2,285行(単一 LitElement クラス)、`skill-runtime.ts` 1,537行、`agent-sdk.ts` 1,414行、`app.ts` 1,276行、`plugin-service.ts` 913行、`ipc.ts` 706行(33 ハンドラが1ファイルに集中) |
| 2 | テストのフィードバックループが遅い | テストが `../dist/...` を require → 1行の変更でもフルビルド必須 |
| 3 | CI ゲート不在 | `.github/workflows/` は Windows ネイティブビルドのみ。型チェック・テスト・lint の自動ゲートがない |
| 4 | スキル定義の3重コピー | 同一の 6 スキルが `.claude/skills/` `.codex/skills/` `.github/skills/` に手置きで重複(計18ファイル)。手動同期はドリフトの温床 |
| 5 | パス解決モジュールの重複 | `user-data-path.ts`(`index.ts` のみが使用)と `app-paths.ts`(6ファイルが使用)が並存 |
| 6 | 型定義の出所が分散 | IPC 境界の型が `ipc-contract.ts` / `renderer/types.ts`(276行)/ `shared/*` に分散し、単一の契約になっていない |
| 7 | Windows 互換処理の散在 | `command-compat.ts` / `codex-environment.ts` / `windows-sandbox-setup.ts` にプラットフォーム分岐が分散 |
| 8 | リポジトリの肥大 | 追跡ファイル 388 のうち 232 が `openspec/`(大半がアーカイブ済み変更履歴) |

---

## 基本方針(全フェーズ共通)

1. **挙動を変えない**。各フェーズは振る舞い保存のリファクタリングのみ。機能変更・バグ修正は混ぜない(スケジューラーのバグ調査は別トラック)。
2. **1フェーズ = 複数の小さなコミット/PR**。1コミットで「移動」と「書き換え」を混ぜない(レビュー可能性のため)。
3. **各フェーズの完了条件**: `npm test` 全パス + GUI に触れたフェーズは AGENTS.md の規定どおり `/live-ui-manual-verification` → 最終 `npm run e2e:electron` 成功と `test/artifacts/electron-e2e.png` 生成確認。
4. **OpenSpec ワークフローに乗せる**: 各フェーズを 1 つの openspec change(propose → apply → archive)として進める。
5. 削除は必ず「全 grep + テスト実行」で未使用を確認してから行う。

---

## フェーズ 0: 安全網の整備(リファクタリング前提条件)

**目的**: 以降のフェーズを安全・高速に回すための検証基盤。これを先にやらないと、後続フェーズのデグレ検知ができない。

### タスク
1. **テストの高速化**
   - `test:unit` スクリプトを追加: vite(renderer バンドル)を経由せず `tsc -p tsconfig.json` のみ → `node --test`。renderer を触らない変更のフィードバックを数秒〜十数秒に短縮。
   - 可能なら tsc の incremental build(`--incremental`)を有効化。
   - フルの `npm test`(build + 全テスト)は従来どおり残す。
2. **CI ゲートの追加**
   - `.github/workflows/` に macOS + Windows で `tsc --noEmit` + `npm run test:unit` を回すワークフローを追加。
   - 既存の `windows-x64-native-build.yml` はそのまま。
3. **ベースライン計測**
   - `npx knip`(または `ts-prune` + `depcheck`)で未使用 export / 未使用依存のレポートを取得し、`tasks/refactoring-baseline.md` に保存。フェーズ 1 の削除対象リストの根拠にする。
   - 行数・ファイル数のスナップショットも記録(進捗の定量評価用)。
4. **IPC 契約の特性テスト(characterization test)**
   - `ipc.ts` の 33 ハンドラについて、チャネル名と引数/戻り値の形を固定するテストを追加(既存の `*-ui-contract.test.js` の流儀に合わせる)。フェーズ 2 の分割時の安全網。

**完了条件**: CI がグリーン / `test:unit` が renderer ビルドなしで通る / ベースラインレポートがコミットされている。
**リスク**: 低(プロダクトコードに触れない)。

---

## フェーズ 1: 死蔵コード・重複の削除

**目的**: 分割リファクタの前に母数を減らす。「動かして直す」前に「捨てる」。

### タスク
1. **knip レポートに基づく未使用 export / ファイルの削除**
   - 候補は機械的に出すが、削除は 1 件ずつ grep で確認(動的 require・MCP 経由の参照があるため。例: `cron-mcp-server.js` は asarUnpack で実行時参照される)。
2. **パス解決の一本化**
   - `user-data-path.ts`(利用者は `index.ts` のみ)を `app-paths.ts` に統合し削除。
3. **スキル定義の単一ソース化**
   - 正本を `.claude/skills/` に置き、`.codex/skills/` `.github/skills/` は `scripts/sync-skills.js`(既存の `sync-skill-creator.js` を拡張)で生成。生成物であることを README に明記し、prebuild で同期。
   - これで 18 ファイルの手動同期が 6 ファイル + スクリプトになる。
4. **未使用 npm 依存の削除**
   - depcheck の結果から、`package.json` の未使用 dependencies を削除。`package-lock.json` 再生成。
5. **openspec アーカイブの整理(任意・低優先)**
   - `openspec/changes/archive/` は仕様の正本が `openspec/specs/` にある限りコード理解には不要。削除はせず、まずは現状維持で可。やるなら git 履歴に残ることを確認して別コミットで削除。

**完了条件**: `npm test` 全パス / knip の未使用レポートが大幅減 / `npm run dist:mac` 相当のパッケージングが成功(asarUnpack・extraResources の参照を壊していないこと)。
**リスク**: 中。動的参照(MCP サーバ、Electron の preload、ビルドスクリプト)を静的解析が見落とす。→ パッケージング検証を完了条件に含めるのはこのため。

---

## フェーズ 2: main プロセスの God ファイル分割

**目的**: `ipc.ts` / `agent-sdk.ts` / `skill-runtime.ts` / `plugin-service.ts` をドメイン単位に分割し、`index.ts` を合成ルート(composition root)に純化する。

### タスク
1. **IPC 層の分割**(`ipc.ts` 706行・33ハンドラ)
   - `src/main/ipc/` ディレクトリを作り、ドメイン別に分割: `agent.ts` / `scheduler.ts` / `settings.ts` / `skills.ts` / `audio.ts` / `session.ts` など。
   - `ipc-contract.ts` を唯一の型契約として、チャネル名・payload 型をここに集約。preload(`src/preload.ts`)もこの契約から型を引く。
   - フェーズ 0 で作った IPC 特性テストで等価性を担保。
2. **`agent-sdk.ts`(1,414行)の責務分離**
   - ① Codex プロセスのライフサイクル管理、② スレッド/イベントストリーム処理、③ エラー分類・リトライ判定、④ 設定(サンドボックスモード等)組み立て、を別モジュールに。`test/agent-runtime.test.js`(826行)が既存の安全網。
3. **`skill-runtime.ts`(1,537行)の分割**
   - スキル発見(discovery)/ 実行(execution)/ サンドボックスポリシー、の3分割。`test/skill-runtime.test.js`(1,152行)が安全網。
4. **`plugin-service.ts`(913行)・`heartbeat-assistant.ts`(579行)**
   - 上記と同じ要領で。テストが薄い箇所は分割前に特性テストを足す。
5. **`index.ts` の純化**
   - 起動シーケンスと DI(各サービスの生成と接続)だけにする。

**完了条件**: `npm test` 全パス / IPC 特性テストが無変更でパス / 1ファイル上限の目安 500 行(コンポーネント/サービス単位)。
**リスク**: 中。イベント順序・初期化順序に依存したコードの移動ミス。→ 移動コミットと書き換えコミットを分離して対処。

---

## フェーズ 3: renderer の分割(GUI フェーズ)

**目的**: `settings-modal.ts`(2,285行)と `app.ts`(1,276行)の解体。

### タスク
1. **`settings-modal.ts` の分割**
   - 単一 LitElement をセクション単位の子コンポーネントに分割(プロバイダ設定 / モデル選択 / スキル / スケジューラ / 音声入力 など、実際のタブ・セクション構造に沿って)。
   - 状態管理(設定の読み書き・バリデーション)を view から `settings-controller.ts` のような非 UI モジュールに抽出し、単体テスト可能にする。
2. **`app.ts` の分割**
   - セッション状態管理 / scheduler follow-up 処理 / 音声録音連携を controller として抽出。`app.ts` はレイアウトとイベント配線のみに。
3. **型の一本化**
   - `renderer/types.ts`(276行)のうち IPC 境界の型は `ipc-contract.ts` / `shared/` に寄せ、renderer ローカルな view 型だけを残す。
4. **検証**
   - 各ステップで `/live-ui-manual-verification`(AGENTS.md の第一選択)。
   - フェーズ完了時に最終リグレッションとして `npm run e2e:electron` を実行し、成功終了と `test/artifacts/electron-e2e.png` を確認。

**完了条件**: 上記 E2E 成功 / settings の全セクションが手動検証で動作 / 1コンポーネント 500 行以下。
**リスク**: 高(UI はテストが薄い)。→ セクション 1 つずつ取り出して都度ライブ検証。一括書き換え禁止。

---

## フェーズ 4: 横断的関心事の整理

**目的**: プラットフォーム分岐・設定永続化・ログの「流儀」を統一する。

### タスク
1. **プラットフォーム層の集約**
   - `command-compat.ts` / `codex-environment.ts` / `windows-sandbox-setup.ts` に散在する Windows 分岐を `src/main/platform/` に集約し、「Windows では npm.cmd / npx.cmd を優先」などのルール(AGENTS.md 記載)を1箇所に。
2. **設定・永続化の統一**
   - `config.ts` / `provider-settings.ts` / `model-catalog.ts` / `conversation-history.ts` の永続化パターン(ファイル配置、スキーマ、マイグレーション)を揃える。`app-paths.ts` を唯一のパス決定点に。
3. **ログとエラー処理の規約化**
   - `logger.ts` の利用規約(どの層で catch して何を log するか)を決め、`docs/implementation-notes.md` に追記。`agent-sdk.ts` のエラー分類(`AgentError`)を他サービスでも再利用。

**完了条件**: `npm test` 全パス + Windows 側は `npm run test:windows-sandbox-live` 相当の確認(CI の Windows ジョブでカバー)。
**リスク**: 中。Windows 実機でしか踏めないパスがある → CI の Windows ジョブとライブテストで担保。

---

## フェーズ 5: ビルド・スクリプト・ネイティブ層の最終整理

**目的**: 開発体験の仕上げと、残ったインフラ的な重複の解消。

### タスク
1. **`scripts/` の共通化**
   - E2E 系 5 スクリプト(`e2e-electron-agent-browser.js` 492行、`e2e-electron-agent-skills-live.js` 388行 ほか)の起動・CDP 接続・後始末ロジックを `scripts/lib/` に共通化。
2. **ネイティブ層のプロトコル文書化**
   - `scheduler-daemon` の stdin/stdout JSON プロトコルと `speech-transcriber` の macOS(Swift)/ Windows(Rust)二実装の責務を `docs/` に明文化。コード変更はしない(スケジューラーには既知の調査中バグがあるため、このフェーズでは触らない)。
3. **tsconfig / vite 設定の見直し**
   - `tsconfig.json` / `tsconfig.renderer.json` の重複設定を base 化。strict 系フラグの現状を確認し、未導入なら段階的有効化の計画だけ立てる(実施は別トラック)。
4. **最終計測**
   - フェーズ 0 のベースラインと比較し、行数・最大ファイルサイズ・未使用 export 数・`npm test` 所要時間の改善を `tasks/refactoring-baseline.md` に追記。

**完了条件**: `npm run dist:mac` / `dist:win` のパッケージングが成功 / E2E 全種パス / 計測レポート完成。
**リスク**: 低〜中。

---

## 実施順序とスコープ外

- 順序は 0 → 1 → 2 → 3 → 4 → 5 を推奨。0 と 1 は必須の前提。2 と 3 は独立しているので並行可能だが、IPC 契約(2-1)だけは 3 より先に終えること(renderer が型を引く先になるため)。
- **スコープ外(別トラック)**: スケジューラーの「30秒後に教えて」が動かないバグの修正、strict TypeScript の有効化、フレームワーク変更、新機能。リファクタリング中にバグを見つけたら直さずに issue 化する。
