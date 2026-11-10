## 1. OpenSpec と実行 API 契約（T01）

- [x] 1.1 change と delta specs を作成する。（`openspec` CLI がこの環境に無く `openspec validate` は未実行。）
- [x] 1.2 同梱 App Server（codex-cli 0.163.0）のバージョンを記録し、`thread/start`／`thread/resume` が `config`（`mcp_servers`）と `developerInstructions` を受け付けることをスキーマ生成で確認する。
- [x] 1.3 実バイナリでの MCP 発見・`skills.config` 無効化・Electron 44 の入力イベント順序の確認（ヘッドレス Linux VM では Electron GUI と認証済み実モデルを使えないため未実施。design.md「検証できていない前提」参照）。 **実施済み（部分）**: 同梱 codex 0.163.0 の MCP 発見・`skills.config` 無効化（ユーザー領域の同名 skill）・Electron 44 の `before-*-event` を `scripts/verify-*.js` で実機確認。詳細と観察事項は design.md「検証結果と未検証の前提」。

## 2. 共通型と MCP スキーマ（T02）

- [x] 2.1 `src/shared/browser.ts` と `src/main/browser-tool-contract.ts` に型・エラー・JSON Schema・引数検証を実装する。
- [x] 2.2 全 tool の正例・不正例・上限値の unit test。

## 3. 設定の保存契約（T03）

- [x] 3.1 `BrowserSettings`、既定値、normalize、save 検証、省略保存での現在値維持、コピー。
- [x] 3.2 Renderer 初期値と test fixture の更新、unit test。

## 4. Controller と View 基盤（T04）

- [x] 4.1 View の生成・attach・close、状態通知、partition／URL／権限／popup／download の境界を実装する。
- [x] 4.2 実 View でのローカルページ表示・preload 非公開・クラッシュ時のホスト維持の確認（ヘッドレスのため未実施。T15 に含む）。 Xvfb 上の実 Electron 44 で `scripts/verify-embedded-browser.js`（62 項目）により確認。

## 5. 右パネルと bounds（T05）

- [x] 5.1 Lit パネル、viewport 計測、IPC、開閉・右幅保存・左右の幅制約、遮蔽を実装する。
- [x] 5.2 bounds 計算の unit test。
- [ ] 5.3 ライブ UI での左右操作・幅復元・zoom・モーダル重なり確認（ヘッドレスのため未実施。T15）。

## 6. ツールバーとリンク移行（T06）

- [x] 6.1 戻る・進む・再読込・アドレス・外部で開く・閉じる。
- [x] 6.2 link-navigation を Controller 委譲にし、旧 toolbar View・全面 overlay・疑似 URL を削除する。
- [ ] 6.3 通常リンク・`_blank`・offline・履歴なしのライブ確認（ヘッドレスのため未実施。T15）。

## 7. 所有権とキャンセル（T07）

- [x] 7.1 run／lease／epoch、単一操作キュー、手動切替・閉じる・非表示・モーダル・中断の失効。
- [x] 7.2 ユーザー入力の監視（`before-input-event`／`before-mouse-event`）。
- [x] 7.3 A/B 競合、古い run、遅延処理の unit test。

## 8. DOM snapshot と ref（T08）

- [x] 8.1 isolated-world runtime（`dom-v1`）、ref・fingerprint・期限・上限。
- [x] 8.2 実 View での snapshot 決定性・各失効条件の確認（ヘッドレスのため未実施。T15）。DOM 実装は jsdom 相当の無い環境のため、スクリプトの構文・純関数部のみ unit test。 同上（snapshot 決定性・各失効条件・password／hidden／iframe）。

## 9. 入力・観察ツール（T09）

- [x] 9.1 click／fill／select／press／scroll／get_text／screenshot／wait と副作用状態。
- [x] 9.2 日本語入力・controlled input・遮蔽クリック等の実 View 確認（ヘッドレスのため未実施。T15）。 同上（日本語入力・controlled input・遮蔽クリック・wait）。

## 10. Browser Bridge（T10）

- [x] 10.1 run token、認証、Origin／Host、サイズ、失効、同時数上限、キャンセル。
- [x] 10.2 unit test。

