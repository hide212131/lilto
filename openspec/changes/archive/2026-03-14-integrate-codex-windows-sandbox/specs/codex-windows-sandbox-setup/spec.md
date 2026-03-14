## ADDED Requirements

### Requirement: Windows sandbox セットアップ開始導線
システムは、Windows 上でユーザーが Codex Windows sandbox モードを `unelevated` または `elevated` に保存したとき、Codex app-server の `windowsSandbox/setupStart` を呼び出してセットアップを開始しなければならない（MUST）。セットアップ対象の `cwd` には lilto の現在のワークスペースを渡さなければならない（MUST）。

#### Scenario: elevated モード保存時に setup が始まる
- **WHEN** Windows 上のユーザーが Settings で Windows sandbox モードを `elevated` に変更して保存する
- **THEN** システムは `windowsSandbox/setupStart` を `mode = elevated` で呼び出す

#### Scenario: unelevated モード保存時に setup が始まる
- **WHEN** Windows 上のユーザーが Settings で Windows sandbox モードを `unelevated` に変更して保存する
- **THEN** システムは `windowsSandbox/setupStart` を `mode = unelevated` で呼び出す

### Requirement: セットアップ結果の UI 反映
システムは、Windows sandbox セットアップの完了・失敗・キャンセル結果を Settings UI へ返し、ユーザーが再試行または設定変更を判断できる状態文言を表示しなければならない（MUST）。

#### Scenario: setup 完了が設定画面へ反映される
- **WHEN** app-server から `windowsSandbox/setupCompleted` の成功結果が返る
- **THEN** Settings UI は Windows sandbox が利用可能になった旨を表示する

#### Scenario: setup 失敗が設定画面へ反映される
- **WHEN** app-server から setup 失敗結果が返る
- **THEN** Settings UI は失敗理由を表示し、再試行可能であることを示す

#### Scenario: setup キャンセルが設定画面へ反映される
- **WHEN** ユーザーが UAC またはセットアップ処理をキャンセルする
- **THEN** Settings UI はキャンセルを明示し、Windows sandbox を未有効として扱う

### Requirement: セットアップ失敗時の安全側フォールバック
システムは、Windows sandbox セットアップが失敗またはキャンセルされた場合、未完了の sandbox モードを実行設定として保持し続けてはならない（MUST NOT）。失敗後は `off` へ戻す、または同等に次回実行失敗を防ぐ安全側の状態へ遷移しなければならない（MUST）。

#### Scenario: setup 失敗時に `off` へ戻る
- **WHEN** Windows sandbox 設定保存後の setup が失敗する
- **THEN** システムは保存済み設定を `off` 扱いへ戻し、次回送信で sandbox 前提実行を行わない

#### Scenario: setup キャンセル時に再送信失敗を防ぐ
- **WHEN** Windows sandbox 設定保存後の setup がキャンセルされる
- **THEN** システムは未完了設定のまま prompt 実行へ進ませない