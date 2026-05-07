# pi-main-agent-runtime Specification

## Purpose
TBD - created by archiving change add-pi-sdk-main-process-agent. Update Purpose after archive.
## Requirements
### Requirement: Main プロセスでの Pi SDK 実行
システムは、Electron Main プロセス内で OpenAI Codex TypeScript SDK を初期化し、ユーザー問い合わせの実行を同一プロセスで完結しなければならない（MUST）。また、Codex SDK 初期化時には Electron 親プロセスの生 `process.env` をそのまま使うのではなく、Codex 実行向けに正規化・補完した environment を `new Codex({ env })` へ渡さなければならない（MUST）。Windows では `PATH` を含む標準環境変数を persistent な User/Machine 環境から補完できなければならず（MUST）、補完後も `CODEX_HOME`、packaged Codex binary path、bridge 用 env など lilto 管理 override が優先されなければならない（MUST）。また、OS ごとのコマンド実行差異を吸収し、Windows でも同一機能が動作する実行方式を選択しなければならない（MUST）。Windows sandbox モードが有効な Windows 環境では、Codex thread 起動時に `workspace-write` を選択し、Codex config override として `windows.sandbox` を渡して Windows sandbox backend が選択可能な起動条件を満たさなければならない（MUST）。

#### Scenario: Main で Codex SDK が実行される
- **WHEN** Renderer から問い合わせ要求が `submitPrompt` で送信される
- **THEN** Main は OpenAI Codex TypeScript SDK を直接呼び出して処理を開始する

#### Scenario: Windows で互換実行経路が選択される
- **WHEN** Main が Windows 上でエージェント実行に必要なローカルコマンド実行を行う
- **THEN** システムは `.cmd` シム優先などの互換経路を用いて実行を継続する

#### Scenario: Electron 起動時でも Codex 用 environment が正規化される
- **WHEN** Electron が Explorer など対話 shell 外の起動元から開始され、`process.env` の `PATH` や標準環境変数が対話 shell と一致しない可能性がある
- **THEN** Main は Codex 起動前に environment を正規化し、補完済みの `PATH` と必要な標準変数を `new Codex({ env })` へ渡す

#### Scenario: environment 補完失敗時は既存経路へフォールバックする
- **WHEN** Windows の persistent environment 解決に失敗する
- **THEN** Main は失敗をログへ残しつつ、既存の `process.env` ベース環境と明示 override を使って Codex 起動を継続する

#### Scenario: Windows sandbox 有効時は workspace-write で起動する
- **WHEN** Windows 上で保存済み Windows sandbox モードが `unelevated` または `elevated` である
- **THEN** Main は Codex thread を `workspace-write` で開始し、`windows.sandbox` 設定を Codex へ渡す

### Requirement: 認証済み状態での問い合わせ応答
システムは、選択中の Codex 認証方式で実行に必要な認証が完了した状態で問い合わせを受理し、Codex SDK の実行結果を構造化応答として Renderer に返却しなければならない（MUST）。また、外部通信が必要な Codex 実行では Proxy 設定を考慮した経路で処理しなければならない（MUST）。Windows sandbox モードが有効な Windows 環境では、セットアップ完了済みの sandbox 実行経路を通しても同じ応答契約を維持しなければならない（MUST）。

#### Scenario: Codex 認証済みなら応答テキストが返る
- **WHEN** Codex 認証済みのユーザーが質問を送信する
- **THEN** Main は Codex 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: API key 設定済みなら応答テキストが返る
- **WHEN** 認証方式が API key で、有効な Codex API key が保存されたユーザーが質問を送信する
- **THEN** Main は保存済み API key を使って Codex 向け実行経路で処理し、応答を `promptResult` として Renderer に返す

#### Scenario: Proxy 必須環境でも設定済みなら応答テキストが返る
- **WHEN** 実行環境が Proxy 経由でのみ外部接続可能で、必要な Proxy 設定が保存されている
- **THEN** Main は問い合わせを成功させ、応答を `promptResult` として Renderer に返す

#### Scenario: Windows sandbox 経由でも応答契約を維持する
- **WHEN** Windows sandbox モードが有効で setup 完了済みの状態でユーザーが質問を送信する
- **THEN** Main は sandboxed thread 経由で処理し、通常実行と同じ `promptResult` 契約で応答を返す

### Requirement: 未認証時の実行拒否
システムは、選択中の認証方式に応じて Codex 実行に必要な認証または必須設定が未完了の場合に問い合わせ実行を拒否し、不足条件を示すエラーを返さなければならない（MUST）。Windows sandbox モードが有効でも setup 未完了または未対応モードである場合、Main は問い合わせを開始してはならず（MUST NOT）、不足条件を示す標準化エラーを返さなければならない（MUST）。

#### Scenario: Codex 未認証の送信が拒否される
- **WHEN** Codex 認証が未完了のユーザーが質問を送信する
- **THEN** Main は問い合わせを実行せず、Codex 認証が必要であることを示すエラーコードを返す

