## MODIFIED Requirements

### Requirement: スケジュールは通知先セッション情報を保持する
システムは、登録される各スケジュールに通知先 `sessionId` と完了メッセージを保存しなければならない（MUST）。発火後に AI が続けて実行すべき処理がある場合は、その follow-up 指示も保存できなければならない（MUST）。さらに、発火後の処理結果を見て通知要否を判断するための `notificationDecisionCriteria` を任意で保存できなければならない（MUST）。通知判断基準が保存されていない schedule は、発火のたびに毎回通知する既定動作として扱わなければならない（MUST）。通知先のない schedule を受け付けてはならない（MUST NOT）。

#### Scenario: 通知先付きで登録される
- **WHEN** AI が `sessionId` と完了メッセージを含むスケジュール登録を行う
- **THEN** システムはその payload を schedule 定義と一緒に永続化する

#### Scenario: follow-up 指示付きで登録される
- **WHEN** AI が発火後に実行すべき follow-up 指示を含むスケジュール登録を行う
- **THEN** システムはその follow-up 指示を schedule payload に保持する

#### Scenario: 通知判断基準付きで登録される
- **WHEN** AI が `notificationDecisionCriteria` を含むスケジュール登録を行う
- **THEN** システムはその判断基準を schedule payload に保持する

#### Scenario: 通知判断基準が無い登録は毎回通知扱いになる
- **WHEN** AI が `notificationDecisionCriteria` を含めずにスケジュール登録を行う
- **THEN** システムはその schedule を毎回通知する既定動作として保存する

#### Scenario: 通知先が欠けている登録を拒否する
- **WHEN** AI が `sessionId` または完了メッセージを欠いた schedule 登録を行う
- **THEN** システムは登録を拒否し、入力不足を示すエラーを返す

### Requirement: follow-up 指示があれば AI が通知後の処理を継続できる
システムは、schedule 発火イベントに follow-up 指示が含まれる場合、まずその指示に基づくバックエンド処理を同一会話コンテキストで実行できなければならない（MUST）。`notificationDecisionCriteria` が含まれる場合、システムは follow-up の処理結果と通知文言と判断基準を使って、ユーザーへ通知するかどうかを LLM が判定できるようにしなければならない（MUST）。判定結果が通知不要である場合、システムはユーザー向け通知を行ってはならない（MUST NOT）。`notificationDecisionCriteria` が無い場合は、従来どおり毎回通知しなければならない（MUST）。

#### Scenario: 通知条件付きで follow-up 実行後に通知要否を判定する
- **WHEN** `followUpInstruction` と `notificationDecisionCriteria` を持つ schedule が発火する
- **THEN** システムは follow-up 実行結果を使って LLM 判定を行い、通知必要と判断された場合だけユーザー向け通知を生成する

#### Scenario: 通知不要と判定された場合は静かに終了する
- **WHEN** `notificationDecisionCriteria` を持つ schedule の follow-up 実行後に LLM が通知不要と判定する
- **THEN** システムはチャット通知も OS 通知も出さずに処理を終了する

#### Scenario: 判断基準がない場合は follow-up 後も毎回通知する
- **WHEN** `followUpInstruction` を持つ schedule が発火したが `notificationDecisionCriteria` は保存されていない
- **THEN** システムは follow-up 実行後に毎回ユーザー向け通知を行う

#### Scenario: follow-up 指示がない場合は既存どおり通知のみで終わる
- **WHEN** `followUpInstruction` を持たない schedule が発火する
- **THEN** システムは通知文言のみを扱い、追加の通知判定フローを必須にしない