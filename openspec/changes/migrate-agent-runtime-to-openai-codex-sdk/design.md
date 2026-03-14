## Context

現在の実装では、[`src/main/agent-sdk.ts`](src/main/agent-sdk.ts) が `@mariozechner/pi-coding-agent` の session API と `@mariozechner/pi-ai` の OAuth/model 解決に依存しており、[`src/main/auth-service.ts`](src/main/auth-service.ts) と [`src/main/cron-tool.ts`](src/main/cron-tool.ts) も Pi 固有の前提を共有しています。Renderer 側は既存の `AgentLoopEvent` と `promptResult` の形に依存しているため、runtime を差し替えても UI 契約を急に変えると回帰範囲が広がります。

一方で、今回の変更では「Pi 利用をやめて OpenAI Codex TypeScript SDK を使う」こと自体が目的であり、Pi provider 抽象や Pi 設定ファイル互換を残すと設計が二重化します。したがって、lilto 側に Codex 向けの auth/session adapter を持たせ、認証はブラウザ OAuth と API key の 2 経路に整理しつつ、既存 UI には極力互換なイベントを返す設計が必要です。tool 連携については SDK 直登録ではなく Codex CLI の MCP server 構成を前提に分離します。

また、ローカルの Codex 実装参照先として `.env` の `CODEX_REPO_DIR` が利用可能です。実装時は [`$CODEX_REPO_DIR/sdk/typescript/README.md`]($CODEX_REPO_DIR/sdk/typescript/README.md) と [`$CODEX_REPO_DIR/sdk/typescript/src/`]($CODEX_REPO_DIR/sdk/typescript/src/) を一次参照とし、必要に応じて app server protocol の skill/thread 定義も参照します。

## Goals / Non-Goals

**Goals:**

- Main プロセスのエージェント実行を OpenAI Codex TypeScript SDK ベースへ置き換える。
- 既存の Renderer IPC 契約 (`submitPrompt`, `promptResult`, `AgentLoopEvent`) は可能な限り維持し、UI 改修を最小にする。
- 認証、会話継続、`cron` MCP server、scheduler follow-up を Codex SDK 前提で再接続する。
- Pi 固有 dependency と Pi 設定更新の責務を lilto から取り除く。

**Non-Goals:**

- Pi の複数 OAuth provider 互換を維持すること。
- OpenAI 以外の任意 provider 互換を維持すること。
- chat UI の見た目や IPC 契約を大きく作り直すこと。
- scheduler daemon 自体の仕様や保存フォーマットを刷新すること。

## Decisions

### 1. Hosted agent runtime は Codex 単一に寄せる

Main の hosted agent runtime は Codex SDK のみをサポート対象とし、Pi ベースの複数 OAuth provider 選択は今回の change で外します。一方で Codex 利用者向けに、現行の「認証開始」ボタンに対応するブラウザ OAuth と、従来の Custom Provider に近い API key 入力の 2 経路は維持します。理由は、SDK を単一化しながら既存ユーザーの主要導線を落とさずに移行できるためです。

代替案として「Pi runtime と Codex runtime を併存させる」案もありますが、設定画面・テスト・E2E の分岐が大きくなるため採用しません。

### 2. `AgentRuntime` の外部契約は adapter で維持する

[`src/main/agent-sdk.ts`](src/main/agent-sdk.ts) の公開 API は維持し、その内部で `@openai/codex-sdk` の `Codex`, `startThread()`, `runStreamed()`, `resumeThread()` を使って session/response stream を既存 `AgentLoopEvent` へ変換します。これにより Renderer の loop-status 表示、message list 更新、E2E mock の前提を全面的に壊さずに済みます。

代替案として Renderer 側も Codex SDK の生イベントへ寄せる案がありますが、今回の change の本質は runtime 差し替えであり、UI 契約変更まで同時に行うべきではありません。

### 3. 認証は lilto 管理の Codex credential store に移す

[`src/main/auth-service.ts`](src/main/auth-service.ts) は Pi `getOAuthProvider()` 依存を廃止し、Codex SDK が要求する認証方式に合わせて lilto 管理の credential store と state machine を持ちます。認証方式はブラウザ OAuth と API key の 2 系統を保持し、UI には引き続き `unauthenticated` / `auth_in_progress` / `authenticated` / `auth_failed` を通知します。送信可否は「選択中の認証方式で Codex 実行可能か」を評価軸にします。

代替案として Pi の OAuth 資格情報を読み替える案がありますが、Pi 廃止後の移行資産として不安定であり、SDK 依存面も減らせないため採用しません。

### 4. API key 経路は Codex 用固定設定として残す

従来の Custom Provider UI が担っていた「手入力の認証情報で送る」ユースケースは、任意 baseUrl を持つ provider 設定ではなく、Codex API key 設定として残します。これにより Settings UI の破壊を抑えつつ、Pi 時代の provider abstraction は削除できます。

