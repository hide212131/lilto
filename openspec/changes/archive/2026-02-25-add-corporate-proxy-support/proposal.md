## Why

企業内ネットワークでは外部通信が Proxy サーバ経由に制限されることが多く、現状の実装ではその前提環境で Lilt AI が安定稼働できない。導入障壁を下げるため、Proxy 必須環境でも設定可能かつ検証可能な動作保証を今の段階で追加する。

## What Changes

- Settings の `Providers & Models` に Proxy 設定（HTTP/HTTPS/NO_PROXY 相当）を追加し、provider 設定と同様に保存・復元できるようにする。
- Main のエージェント実行経路で外部通信時に Proxy 設定を適用し、Proxy 必須環境でのみ外部アクセス可能な条件でも問い合わせを完遂できるようにする。
- 擬似的な「Proxy 経由でないと外部通信できない」E2E 検証を追加し、Proxy 設定ありで成功・なしで失敗することを完了条件として自動確認できるようにする。

## Capabilities

### New Capabilities
- なし

### Modified Capabilities
- `providers-models-settings`: Proxy 接続設定の入力・保存・復元・入力検証要件を追加する。
- `pi-main-agent-runtime`: 実行時に Proxy 設定を解決して外部通信へ適用する要件と、Proxy 未経由時の失敗ハンドリング要件を追加する。
- `electron-gui-e2e-validation`: Proxy 必須の擬似ネットワーク条件で GUI 経由の実行成功を検証する要件を追加する。

## Impact

- Affected code: `src/main/*`（実行経路・設定読込）、`src/renderer/*`（Settings UI）、`src/shared/*`（設定スキーマ）、`scripts/e2e-*` と `test/`（検証）
- Affected systems: Electron Main/Renderer 間 IPC、設定ファイル永続化、E2E 実行環境
- Dependencies: Node/Electron で Proxy 適用可能な HTTP クライアント設定（既存 fetch 実装との整合）