#### Scenario: API key 未設定の送信が拒否される
- **WHEN** 認証方式が API key で、Codex API key が未設定のユーザーが質問を送信する
- **THEN** Main は問い合わせを実行せず、API key 設定が必要であることを示すエラーコードを返す

#### Scenario: Windows sandbox setup 未完了の送信が拒否される
- **WHEN** Windows sandbox モードが有効だが setup が完了していない状態で質問を送信する
- **THEN** Main は問い合わせを実行せず、Windows sandbox のセットアップが必要であることを示すエラーコードを返す

### Requirement: 実行失敗時の標準化エラー
システムは、Codex SDK 実行中の失敗を標準化されたエラー形式に変換して Renderer に返さなければならない（MUST）。Proxy 経路の接続失敗も同じ標準化エラー形式で返さなければならない（MUST）。Windows sandbox 由来の setup 失敗、未対応モード、sandbox backend 失敗も標準化エラーへ変換しなければならない（MUST）。

#### Scenario: SDK 失敗が UI で扱える形式になる
- **WHEN** OpenAI Codex TypeScript SDK 呼び出しが例外を返す
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

#### Scenario: Proxy 接続失敗が標準化エラーになる
- **WHEN** Proxy 接続に失敗して外部通信が確立できない
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

#### Scenario: Windows sandbox 失敗が標準化エラーになる
- **WHEN** Windows sandbox の setup 失敗、未対応モード、または backend 実行失敗が発生する
- **THEN** Main はエラーコード・メッセージ・再試行可否を含む失敗応答を返す

#### Scenario: Windows sandbox setup 必須エラーが設定画面向けに返る
- **WHEN** Windows sandbox モード有効中に setup 未完了のまま問い合わせが送信される
- **THEN** Main は Renderer が設定画面再表示に使える専用エラーコードを返す

### Requirement: ループイベントの Renderer 中継
システムは、Main プロセスで実行されるエージェントループの進行イベントを Renderer に逐次通知しなければならない（MUST）。通知には少なくともイベント種別とイベントに紐づく識別子（例: `toolCallId`）を含めなければならない（MUST）。

#### Scenario: ツール実行開始イベントが通知される
- **WHEN** Main のエージェント実行で `tool_execution_start` が発生する
- **THEN** Renderer へ同イベントが中継される

#### Scenario: ツール実行終了イベントが通知される
- **WHEN** Main のエージェント実行で `tool_execution_end` が発生する
- **THEN** Renderer へ同イベントが中継される

### Requirement: 実行終了時のイベントストリーム終端
システムは、エージェント実行が完了・失敗・中断のいずれで終了した場合でも、Renderer が進行中表示を確実に終了できる終端イベントまたは等価な終了通知を送出しなければならない（MUST）。

#### Scenario: 正常完了で終端通知が届く
- **WHEN** エージェント実行が正常完了する
- **THEN** Renderer は終端通知を受信できる

#### Scenario: 失敗時も終端通知が届く
- **WHEN** エージェント実行が失敗する
- **THEN** Renderer は終端通知を受信できる

### Requirement: 外部通信への Proxy 設定適用
システムは、外部ネットワークへ接続するエージェント実行時に、保存済み `networkProxy.useProxy` 設定を解決して通信経路へ適用しなければならない（MUST）。

#### Scenario: Proxy 設定ありで外部通信が Proxy 経由になる
- **WHEN** `networkProxy.useProxy = true` で問い合わせを実行する
- **THEN** Main は実行環境の `HTTP_PROXY` / `HTTPS_PROXY` 設定を利用した通信経路で外部通信を実行する

#### Scenario: Proxy 設定オフで直接経路を選択する
- **WHEN** `networkProxy.useProxy = false` で問い合わせを実行する
- **THEN** Main は Proxy 強制を行わず、直接経路で外部通信を実行する

### Requirement: Main プロセスは scheduler daemon を起動監視できる
システムは、Electron Main プロセス起動時に scheduler daemon を初期化し、コマンド送信とイベント受信が可能な状態を維持しなければならない（MUST）。daemon が異常終了した場合、Main は障害を観測し、エージェント実行と通知機能が扱えるエラーとして表面化しなければならない（MUST）。

#### Scenario: アプリ起動時に scheduler daemon が利用可能になる
- **WHEN** lilto の Main プロセスが起動する
- **THEN** システムは scheduler daemon を起動し、ready 状態を確認してから scheduler API を受け付ける

#### Scenario: daemon 異常終了を検知する
- **WHEN** scheduler daemon が実行中に異常終了する
- **THEN** システムはその失敗をログとエラー応答で観測可能にする

### Requirement: Main プロセスは cron custom tool を agent runtime に公開する
システムは、Codex SDK のエージェント実行中に `cron` tool を利用可能にするため、Main から接続可能な stdio MCP server を公開しなければならない（MUST）。tool 実行結果は通常のツール実行イベントと同様に Renderer へ中継されなければならない（MUST）。

