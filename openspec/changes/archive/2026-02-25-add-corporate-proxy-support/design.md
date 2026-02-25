## Context

現行アプリは `providers-models-settings` で Claude / Custom Provider の切替設定を保持し、`pi-main-agent-runtime` が選択 provider に応じて Pi SDK 実行を行う。企業ネットワークでは外部通信が Proxy 経由に限定されるケースがあり、現状は Proxy 設定を UI で管理できず、実行経路への適用も保証されていない。さらに GUI E2E は通常ネットワーク前提のため、Proxy 必須条件での回帰検知ができない。

## Goals / Non-Goals

**Goals:**
- Settings で Proxy 情報（HTTP/HTTPS/NO_PROXY 相当）を入力・保存・復元できる。
- Main の外部通信経路で Proxy 設定を有効化し、Proxy 必須条件でも問い合わせを成功させる。
- 擬似 Proxy 必須環境を E2E で再現し、Proxy なし失敗 / Proxy あり成功を検証する。

**Non-Goals:**
- PAC/WPAD や NTLM/Kerberos など高度な企業認証方式への対応。
- OS 全体のプロキシ設定自動取り込み。
- すべてのスクリプトや開発補助コマンドへの Proxy 適用。

## Decisions

### 1) Proxy 設定は ProviderSettings に統合して永続化する
- 決定: `ProviderSettings` に `networkProxy`（`httpProxy`, `httpsProxy`, `noProxy`）を追加し、既存保存ファイル `.lilto-provider-settings.json` へ同居させる。
- 理由: provider 設定と同じライフサイクルで管理でき、UI と Main 間の IPC 契約を最小差分で拡張できる。
- 代替案:
  - 別ファイル管理: 責務分離は明確だが、読み込み順序・整合検証が増える。
  - 環境変数のみ: GUI 操作だけでは完結せず、企業ユーザーの導入手順が煩雑になる。

### 2) Main 実行時に Proxy 設定を SDK/HTTP 層へ注入する
- 決定: `agent-sdk` の実行開始前に Proxy 設定を解決し、外部通信クライアントへ反映する。未設定または無効値は「Proxy 無効」として扱う。
- 理由: 実行の責務が Main に集約されており、provider 分岐（Claude/Custom）を横断して一貫適用できる。
- 代替案:
  - Renderer で適用: セキュリティ境界を崩しやすく、Main 側実行との整合が悪い。
  - provider ごとの個別実装: 冗長で回帰ポイントが増える。

### 3) E2E は「擬似ゲートウェイ」で Proxy 必須条件を再現する
- 決定: テスト内でローカル擬似外部 API と擬似 Proxy を立て、直接アクセスを拒否し、Proxy 経由のみ通す構成にする。
- 理由: CI/ローカルで再現可能で、実ネットワーク依存を排除できる。
- 代替案:
  - 実際の社内 Proxy 接続: 再現性がなく、開発環境依存が強すぎる。
  - 単体テストのみ: UI〜Main 統合経路の保証が不足する。

## Risks / Trade-offs

- [Risk] Proxy URL の入力不備で通信不可になる → Mitigation: 保存時バリデーション（URL 形式、空文字許容ルール）とエラーメッセージを追加する。
- [Risk] Proxy 設定適用がプロセス全体に波及し副作用を生む → Mitigation: 実行スコープを明示し、終了時にクリーンアップ可能な実装にする。
- [Risk] E2E がネットワークタイミング依存で不安定化する → Mitigation: ローカルサーバ起動完了を明示待機し、ポート固定・タイムアウト調整を行う。

## Migration Plan

1. `ProviderSettings` 型・永続化スキーマに `networkProxy` を追加し、既存ファイルはデフォルト値で後方互換読み込みする。
2. Settings UI に Proxy 入力欄を追加し、保存/復元/検証を provider 設定保存フローへ統合する。
3. Main 実行経路で Proxy 設定を解決し、外部通信クライアントへ反映する。
4. 擬似 Proxy 必須 E2E を追加し、`npm run e2e:electron` に組み込む。
5. 失敗時は `networkProxy` の適用箇所を feature flag で無効化可能な構成を残し、既存通信経路へロールバックできるようにする。

## Open Questions

- Proxy 認証情報（`user:pass@host`）を初期スコープで許可するか、次フェーズへ分離するか。
- `NO_PROXY` の解釈を単純なカンマ区切り一致に限定するか、ワイルドカード/ドメインサフィックスまでサポートするか。
