## ADDED Requirements

### Requirement: ブラウザ指示は状態が変わったときだけ turn 単位で送る
通常会話の run は、内蔵ブラウザの現在状態（連携 ON/OFF・実効 evaluate・完成文面の SHA-256）を `turn/start` の application additionalContext で伝えなければならない（SHALL）。送信するのは、そのスレッドに最後に伝えて確定した状態と異なる場合、または状態が不明な場合に限らなければならない（SHALL）。新規スレッドも初回ターンで送り、`thread/start`／`thread/resume` の `developerInstructions` をこの目的に使ってはならない（SHALL NOT）。状態が変わった場合は差分ではなく、単独で完結するフル文面を送らなければならない（SHALL）。文面は、以前の lilto のブラウザ指示だけを失効させ、他の指示や権限を上書きしてはならない（SHALL NOT）。

ブラウザ OFF 中の evaluate 設定変更は状態の変化としてはならない（SHALL NOT）。文面を改訂した場合は、各スレッドの次の通常会話で一度だけ再送しなければならない（SHALL）。

#### Scenario: 旧履歴の回復
- **WHEN** ON で作成され旧禁止文と拒否応答が残る既存スレッドを、設定 OFF のまま続ける
- **THEN** 最初の通常ターンで OFF のフル文面を一度送り、外部ブラウザ作業を旧禁止文を理由に拒否しない
- **AND** スレッドの作り直しを要求しない

#### Scenario: 再 ON
- **WHEN** 同じスレッドで設定を ON に戻して続ける
- **THEN** ON のフル文面（evaluate の有効・無効を含む）を一度送り、`lilto_browser` 以外の外部ブラウザ経路を使わない指示が復帰する

#### Scenario: 状態が変わらない
- **WHEN** 確定済みの状態と同じ状態で次のターンを送る
- **THEN** additionalContext を付けず、モデル入力の状態項目は増えない

### Requirement: 送信済み状態は thread 単位で永続化し障害時は不明として扱う
lilto は、最後に伝えた状態を Codex Home と実際の Codex thread ID の組ごとに永続化しなければならない（SHALL）。ターン開始前に pending を保存し、保存できない場合はターンを開始してはならない（SHALL NOT）。正常完了後にのみ確定とし、失敗・中断・接続断・クラッシュ後の pending・確定保存の失敗は状態不明として次の通常ターンで再送しなければならない（SHALL）。失敗した更新の前の確定状態へ戻してはならない（SHALL NOT）。記録の欠落・破損・未知の schema・不正なレコードは状態不明として扱わなければならない（SHALL）。

同じ backend thread に対する並行 run は拒否しなければならない（SHALL）。完了の書込は attempt ID と generation が一致する場合に限り、遅れて完了した古い run が新しい記録を上書きしてはならない（SHALL NOT）。記録に token・認証情報・ページ内容・会話本文を含めてはならない（SHALL NOT）。

#### Scenario: アプリ再起動
- **WHEN** 圧縮なしでアプリを再起動し、同じ状態で同じスレッドを続ける
- **THEN** 確定状態が復元され、additionalContext は送られない

#### Scenario: 通信失敗
- **WHEN** 更新を送ったターンが失敗・中断される
- **THEN** 次の通常ターンで現在状態のフル文面を再送する

### Requirement: 履歴の圧縮を跨いで状態を保証する
Codex が会話履歴を圧縮すると状態項目が入力から失われるため、managed run は `contextCompaction` の開始通知を受けた時点で `turn/interrupt` により継続前に止め、当該スレッドを状態不明に戻さなければならない（SHALL）。圧縮を観測したターンを確定にしてはならない（SHALL NOT）。次の通常ターンでフル文面を再送しなければならない（SHALL）。

#### Scenario: 圧縮の検知
- **WHEN** 実行中のターンで圧縮が始まる
- **THEN** 圧縮後のモデル要求より前にターンを止め、再送信を促すエラーを表示する
- **AND** 次のターンで状態のフル文面を送る

### Requirement: 対象外 run と capability 発行不能時の扱い
heartbeat・freshContext・実効 ephemeral・内部 service（`lilto-background`）・会話 ID なしの run は、指示を送らず状態を記録してはならない（SHALL NOT）。永続的な通常会話を継続する scheduler follow-up は通常会話と同じ扱いとする。ブラウザ設定が ON なのに capability を発行できない場合（bridge 停止・発行失敗・設定適用中）は、OFF とみなしてはならず（SHALL NOT）、ターン・OFF の打消し・状態の記録をせず run を失敗させなければならない（SHALL）。

#### Scenario: 発行不能
- **WHEN** ON で bridge が停止している
- **THEN** turn を開始せず、状態を記録せず、利用不能を示すエラーで失敗する
