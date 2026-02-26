## MODIFIED Requirements

### Requirement: 登録ジョブの順次実行
システムは、ハートビート tick ごとに有効な登録ジョブを順次実行しなければならない（MUST）。`liltobook` が有効な場合、システムは `liltobook/HEARTBEAT.md` を `pi-coding-agent` に入力として渡して heartbeat ジョブとして実行しなければならない（MUST）。

#### Scenario: 有効ジョブのみ実行される
- **WHEN** tick 発火時に複数ジョブが登録されている
- **THEN** 有効フラグが true のジョブだけが実行される

#### Scenario: liltobook HEARTBEAT が実行される
- **WHEN** tick 発火時に `liltobook` heartbeat ジョブが有効である
- **THEN** システムは `HEARTBEAT.md` の内容を `pi-coding-agent` に読み込ませて実行する
