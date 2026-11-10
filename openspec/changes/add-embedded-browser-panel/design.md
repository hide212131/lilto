## Context

設計書 `lilto-dev/designs/embedded-browser-design.md`（18 章）の要約。決定事項は設計書が正であり、ここでは実装の根拠となる要点を残す。

現行の `src/main/link-navigation.ts` は全面オーバーレイと別 View のツールバーでリンクを表示し、AI のブラウザ操作は同梱 `agent-browser` 経由である。

## Decisions

| 項目 | 決定 |
|---|---|
| 表示 | 右側の開閉・リサイズ可能なサイドパネル。ページ実体は Main 管理の共有 1 面 `WebContentsView` |
| ツールバー | Renderer の Lit コンポーネント。旧オーバーレイは廃止 |
| エージェント連携 | 専用 stdio MCP（`lilto_browser`）→ localhost HTTP Bridge（Bearer・run 単位）→ Controller |
| 設定 | `browserSettings.enabled`（既定 ON、内蔵ブラウザと AI 連携の双方）、`autoOpenOnToolUse`（既定 ON） |
| 非表示時 | 操作しない。自動表示 OFF なら手動で開くまで `PANEL_CLOSED` |
| 並行会話 | 明示的な所有権（lease）を持つ共有 1 面。自動横取りなし（`BROWSER_BUSY`） |
| DOM 参照 | 独自 `dom-v1` snapshot と世代付き ref（`b<ownership>-d<document>-n<node>`） |
| 公開しないもの | 任意コード実行、任意 selector、座標クリック、外部で開く |
| 認証 | `openExternal` は本機能の対象外 |

### 主な契約

- bounds: Renderer の CSS px に host zoom を掛けて DIP に変換し、`getContentBounds()` 内へ clamp。`devicePixelRatio` は掛けない。右パネル希望幅 320–960（既定 480、`lilto-browser-panel-width.v1`）、チャット最小 320。収まらなければ左サイドバーを閉じてブラウザを優先し、それでも不可ならブラウザを一時非表示にする。
- 所有権: `none | user | agent{conversationId, requestId, runId, leaseId}`。ユーザー操作は AI lease を先に失効させる。操作は単一キューで直列化し、実行前・非同期後・入力前に lease／epoch を再検証する。
- MCP: protocol `2025-06-18`、固定 16 tool、`additionalProperties:false`、成功は `structuredContent`＋JSON text、業務エラーは `isError`。
- Bridge: `127.0.0.1` ランダムポート、`POST /command` のみ、256 bit token（run 単位、Main が会話に結び付け）、Origin 付き拒否、Host 検証、body 64 KiB／response 2 MiB、同時数上限（429）。
- 設定反映（`enabled` 変更）: capability 発行停止 → 全 lease 失効 → 実行中断・クライアント終了 → cache 破棄 → skill policy 同期 → 保存 → Controller 移行。OFF 時は `mcp_servers.lilto_browser` を生成しない。
- Skill: ON の間は `<CODEX_HOME>/skills/.system/agent-browser/SKILL.md`（とユーザー領域の同名）を Lilto 管理ブロックで `enabled = false` にする。

## 検証結果と未検証の前提（実装時点）

実装環境はヘッドレス Linux VM だが Xvfb（`xvfb-run`）上で Electron 44.9.3 が起動できたため、Lilt UI を介さない範囲を実機で検証した。

検証済み（`scripts/verify-embedded-browser.js` 62 項目、`scripts/verify-app-server-mcp.js` 16 項目。いずれも `xvfb-run -a node_modules/.bin/electron --no-sandbox <script>`、結果は `test/artifacts/*.json`）:

- 実 `WebContentsView` で、ローカル fixture の表示、`window.lilto` 等の非公開、`file:`／`javascript:` の遷移拒否、popup の同一面遷移、ダウンロード取消、描画プロセスのクラッシュ後もホスト維持。
- snapshot の決定性、ref の維持、DOM 置換・意味変更・SPA 遷移・新 snapshot による `STALE_REF`、password／hidden の値非返却、open Shadow DOM、iframe の不透明化。
- 実入力: click の trusted `mousedown → mouseup → click`、日本語・controlled input・空文字・contenteditable・checkbox・select・Tab、遮蔽クリックの拒否と未送信。
- Electron 44 の `before-mouse-event`／`before-input-event` は `sendInputEvent` に対して発火し、予定入力（台帳）は消費され、台帳に無い入力はページ配送前に止めて手動切替になることを確認。
- 同梱 App Server（codex-cli 0.163.0）: `thread/start` が `config.mcp_servers` と `developerInstructions` を受け付け、`mcpServerStatus/list` で `lilto_browser` の 16 ツールを発見、`mcpServer/tool/call` で `acquire → snapshot → click → wait → screenshot（image content）` が成功。並行 run は別 token で `BROWSER_BUSY`／別 run の lease 利用拒否、run 終了で token が即失効。MCP child は本番と同じ `ELECTRON_RUN_AS_NODE=1`。`skills.config` の `enabled = false` により、ユーザー領域の同名 `agent-browser` が `skills/list` で無効、OFF で復帰。

未検証:

- Lit UI を含むライブ UI（左右パネルの操作、幅の復元、zoom、モーダルとの重なり、再起動後の復元）と `npm run e2e:electron`。GUI セッションのある環境で T15／T16 として実施する。
- 認証済みモデルがツールを選択して実行する経路（モデル非依存の App Server 経由呼び出しまでは確認済み）。
- macOS／Windows の生成物での MCP 起動（隔離した `app.asar.unpacked` 相当のレイアウトでの起動と、依存ファイルが `asarUnpack` に含まれることのテストまで）。
- **観察された逸脱リスク**: Codex 0.163.0 は初回起動時に `CODEX_HOME/skills/.system` を自前のシステム skill で再同期し、Lilt-o が置いた `.system/agent-browser` を削除した（検証用の空 CODEX_HOME での観察。既存の配置方式の副作用であり本変更の対象外）。このため同梱 `agent-browser` が Codex から見えない場合は無効化エントリは無害だが不要になる。ユーザー領域の同名 skill には無効化が実効することを確認済み。

## Risks

- 共有ブラウザは会話間の Cookie を分離しない（同じ実ユーザーのブラウザ扱い）。
- Skill 無効化はシェル実行の禁止ではなく、優先経路の置き換えである。
- Bridge はローカル悪意プロセスとの隔離を提供しない。
