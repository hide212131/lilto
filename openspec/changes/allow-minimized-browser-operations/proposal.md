## Why

内蔵ブラウザの操作は「ウィンドウが可視・フォーカス済みであること」を前提にしており、ウィンドウを最小化すると AI の作業が止まり、lease も失効する（Issue #42）。2026-11-12 の製品オーナー決定により、**最小化・非フォーカス・他ウィンドウによる遮蔽の間も全ツール操作を許可する**。#38（evaluate）と同時に導入された「見えない状態では操作しない」前提を、この三つの状態について意図的に変更する。

## What Changes

- 最小化・表示中の非フォーカス・他ウィンドウによる完全遮蔽では全ツールを許可し、lease・ビュー・レイアウト・epoch を維持する。OS ウィンドウのフォーカスは操作条件から外す（`WINDOW_NOT_FOCUSED` は型の互換性のため残すが返さない）。
- 明示的 hide（閉じるボタンによる常駐化）、画面ロック、OS suspend は従来どおり操作不可で lease を失効する（新コード `SYSTEM_LOCKED`／`SYSTEM_SUSPENDED`）。アプリ内モーダル・リサイズは `PANEL_OCCLUDED` を維持する。
- `panelVisible` の意味は変えず、操作可能性を `operationReady`、最小化を `windowMinimized` として state と `browser_status` に分離する。最小化中は `panelVisible=false` かつ `operationReady=true` が成立する。
- パネル閉鎖時は autoOpen が有効なら最小化したまま論理的に開いて操作面を準備する（準備できなければ `PANEL_NOT_READY`）。無効なら `PANEL_CLOSED`。
- AI の使用期間中は、ページ面とホスト renderer の background throttling を無効化し、lease の終了・失効で復元する。
- screenshot は現在のページ面だけを返す。フレームが生成されない・取得に失敗した場合は `SCREENSHOT_UNAVAILABLE` を返し、古い画像の代用やウィンドウの自動復帰は行わない。
- Codex 向け案内とツール説明を更新する。

#34 の `browser_evaluate` の条件（`evaluateEnabled`・lease・`documentEpoch`・frame 世代・上限・自動再試行禁止）と、#43（指示のライフサイクル）の requirement は変更しない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `embedded-browser-agent-tools`: 共通ゲート・lease の失効条件・state・エラーコード・screenshot・背景実行。
- `embedded-browser-panel`: 表示と操作面の分離、autoOpen、最小化・復帰時の同期。

## Impact

- `src/main/embedded-browser.ts`、`embedded-browser-electron.ts`、`index.ts`、`browser-page-runtime.ts`、`browser-tool-contract.ts`、`agent-sdk-config.ts`、`src/shared/browser.ts`、`src/renderer/browser-layout.ts`。
- テスト、`scripts/verify-embedded-browser.js`、`scripts/verify-app-server-mcp.js`、`scripts/probe-minimized-browser.js`（新規）、`.github/workflows/quality-gate.yml`。
