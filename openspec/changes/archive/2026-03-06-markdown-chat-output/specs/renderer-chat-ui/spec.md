## ADDED Requirements

### Requirement: チャットメッセージを Markdown でレンダリングできる
システムは、アシスタントおよびユーザーのメッセージを Markdown としてパースし、見出し・リスト・コードブロック・リンク・テーブル・引用などのリッチ書式を UI 上で描画しなければならない（MUST）。

#### Scenario: Markdown を含むメッセージが表示される
- **WHEN** renderer がテキストに Markdown 記法（見出し・リスト・コードブロック等）を含むメッセージを受信する
- **THEN** UI はそのテキストを Markdown としてパースし、対応する HTML 要素でレンダリングする

### Requirement: Markdown 内リンクを外部ブラウザでセキュアに開ける
システムは、チャット内の Markdown リンクをクリックしたとき、Electron のデフォルトナビゲーションを抑制し、http/https URL のみを OS 標準の外部ブラウザで開かなければならない（MUST）。

#### Scenario: http/https リンクをクリックした場合
- **WHEN** ユーザーがチャット内の `http://` または `https://` スキームのリンクをクリックする
- **THEN** Electron 内部ではナビゲーションは発生せず、OS 標準のブラウザで該当 URL が開かれる