#### Scenario: AI が高水準 operation で timer を登録する
- **WHEN** エージェント実行中に AI が MCP 経由の `cron` tool の `set_timer` を呼び出す
- **THEN** Main はその入力を scheduler daemon 用の one-shot schedule に正規化し、結果を MCP tool 実行結果として AI に返す

#### Scenario: AI が低水準 operation で複雑な schedule を登録する
- **WHEN** エージェント実行中に AI が MCP 経由の `cron` tool の `create` または `update` を呼び出す
- **THEN** Main は与えられた `runAt` または `cronExpr` をそのまま scheduler daemon へ転送し、結果を MCP tool 実行結果として AI に返す

#### Scenario: cron MCP tool の失敗が標準化される
- **WHEN** `cron` MCP tool の入力不正または scheduler daemon エラーが発生する
- **THEN** Main はエラーコードと説明を含む失敗結果を返し、Renderer にも失敗イベントを中継する

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

### Requirement: Main プロセスは managed installed plugin state を Codex runtime へ反映する
システムは、lilto が管理する app-server 経由の installed plugin state を Codex runtime 起動環境へ反映しなければならない（MUST）。plugin 管理と runtime 起動は、強制的に同じ `HOME` を共有するのではなく、同じ app-managed `CODEX_HOME` と正規化済み runtime environment を共有しなければならない（MUST）。Codex 本体が install した plugin は、次回送信または新規 thread から利用可能でなければならない（MUST）。

#### Scenario: plugin install 後の新規 thread で plugin が利用可能になる
- **WHEN** ユーザーが plugin をインストールした後に新しい会話または新しい thread で問い合わせを送信する
- **THEN** Main は app-managed install store を読める `CODEX_HOME` と正規化済み runtime environment で処理を開始する

#### Scenario: plugin install 後の次回送信へ反映される
- **WHEN** plugin インストール完了後に runtime refresh が必要になる
- **THEN** Main は session または runtime cache を更新し、再起動なしでも次回送信から plugin 利用可能状態へ遷移させる

#### Scenario: plugin uninstall 後は runtime から利用されない
- **WHEN** ユーザーが plugin を削除した後に問い合わせを送信する
- **THEN** Main は更新済み installed plugin state を使って処理し、削除済み plugin を runtime から参照しない

### Requirement: Main プロセスは heartbeat assistant の background patrol を実行できる
システムは、Renderer の通常送信とは独立して、Main プロセスから heartbeat assistant 用の background patrol を開始できなければならない（MUST）。この patrol 実行は `HEARTBEAT.md` と軽量な巡回コンテキストを使い、通常会話のフル履歴を前提にしてはならない（MUST NOT）。

#### Scenario: internal schedule 発火で background patrol を開始する
- **WHEN** heartbeat assistant 用の internal schedule が発火する
- **THEN** システムは Main プロセスから background patrol を開始する

#### Scenario: patrol は軽量コンテキストで実行される
- **WHEN** heartbeat assistant の background patrol を実行する
- **THEN** システムは `HEARTBEAT.md` と巡回に必要な最小コンテキストを使って runtime を実行する

### Requirement: Main プロセスは heartbeat assistant の結果を通知経路へ反映できる
システムは、heartbeat assistant の巡回結果が actionable finding である場合だけ、既存の通知経路を使ってユーザーへ結果を表面化できなければならない（MUST）。`HEARTBEAT_OK` や duplicate suppression の結果を通知経路へ流してはならない（MUST NOT）。アプリが非フォーカス状態なら、OS 通知も利用できなければならない（MUST）。

#### Scenario: finding を履歴または通知へ反映する
- **WHEN** heartbeat assistant の巡回結果に要対応の finding が含まれる
- **THEN** システムは既存の通知経路を通して結果を表面化する

#### Scenario: HEARTBEAT_OK は通知しない
- **WHEN** heartbeat assistant の巡回結果が `HEARTBEAT_OK` のみである
- **THEN** システムは既存の通知経路へ event を流さない

#### Scenario: 非フォーカス時は OS 通知も使う
- **WHEN** heartbeat assistant の巡回結果を表面化する時点でアプリが非フォーカスである
- **THEN** システムは通常の反映に加えて OS 通知も行う

### Requirement: Main プロセスは heartbeat assistant state を runtime prompt へ渡せる
システムは、heartbeat assistant の background patrol を開始するとき、`heartbeat_state.json` 相当の state を runtime prompt へ渡せなければならない（MUST）。prompt では stable key と check name を返しやすい形式を要求できなければならない（MUST）。

#### Scenario: state を参照して background patrol を実行する
- **WHEN** Main プロセスが heartbeat assistant の巡回を開始する
- **THEN** システムは state を prompt へ渡して runtime を実行する

#### Scenario: stable key を返すフォーマットを prompt で要求する
- **WHEN** Main プロセスが heartbeat assistant の巡回 prompt を組み立てる
- **THEN** システムは stable key と check name を返すフォーマットを prompt に含める

