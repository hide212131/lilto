## MODIFIED Requirements

### Requirement: scheduler 発火イベントを対象セッションへ配送できる
システムは、scheduler daemon から発火イベントを受信したとき、payload に含まれる `sessionId` を解決し、対象セッションに対するバックエンド処理を開始できなければならない（MUST）。`notificationDecisionCriteria` を持たない通常の schedule では、従来どおり対象チャットへ通知を追加しなければならない（MUST）。`notificationDecisionCriteria` を持つ schedule では、LLM による通知判定が完了するまでチャット通知、OS 通知、未読バッジ更新を行ってはならない（MUST NOT）。アプリが非フォーカス時は、通知必要と判定された場合に限って OS 通知と未読バッジも更新しなければならない（MUST）。

#### Scenario: 発火イベントが条件なし schedule として通常通知される
- **WHEN** Main が `notificationDecisionCriteria` を持たない scheduler 発火イベントを受信する
- **THEN** システムは対象 session のチャットへ通知メッセージを追加する

#### Scenario: 条件付き schedule は判定完了まで表示しない
- **WHEN** Main が `notificationDecisionCriteria` を持つ scheduler 発火イベントを受信する
- **THEN** システムはユーザー向け通知を即時表示せず、まずバックエンド follow-up と通知判定を進める

#### Scenario: 通知必要と判定された場合だけ OS 通知も出る
- **WHEN** 条件付き schedule の最終判定が通知必要で、かつアプリウィンドウが非フォーカス状態である
- **THEN** システムはチャット反映に加えてデスクトップ通知と未読バッジ更新を行う

#### Scenario: 通知不要と判定された場合はユーザー向け表示を行わない
- **WHEN** 条件付き schedule の最終判定が通知不要である
- **THEN** システムはチャット、OS 通知、未読バッジのいずれも更新しない

### Requirement: Main プロセスは scheduler follow-up 情報を Renderer へ渡せる
システムは、scheduler 発火イベントに follow-up 指示が含まれる場合、その情報を Renderer または Main の follow-up 実行経路へ渡し、同一会話でバックエンド処理を継続できなければならない（MUST）。さらに `notificationDecisionCriteria` がある場合、システムは follow-up 実行結果、元の通知文言、判断基準を使った専用の通知判定 prompt を実行し、少なくとも `shouldNotify` とユーザー向け通知文を含む構造化結果へ変換できなければならない（MUST）。判定結果の parse に失敗した場合は、安全側として通知する動作へフォールバックしなければならない（MUST）。

#### Scenario: follow-up 実行結果を通知判定へ渡す
- **WHEN** Renderer または Main が `notificationDecisionCriteria` を持つ scheduler follow-up を実行する
- **THEN** システムはその follow-up の結果を通知判定 prompt へ渡す

#### Scenario: 判定結果が構造化されて通知文面を返す
- **WHEN** 通知判定 prompt が成功する
- **THEN** システムは `shouldNotify` とユーザー向け通知文を含む構造化結果として扱う

#### Scenario: 判定 parse 失敗時は通知にフォールバックする
- **WHEN** 通知判定 prompt の応答が構造化結果として解釈できない
- **THEN** システムは通知必要として扱い、通知文言または失敗を要約した文面をユーザーへ返す

#### Scenario: 条件付き schedule でも follow-up が不要なら従来経路を維持する
- **WHEN** scheduler 発火イベントが `notificationDecisionCriteria` を持つが `followUpInstruction` は持たない
- **THEN** システムは follow-up 実行結果前提の判定を必須にせず、通常通知または既定経路を継続する