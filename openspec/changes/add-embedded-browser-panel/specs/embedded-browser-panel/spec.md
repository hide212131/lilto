## ADDED Requirements

### Requirement: 右サイドパネルに共有 1 面のブラウザを表示する
アプリは右側の開閉・リサイズ可能なパネルに、Main が管理する 1 面の `WebContentsView` を表示しなければならない（SHALL）。ページ View はページ用 viewport の矩形のみに配置し、ツールバーとチャットを覆ってはならない（SHALL NOT）。

#### Scenario: 幅の保存と制約
- **WHEN** ユーザーが右ハンドルをドラッグまたは左右キーで変更する
- **THEN** 希望幅（320〜960、既定 480）を `lilto-browser-panel-width.v1` に保存し、ウィンドウ縮小では保存値を書き換えない
- **THEN** チャットは最小 320 を確保し、足りない場合は左サイドバーを閉じてブラウザを優先する

#### Scenario: 収まらない場合
- **WHEN** チャット 320 とブラウザ 320 を確保できない
- **THEN** ブラウザを一時非表示にして「ウィンドウを広げてください」を表示し、全面オーバーレイに戻さない

#### Scenario: モーダル表示
- **WHEN** 設定・更新ダイアログ等を表示する
- **THEN** Main が View を隠した ACK 後にモーダルを描画し、閉じた後に有効な bounds を受信してから再表示する

### Requirement: ツールバーと所有権表示
パネルは戻る・進む・再読み込み・アドレス・外部で開く・閉じる・手動操作切替／AI 許可を提供しなければならない（SHALL）。アドレスは完全な HTTP(S) URL のみ受け付ける。

#### Scenario: AI 所有中のユーザー操作
- **WHEN** AI が所有中にユーザーが戻る・進む・再読み込み・アドレス入力・リンクを操作する
- **THEN** 先に lease を失効してから操作を実行する

### Requirement: リンクは右パネルへ一本化する
ホストの HTTP(S) リンクと `target="_blank"` は右パネルに表示しなければならない（SHALL）。旧全面オーバーレイ・ツールバー View・`lilto.invalid` 疑似 URL を持ってはならない（SHALL NOT）。

#### Scenario: 内蔵ブラウザ OFF
- **WHEN** `browserSettings.enabled` が false でリンクを開く
- **THEN** 検証済み HTTP(S) URL を外部ブラウザで開き、View を作らない。非 HTTP(S) は拒否する

### Requirement: ページ View の安全境界
ページ View は `sandbox`、`contextIsolation`、preload なし、partition `lilto-links`、権限既定拒否、download 取消、popup 拒否（HTTP(S) は同一面へ遷移）でなければならない（SHALL）。

#### Scenario: 非 HTTP(S)
- **WHEN** `file:`／`javascript:`／`data:`／`blob:`／認証情報付き URL への遷移が要求される
- **THEN** `loadURL`・`will-navigate`・`will-redirect`・popup の各境界で拒否する
