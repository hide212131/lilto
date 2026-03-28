## Context

現在の scheduler 管理機能は `SchedulerService` と `cron` MCP tool に集約されており、AI からは一覧取得と削除ができます。一方で Renderer 側には scheduler 一覧取得・削除用の直接 IPC がなく、`lilt-settings-modal` も `Providers & Models`、`Chat`、`Agent Skills` のみを前提に構成されています。

今回の変更では、AI が登録した schedule をユーザー自身が Settings から監査し、不要なものを削除できるようにします。既存 scheduler 永続化や MCP tool の責務は維持しつつ、Main/preload/Renderer に UI 管理用の薄い読み書き経路を追加する必要があります。

## Goals / Non-Goals

**Goals:**
- Settings モーダルから有効な schedule 一覧を取得し、表示できるようにする。
- Settings モーダルから schedule を削除し、成功時に一覧を即時更新する。
- 既存 `SchedulerService` と `SchedulerScheduleSummary` を再利用し、永続化形式や daemon プロトコルを変えずに実現する。
- 失敗時にモーダル内で再試行や原因把握ができる状態文言を出す。

**Non-Goals:**
- Settings から schedule を新規作成・編集する UI は追加しない。
- scheduler daemon の保存形式や `cron` MCP tool の schema 自体は変更しない。
- 会話タイトル解決や高度なフィルタリングなど、一覧の利便性向上は今回の範囲に含めない。

## Decisions

### 1. Renderer は `cron` MCP tool を経由せず Main IPC で scheduler を直接参照する
- 採用: `scheduler:listSchedules` と `scheduler:deleteSchedule` に相当する Main IPC を追加し、preload から Renderer へ公開する。
- 理由: Settings UI は AI セッションの有無に依存せず、確定的に一覧取得・削除できる必要があります。`cron` MCP tool を UI から再利用すると、agent runtime 起動状態、sessionId 注入、MCP bridge 可用性へ不要に結合します。
- 代替案: `cron` tool の `list` / `delete` を Renderer から呼ぶ案は、UI 管理操作に AI 用 transport を流用することになり責務が不自然なため採用しません。

### 2. Settings 内には独立した `Schedules` タブを追加する
- 採用: `Providers & Models` に押し込まず、既存の `Chat` / `Agent Skills` と並ぶ独立タブとして `Schedules` を追加する。
- 理由: provider 設定画面は認証、モデル、Proxy、Windows sandbox で既に密度が高く、schedule 管理を同一タブへ混在させると役割が曖昧になります。スケジュール一覧は「運用管理」の性質が強いため、独立導線の方が見つけやすく保守もしやすいです。
- 代替案: `Providers & Models` 内の下部セクションへ追加する案は、情報量の増加で既存設定導線を圧迫するため採用しません。

### 3. 一覧はグローバルな有効 schedule を表示し、表示整形は Renderer で行う
- 採用: `SchedulerService.listSchedules()` が返す `SchedulerScheduleSummary[]` をそのまま UI 契約として使い、Renderer 側で `kind`、`nextRunAt`、`runAt`、`cronExpr` を整形表示する。
- 理由: 「現在設定されている cron」の確認用途では、現行会話に限定せず全 schedule を見られる方が期待に合います。既存 summary には一覧に必要な情報が揃っており、新しい変換 DTO を増やす必要がありません。
- 代替案: current session のみ表示する案は、Settings から全体管理したい用途を満たさないため採用しません。

### 4. 一覧の更新は `Schedules` タブ表示時と削除成功後に再取得する
- 採用: タブ切り替え時に一覧取得を行い、削除成功後は同じ API を再実行して表示を同期する。
- 理由: scheduler の状態変化源は AI 実行や再起動復元を含み、Renderer 側で完全なキャッシュ整合を持つ価値が低いです。再取得ベースにすると実装が単純で、状態不整合も減らせます。
- 代替案: local state の楽観更新のみで整合を保つ案は、他経路で変化した schedule を取り逃がすため採用しません。

## Risks / Trade-offs

- [Risk] scheduler daemon が未起動または利用不可のとき一覧取得が失敗する → Mitigation: Main で標準化したエラー文字列を返し、Settings 側に空表ではなく失敗状態を表示する。
- [Risk] schedule 件数が増えると Settings モーダル内の一覧が縦に長くなる → Mitigation: 今回はスクロール可能な一覧に留め、検索や折りたたみは将来拡張へ分離する。
- [Risk] `sessionId` は人間にとって分かりやすい表示名ではない → Mitigation: 今回は schedule の識別と削除を優先し、表示文言では `sessionId` を補助情報として扱う。

## Migration Plan

1. Main/preload に scheduler 一覧取得・削除 IPC を追加する。
2. Renderer 型定義と `lilt-settings-modal` に `Schedules` タブ、一覧 UI、削除ハンドラを追加する。
3. Settings UI 契約テストと scheduler UI 契約テストを更新する。
4. ロールバック時は新規 IPC と `Schedules` タブを除去すればよく、scheduler 永続化データの移行は不要。

## Open Questions

- なし。初版は一覧表示と削除に限定し、編集 UI や会話タイトル解決は将来の別 change として扱います。