代替案として API key 経路も完全に削除する案がありますが、ブラウザ OAuth を使えない開発環境を切り捨てることになるため採用しません。

### 5. `cron` は MCP server として切り出し、skill 解決は Codex 自動検出へ寄せる

`cron` は Pi Custom Tool の置き換えとして in-process に SDK 登録するのではなく、Codex CLI が接続できる stdio MCP server として lilto 側から提供します。理由は、現行の TypeScript SDK が `startThread()/runStreamed()/resumeThread()` を提供する一方で、Pi のような tool 直登録 API を持たず、tool 実行は CLI/app-server の MCP 連携前提だからです。

このため lilto 側では、scheduler daemon との通信、構造化引数、失敗時の標準化を担う `cron` 実装本体は既存 [`src/main/cron-tool.ts`](src/main/cron-tool.ts) に残しつつ、別途 MCP server の entry point を追加して Codex へ公開します。MCP server 自体は独立プロセスですが、scheduler daemon を二重起動しないよう Main プロセス内の scheduler service へローカル bridge 経由で委譲します。`AgentRuntime` はその MCP server を読める `workingDirectory` / `CODEX_HOME` / Codex config を整える責務に限定します。

skill については追加の tool 化や instruction 注入を lilto 側で実装せず、Codex CLI/SDK が `workingDirectory` 配下および Codex 標準の skill 参照場所から自動検出する前提を採用します。`CODEX_REPO_DIR` の protocol には `skills/list` と `skills/changed` があり、SDK は CLI を spawn する構成のため、今回の change では lilto 側の skill 接続ロジックを最小化します。Pi 設定ファイル更新は runtime 差し替え後に意味を失うため削除対象です。

### 6. 会話継続は `conversationId` と Codex session handle の対応表で持つ

scheduler follow-up や retry を成立させるため、Renderer の `conversationId` と Codex SDK 側の session/thread handle を Main で対応付けて保持します。ブラウザ OAuth と API key は同じ session resume 方式で扱う前提とし、認証方式ごとに別の再開経路は持ちません。既存の `session_bound` loop event は維持し、scheduler payload には lilto が解決可能な backend session 識別子を保存します。

代替案として各送信を完全 stateless にする案がありますが、follow-up 指示の継続性、tool 実行の文脈、履歴整合性が崩れるため採用しません。

## Risks / Trade-offs

- [Codex SDK の実 API 形が現行 adapter 想定とズレる] → 依存導入前に最小プロトタイプで auth、stream、tool、resume の 4 点を確認し、差分は adapter 層に閉じ込める。
- [既存の複数 provider ユーザーに破壊的変更となる] → proposal/specs/tasks で BREAKING を明示し、設定 UI と保存データの migration を先に定義する。
- [OAuth と API key の二系統で送信可否判定が複雑化する] → 設定上の「認証方式」を明示し、送信前判定は選択中方式だけを見るようにして分岐を局所化する。
- [loop event の粒度が Pi と Codex で一致しない] → UI で本当に必要なイベント (`thinking_*`, `tool_execution_*`, `text_delta`, 終端通知) に正規化し、欠けるイベントは adapter 側で補完する。
- [Codex SDK に tool 直登録 API がなく `cron` 接続方式が想定とズレる] → `cron` を SDK adapter の責務に押し込めず、MCP server と runtime 設定の 2 層へ分割する。spec/task も「tool 実装」ではなく「MCP 公開 + runtime 接続」に書き換える。
- [Codex の skill 自動検出条件を lilto が満たさず、期待する skill が読まれない] → 実装時に `CODEX_REPO_DIR` の SDK/CLI 実装と skill docs を参照し、lilto の `workingDirectory` / `additionalDirectories` / 環境変数で必要条件を満たしていることを確認する。
- [scheduler follow-up の session 紐付けが壊れる] → runtime migration と session mapping の更新を同じタスク束で実施し、follow-up を unit test と E2E で両方確認する。

## Migration Plan

1. `@openai/codex-sdk` の `Codex`, `startThread()`, `runStreamed()`, `resumeThread()` を使う adapter を先に作り、既存 `AgentRuntime` テストを置き換え可能な形で整える。
2. 認証サービスと Settings UI を Codex 前提へ更新し、ブラウザ OAuth / API key の選択と送信可否判定を新 auth state へ切り替える。
3. `cron` を stdio MCP server として公開し、Codex runtime がその MCP server を読める実行設定を追加した上で、scheduler follow-up を既存会話へ戻せることを確認する。
4. Pi 依存 package と Pi 設定更新ロジックを削除し、unit test / E2E / manual verification を新 runtime で通す。
5. 問題があれば change 単位でロールバックし、Pi 依存 package と旧 auth service を戻せるよう commit を分離する。

## Open Questions

なし
