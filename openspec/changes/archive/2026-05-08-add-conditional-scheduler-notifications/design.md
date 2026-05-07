## Context

現在の scheduler 発火処理は、発火イベントを受けた時点で Renderer が即座に会話へ通知文言を書き込み、`followUpInstruction` があればその後で LLM に続きを実行させる構成です。このため、バックエンドで静かに処理したいジョブでも必ず画面と OS 通知に変化が出ます。

今回の変更では、cron 登録時に「どのような結果なら通知するか」という判断基準を保存し、発火後のバックエンド処理結果を使って LLM が通知要否を決められるようにする必要があります。一方で、既存のスケジュールや判断基準を持たない新規スケジュールでは、現在どおり毎回通知する後方互換性を維持する必要があります。

## Goals / Non-Goals

**Goals:**
- scheduler 発火時に、不要なケースでは UI と OS 通知へ何も出さずにバックエンド処理だけ完了できるようにする
- cron 登録時に通知判断基準を保持し、発火後の処理結果を入力として LLM が通知要否を決められるようにする
- 判断基準が無い既存スケジュールでは、毎回通知する既定動作を維持する
- scheduler follow-up の visible message 生成を構造化し、通知可否判定と通知文面生成を曖昧な自然言語解釈に依存しすぎないようにする

**Non-Goals:**
- scheduler daemon 自体へ LLM を組み込むこと
- Settings 画面で通知判断基準を編集する UI を追加すること
- heartbeat assistant の internal schedule 振る舞いを変更すること

## Decisions

### 1. スケジュール payload に通知判断基準を追加する
`SchedulerCreateInput.notification` に `notificationDecisionCriteria` を追加し、`cron` tool から保存できるようにします。高水準 operation と低水準 operation のどちらでも任意指定可能にし、未指定時は `undefined` のまま保存します。

これにより、通知可否の基準を scheduler 登録時の契約として残せます。代替案として「follow-up prompt 内に毎回判断基準を書き直す」方法もありますが、LLM が登録時の意図を安定して再現できず、再起動後や一覧管理時にも基準が追跡できません。

### 2. 発火時は即時表示せず、まずバックエンド follow-up を完走させる
通常の scheduler 発火では、Renderer はイベント受信直後に会話へ system message や pending message を追加しません。代わりに、Main/Renderer の scheduler follow-up 経路を「非表示のバックエンド実行」として扱い、`followUpInstruction` がある場合はその結果を収集してから通知判定へ進みます。

代替案として Main で即時通知だけ抑止し、Renderer では従来どおり pending message を出す案もありますが、ユーザー要件である「画面上何も変化がないようバックエンドで動く」に反します。そのため、処理中インジケータも出さない方針を採用します。

### 3. 通知判定は follow-up 実行結果を渡した専用 LLM 判定 prompt で行う
`notificationDecisionCriteria` があるスケジュールでは、follow-up 実行の最終結果、発火通知文言、判断基準をまとめて LLM に渡し、構造化された判定結果を返させます。判定結果は少なくとも `shouldNotify`、`userMessage`、`reason` を含む JSON 互換の固定フォーマットにします。

代替案として follow-up 実行 prompt と通知判定を 1 回の自然言語応答へまとめる方法もありますが、実行結果と最終表示文を同じ自由文で扱うと、通知不要ケースでも中間文がそのまま UI へ漏れやすくなります。判定ステップを分けることで、非表示の実行結果とユーザー向け表示を分離します。

### 4. 判断基準が無い場合は従来どおり毎回通知する
`notificationDecisionCriteria` が空なら、通知判定ステップを通さず既存互換の通知を行います。`followUpInstruction` がある場合も、従来同様に結果を会話へ出すか、少なくとも発火通知を毎回出します。

代替案として「判断基準が無くても LLM に通知有無を推測させる」方法もありますが、既存のスケジュールで静かな失敗が起きる後方互換性リスクが大きいため採用しません。

### 5. 通知反映は判定結果が `shouldNotify=true` のときだけ行う
Renderer へのチャット追記、Main の OS 通知、未読バッジ更新は、最終的な判定結果が通知必要と示した場合に限って実行します。`shouldNotify=false` のときは、ログや内部 event には結果を残しても、ユーザー向け表示経路へは流しません。

これにより「通知不要なら何も通知せず終了する」という要件を UI と OS の両方で満たします。

## Risks / Trade-offs

- [Risk] follow-up 実行が失敗した場合に通知判定へ渡す結果が曖昧になる → Mitigation: 実行失敗も構造化結果として判定 prompt へ渡し、判断基準がある場合でも最低限 `errorSummary` を含める
- [Risk] LLM 判定の自由度が高すぎると `shouldNotify` の解釈がぶれる → Mitigation: JSON 互換の固定出力形式と明示的な true/false を要求し、parse 失敗時は安全側の毎回通知へフォールバックする
- [Risk] visible message を消すことでユーザーが「何も起きていない」と感じる可能性がある → Mitigation: この挙動は通知判断基準を明示したスケジュールに限定し、既定は毎回通知のまま維持する
- [Risk] heartbeat internal schedule に新挙動が混入する → Mitigation: internal schedule ID 経路は従来どおり専用ハンドラで早期分岐し、条件付き通知判定の対象外にする

## Migration Plan

1. scheduler 共有型と cron tool schema に `notificationDecisionCriteria` を追加する
2. scheduler follow-up 実行を visible UI 更新から分離し、非表示実行結果を取得できるようにする
3. 条件付き通知判定 prompt と結果 parser を追加し、criteria ありの schedule だけ通知有無を分岐する
4. criteria なしの schedule が従来どおり毎回通知される回帰テストを追加する
5. 既存保存データは `notificationDecisionCriteria` 欠如のまま読み込み、追加 migration は行わず既定動作で扱う

ロールバック時は `notificationDecisionCriteria` を無視し、発火時に即時通知する旧経路へ戻せます。既存データに追加フィールドが残っても旧実装は無視できます。

## Open Questions

- follow-up 実行結果から LLM 判定へ渡す入力を「最終テキストだけ」にするか、「tool 実行結果の要約」まで含めるかは実装時に最小十分な範囲を決める必要がある