## 11. stdio MCP（T11）

- [x] 11.1 ライフサイクル、固定ツール集合、構造化結果・image content、キャンセル。
- [x] 11.2 実 child process の契約テスト。

## 12. App Server と Skill policy（T12）

- [x] 12.1 実行ごとの capability 注入、Thread キャッシュからの token 分離、developer instructions。
- [x] 12.2 `agent-browser` の条件付き無効化。
- [x] 12.3 同梱 App Server での `acquire → snapshot → 操作` smoke（認証済みモデルが必要なため未実施）。 モデル非依存で、同梱 App Server の `mcpServer/tool/call` 経由で `acquire → snapshot → 操作 → wait → screenshot` を `scripts/verify-app-server-mcp.js`（16 項目）で確認。認証済みモデルによるツール選択は未検証。

## 13. 設定 UI と即時切替（T13）

- [x] 13.1 ブラウザ設定タブ、非同期保存 hook、ON/OFF 時の停止・cache・View・Session 処理。
- [ ] 13.2 ライブ UI での OFF 保存後の停止確認（ヘッドレスのため未実施。T15）。

## 14. 配布資産（T14）

- [x] 14.1 `resolveBrowserMcpServerPath`、`asarUnpack`、配布検証スクリプト。
- [ ] 14.2 macOS／Windows 生成物での実行確認（実機生成物が無いため未実施）。代替として、MCP entry と依存の閉包が `asarUnpack` に含まれること、および隔離した `app.asar.unpacked` 相当のレイアウトで MCP が起動することをテスト済み（`test/browser-dist-assets.test.js`）。`scripts/verify-dist-artifacts.js` に同梱検査を追加（生成物での実行は未確認）。

## 15. 全機能のライブ検証（T15）

- [ ] 15.1 design.md 17.3 のシナリオ。**未実施（指示によりヘッドレス VM では行わない）**: Lit UI を介したライブ UI（左右パネル・幅復元・zoom・モーダル重なり）は GUI セッションのある環境で実施する。なお Xvfb 上で Electron 自体は起動でき、Lit UI を介さない実 View 検証は `scripts/verify-embedded-browser.js`／`scripts/verify-app-server-mcp.js` で実施済み（design.md 参照）。

## 16. 最終 E2E と OpenSpec 完了（T16）

- [x] 16.1 unit・型チェック・vite build の成功を記録する。
  - `npx tsc -p tsconfig.json`: 成功。`npm run build --ignore-scripts`（= tsc + vite build）: 成功。
  - `node scripts/run-unit-tests.js`: 376 件中 374 件成功。失敗 2 件（`scheduler-daemon` ネイティブバイナリ無し／`build/icon.ico` 無し）は変更前（stash 済みベースライン: 241 件中 239 件成功）でも同一で、prebuild／native ビルドが必要な環境要因。ブラウザ関連 `test/browser-*.test.js` は 131/131 成功。
  - `npm run test:unit` / `npm run build` は `prebuild`（`scripts/prepare-build-assets.js`）が root での Electron 起動拒否（`--no-sandbox` が必要）で失敗するため、上記の代替で検証した。
  - 実 Electron 44.9.3（Xvfb）: `scripts/verify-embedded-browser.js` 62/62、`scripts/verify-app-server-mcp.js`（同梱 codex 0.163.0）16/16。
- [x] 16.2 既存 E2E の右パネル前提への更新と `npm run e2e:electron`、`test/artifacts/electron-e2e.png` の生成確認。**実施済み（CI）**: `scripts/verify-link-navigation.js` を右パネル前提へ書き換え。初回 CI は `lilt-browser-panel` の visible 待ちでタイムアウトしたが、原因は製品でなく Playwright の host ページ pending navigation 滞留（will-navigate を Electron が打ち消すため）で、CDP 再接続を host 検証より前へ移して解消。修正後は GitHub Actions の Electron UI regression が成功（runs 42753609872 / 42753614473、スクリーンショット生成確認ステップ含む）。ローカルでも実 Electron（Xvfb）で `scripts/verify-link-navigation.js` 単体が全項目成功。
