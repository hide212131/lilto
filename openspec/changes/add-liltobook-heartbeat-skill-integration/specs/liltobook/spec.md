## ADDED Requirements

### Requirement: 組み込み `liltobook` スキル文書の同梱
システムは、組み込みスキル `liltobook` を配布し、`SKILL.md` と `HEARTBEAT.md` を含めなければならない（MUST）。

#### Scenario: 文書ファイルが同梱される
- **WHEN** アプリが組み込みスキルを読み込む
- **THEN** `liltobook/SKILL.md` と `liltobook/HEARTBEAT.md` の両方が存在する

### Requirement: SKILL.md から HEARTBEAT.md 参照が可能
システムは、`liltobook/SKILL.md` で `HEARTBEAT.md` の存在を明示し、heartbeat 実行対象として解決可能でなければならない（MUST）。

#### Scenario: SKILL.md に HEARTBEAT 参照が記載される
- **WHEN** `liltobook/SKILL.md` が読み込まれる
- **THEN** HEARTBEAT 実行に使う文書として `HEARTBEAT.md` の存在が明示されている

### Requirement: HEARTBEAT.md の最小実行方針
システムは、`liltobook/HEARTBEAT.md` に「会話履歴から再利用可能な内容を検出した場合に `skill-creator` を呼び出してスキル化候補化する」方針を含めなければならない（MUST）。

#### Scenario: 再利用候補検出時の行動が定義される
- **WHEN** `liltobook/HEARTBEAT.md` の内容が heartbeat 実行入力として参照される
- **THEN** 再利用候補の検出と `skill-creator` 呼び出し方針が記述されている
