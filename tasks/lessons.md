# Lessons

## 2026-02-23

| 変更内容 | ミス/課題 | 再発防止ルール |
|---|---|---|
| `add-electron-agent-browser-e2e-gate` の design/specs/tasks を一括作成し、GUI 変更時 E2E 必須ルールをタスク化。 | proposal の Capability で `Modified` を指定すると、既存 spec 不在時に整合性が崩れる。 | 既存 `openspec/specs` の実体を確認し、存在しない capability は `Modified` ではなく `New Capabilities` として定義する。 |
| `agent-browser` を用いた Electron E2E（CDP接続）と `LILTO_E2E_MOCK` モードを実装し、GUI変更の完了条件を `AGENTS.md` に反映。 | Renderer TS をモジュール（`export {}`）として書くと、ブラウザ実行で `exports` 参照が混入し UI イベントが無反応になる不具合を見落とした。 | Browser で直接読む Renderer スクリプトは CommonJS 依存コードを出さない構成にし、GUI変更時は必ず E2E でイベント発火と状態遷移を確認する。 |
| E2E スクリプト配置を整理。 | E2E スクリプトを `test/` 配下に置くと `node --test` に自動収集され、通常テスト時間を不必要に増やす。 | 手動実行前提の E2E は `scripts/` に配置し、`npm run e2e:*` でのみ起動する。 |
| README のテスト詳細を整理し、人間向けは `docs/manual-test.md`、エージェント向けは `AGENTS.md` に集約。 | 利用者別の情報配置を分けずに README へ運用詳細を書きすぎると、責務が曖昧になり更新漏れを招く。 | README は概要と参照先に留め、実行手順は対象読者ごとの専用ドキュメントへ記載する。 |
| E2E でスクリーンショットを出力する運用を維持。 | テスト証跡画像を Git 管理に含めるとリポジトリが汚れやすい。 | `test/artifacts/` を `.gitignore` に追加し、スクリーンショットはローカル証跡としてのみ扱う。 |
| `.env` を元にテンプレートファイルを作成。 | ローカル固有パスを絶対パスで共有すると環境依存になる。 | 共有用は `.env.example` にプレースホルダ値を記載し、実値は `.env` のみに保持する。 |
| OpenSpec change を同期付きでアーカイブ。 | `openspec sync` のような独立コマンドは存在せず、誤コマンドで手戻りしやすい。 | 同期が必要なアーカイブは `openspec archive <change> -y` を使い、spec 更新と archive を一括実行する。 |
| `add-pi-sdk-main-process-agent` の proposal を日本語コンテキストに沿って作成。 | OpenSpec のテンプレート既定（英語）に引きずられると、プロジェクト規約の言語要件と成果物がずれる。 | artifact 作成前に `openspec/config.yaml` の `context` を確認し、言語・記述ルールを本文へ反映してから起草する。 |
| `openspec-ff-change` で `add-pi-sdk-main-process-agent` の design/specs/tasks を一括作成。 | specs を capability ごとに分割せず 1 ファイルに集約すると、proposal との対応関係が曖昧になり追跡性が落ちる。 | `proposal` の New Capabilities 1件につき `openspec/changes/<change>/specs/<capability>/spec.md` を必ず1ファイル作成し、`openspec status` で 4/4 完了を確認して終了する。 |
| `add-pi-sdk-main-process-agent` の OAuth 導線方針を design に確定。 | Open Questions を残したまま実装に進むと、UI と認証実装で分岐方針がずれて手戻りが起きる。 | 実装判断が固まった項目は Open Questions から削除し、Decisions に採用理由と代替案を明記してから tasks を進める。 |
| `add-pi-sdk-main-process-agent` を実装し、OAuth UI と Main 実行基盤を接続。 | Pi リポジトリ参照用パス（`PI_REPO_DIR`）を実行時依存として扱うと、配布アプリで動作不能になる。 | `PI_REPO_DIR` は API 調査専用とし、Electron 内包は npm 依存（`@mariozechner/pi-coding-agent` と `@mariozechner/pi-ai`）のみで成立させる。 |
| OAuth 開始ボタン押下時の ESM 読み込み失敗を修正。 | TypeScript の CommonJS 出力で `import()` が `require()` 化され、ESM only パッケージ（`@mariozechner/pi-ai`）を読み込めず認証が即失敗した。 | Electron Main が CommonJS の場合、ESM only 依存は `new Function(\"specifier\", \"return import(specifier)\")` 等で実行時 dynamic import を明示し、`ERR_REQUIRE_ESM` を回避する。 |
| OAuth 認証コード入力導線を常設化し、貼り付け文字列の抽出を強化。 | `code#state` だけを前提にすると、`Authentication Code ... Paste this into Claude Code:` を丸ごと貼った場合に入力失敗しやすい。 | 認証コード入力欄は常時表示し、入力値から `code#state` パターンを抽出して受理する実装にする。 |
| `add-pi-sdk-main-process-agent` を Sync 付きで archive。 | delta spec を反映せず archive すると、change 実装と main spec が乖離する。 | capability 追加を含む change は `openspec archive <change> -y` を使い、spec 同期と archive を同時に完了させる。 |
| 認証トークン保存ファイル `.lilt-auth.json` を Git 対象外に設定。 | OAuth トークンを含むローカル認証ファイルが untracked のままだと、誤って `git add .` で混入するリスクがある。 | 認証情報ファイルは実装追加と同時に `.gitignore` へ登録し、機密情報を VCS 管理から除外する。 |
| `build-renderer-chat-ui-and-ui-guidelines` の OpenSpec change を新規作成し、初回 artifact 指示まで確認。 | `openspec new change` 後に勢いで artifact を作り始めると、要件合意前に proposal 内容が固定化される。 | `openspec-new-change` 実行時は `status` と最初の `instructions` 表示で必ず停止し、ユーザー合意後に artifact 作成へ進む。 |
| `build-renderer-chat-ui-and-ui-guidelines` の proposal を作成。 | 既存 spec 名を確認せずに `Modified Capabilities` を書くと、後続の delta spec 生成時に整合が崩れる。 | proposal 作成前に `openspec/specs` を確認し、変更対象は実在する capability 名だけを `Modified Capabilities` に記載する。 |
| `build-renderer-chat-ui-and-ui-guidelines` の design/specs/tasks を一括作成。 | `applyRequires` を見ずに全 artifact を機械的に埋めると、実装着手に不要な作業まで抱えやすい。 | `openspec status --json` の `applyRequires` と各 artifact の依存関係を毎回確認し、実装準備が完了する最短順で artifact を作成する。 |
| `pi-web-ui-example` 実装を参照してポーティング対象/非対象を明文化。 | 方針を抽象表現だけで残すと、実装時に「どこまで流用するか」が人ごとに解釈分岐する。 | 方針更新時は参照元の具体ファイル単位で「ポーティングする / しない / Main 側移管」を分類して記載する。 |
| UI 方針ドキュメントの配置先を README から `docs/` 配下へ変更。 | 概要ドキュメント（README）に方針詳細を直接追記すると、目的の異なる情報が混在して可読性が下がる。 | README は概要と導線に限定し、詳細方針は `docs/` の専用文書へ分離して参照リンクだけを置く。 |
| `build-renderer-chat-ui-and-ui-guidelines` の apply 実装でチャット UI と E2E を更新。 | UI の表示形式を変更しても E2E の取得セレクタを更新しないと、正常動作でも検証が偽陰性になる。 | GUI の DOM 構造を変えたときは `npm run e2e:electron` 実行前に `scripts/e2e-*` のセレクタ依存を点検し、同一責務の検証点へ更新する。 |
| `web-ui/example` 参照で Renderer レイアウトを `Header / MessageList / Composer` 構成へ再調整。 | 既存 UI の一部だけ差し替えると、全体の情報密度が揃わず「example に寄せたつもりで別物」に見えやすい。 | `web-ui/example` へ寄せる時はレイアウトをコンポーネント単位（Header/MessageList/Composer）でまとめて移植し、個別要素の断片移植を避ける。 |
| `web-ui/example` にさらに寄せるため余白・配置を微調整。 | バブル幅やコンポーザー幅を可変にしすぎると、デスクトップ表示で視線移動が増えて「簡素さ」が失われる。 | チャット本文幅とコンポーザー幅は上限を揃えた固定レンジ（例: 約680-700px）にし、中央カラム構成を維持する。 |
| ユーザーバブルが左寄りになる表示崩れを修正。 | `msg-user` で `margin-right: auto` を残すと、会話レイアウト変更後にユーザー発話が左へ吸着する。 | ユーザー発話は `margin-left: auto` と `align-self: flex-end` をセットで指定し、右寄せを明示する。 |
| 認証UIを常設表示から Settings モーダルへ移行。 | 既存 `auth-*` 要素IDを変更すると、認証ロジックや E2E セレクタが連鎖的に壊れやすい。 | UI 移設時は `id` 契約を維持し、表示位置だけを変更してロジック/検証コードの影響範囲を最小化する。 |
| 初期案内メッセージ削除と右上ステータスの「完了」非表示要件を反映。 | UI文言変更時に E2E が旧ステータス（`完了`）依存のままだと、実装は正しくてもテストが失敗する。 | ステータス文言を変更したら `scripts/e2e-*` の期待文字列も同時更新し、表示仕様と検証仕様を一致させる。 |
| ヘッダー視認性向上のためアイコン/文字サイズを拡大し、タイトル名を変更。 | ヘッダー要素が小さすぎると設定導線（歯車）が見落とされやすく、機能に到達できない。 | 主要導線アイコンは十分なクリック領域（40px 目安）を確保し、ラベルは視認可能なサイズで表示する。 |
| `build-renderer-chat-ui-and-ui-guidelines` を sync 付きで archive。 | delta spec を同期せずに archive すると main specs と実装意図がずれる。 | delta spec を含む change の完了時は `openspec archive <change> -y` を使い、同期結果（create/update件数）を確認してから完了報告する。 |
| `add-providers-and-models-custom-provider` の OpenSpec change を新規作成し、初回 artifact 指示まで確認。 | change 作成時に `status` を確認せず次の artifact に進むと、依存関係を無視した順序で手戻りしやすい。 | `openspec new change` 実行後は必ず `openspec status --change <name>` で ready artifact を特定し、`openspec instructions <artifact> --change <name>` を取得して停止する。 |
| `add-providers-and-models-custom-provider` の artifacts（proposal/design/specs/tasks）を一括作成。 | `proposal` の Capabilities と `specs/` の実ファイル名がずれると、artifact 完了に見えても apply で整合崩れを起こす。 | `openspec-ff-change` では proposal で宣言した capability 名ごとに `specs/<capability>/spec.md` を必ず作成し、最後に `openspec status --change <name>` で `4/4` を確認する。 |
| `add-providers-and-models-custom-provider` の apply 実装で provider 設定永続化と実行分岐を追加。 | `async` の `try` 内で Promise を `return` のみすると reject が catch されず、標準化エラー経路のテストが壊れる。 | 例外を統一処理したい `async` 分岐では `return await` を使って同一 `try/catch` に乗せ、失敗時コード（`AGENT_EXECUTION_FAILED` など）の回帰テストを必ず走らせる。 |
| Custom Provider で「エージェント応答は空でした」が出る問題を修正。 | ストリーム抽出を `text_delta` のみに依存すると、`done` / `message_end` 主体の provider で実際の応答が回収できない。 | 出力組み立ては `text_delta` に加えて `text_end`・`done.message.content`・`message_end.message.content` をフォールバックで回収し、provider 差異を吸収する。 |
| Ollama (`127.0.0.1:11434`) 実通信で Custom Provider を確認。 | custom model の `provider` に表示名（`Ollama`）を使うと、`setRuntimeApiKey` の解決キーと一致せず `No API key found` になる。 | 実行時の provider ID は固定スラッグ（例: `custom-openai-completions`）を使い、表示名は `model.name` へ分離する。 |
| `migrate-ui-to-lit` の apply 検証で Electron E2E を実行し、Renderer が未描画になる不具合を修正。 | Vite が Renderer 用の decorator 設定を使わないままビルドされると、実行時に `Unsupported decorator location: field` でカスタム要素登録が失敗し、`lilt-app` が未定義のままになる。 | Lit + decorator 構成では `vite.config.ts` 側に `esbuild.tsconfigRaw.compilerOptions.experimentalDecorators/useDefineForClassFields` を明示し、GUI変更時は `npm run e2e:electron` でカスタム要素定義まで確認する。 |
| メッセージ表示の上下余白を調整。 | 会話バブルの `padding` とリスト `gap/padding` を同時に大きめ設定すると、1〜2行メッセージ中心の画面で間延びして見える。 | チャット UI の余白調整は `list (padding/gap)` と `bubble (padding/line-height)` をセットで小刻みに調整し、`npm run e2e:electron` の最新スクショで視覚確認してから確定する。 |
| メッセージバブル内の余白に見える空行を修正。 | `white-space: pre-wrap` で表示する要素にテンプレート改行を含めると、本文の前後に意図しない改行が描画される。 | `pre-wrap` 利用時は `${text}` を要素内でインライン配置し、テンプレート由来の先頭/末尾改行を混入させない。 |
| 余白と改行起因の見た目問題を切り分けて再調整。 | 原因未確定のまま spacing を先に触ると、正解修正（改行除去）後に不要な見た目変更が残る。 | 見た目不具合は DOM 文字列（改行混入）と CSS 余白を先に切り分け、根本原因修正後は一時的な見た目調整を必ず元に戻してから確定する。 |
| `migrate-ui-to-lit` を archive して main specs へ同期。 | 手動の `mv` だけで archive すると、delta spec の同期漏れで `openspec/specs` と実装履歴が乖離する。 | delta spec を含む change の完了時は `openspec archive <change> -y` を使い、同期対象 capability と適用件数（add/modify/remove）を出力で確認してから完了報告する。 |
| `agent-browser-skill` の proposal を過去コミット内容ベースで再作成。 | 既存 `openspec/specs` にない capability を `Modified Capabilities` に入れると、後続 specs との整合が崩れる。 | proposal 作成時は先に `openspec/specs` の実在名を確認し、未存在のものは `New Capabilities` として定義する。 |
| `openspec-ff-change` で `agent-browser-skill` の design/specs/tasks を一括作成。 | `proposal` の capability 種別（New/Modified）と specs の delta 種別（ADDED/MODIFIED）が不一致だと、archive 同期時に意図しない差分になる。 | specs 作成前に proposal の capability 区分を基準として delta 種別を合わせ、`openspec status --change <name>` で 4/4 完了まで確認する。 |
| `openspec-apply-change` で `agent-browser-skill` を実装し、skills/workspace 設定とテストを追加。 | Pi 設定ファイルを `~/.pi/settings.json` だけ更新すると、現行 SDK が参照する `~/.pi/agent/settings.json` に反映されず実行時にスキルが見えない。 | Pi 連携の設定更新は legacy と現行の両方（`~/.pi/settings.json` / `~/.pi/agent/settings.json`）を対象にし、テストで重複追加防止まで検証する。 |
| Agent Skills の live E2E（Mock なし）を Claude 認証前提に追加。 | live 検証を Custom Provider 前提にすると、環境依存（Ollama/モデル有無）で再現性が落ちる。 | Agent Skills の E2E は認証済み Claude を標準経路にし、`/skill:agent-browser` で実ブラウザ情報（例: Example Domain）取得を成功条件にする。 |
| `agent-browser-skill` を sync 付きで archive。 | archive 前に delta spec の同期有無を確認しないと、実装完了後も `openspec/specs` が未更新で基準仕様が遅延する。 | delta spec を含む change は `openspec archive <change> -y` を優先し、出力の create/modify 件数と archive 名を完了条件として確認する。 |
| `visualize-agent-loop-ui` の OpenSpec change を新規作成し、初回 artifact 指示まで確認。 | 変更名を即決すると、後で目的（調査+ポーティング）との粒度ずれが起きる可能性がある。 | `openspec new change` 前に要求文から「対象（pi-web-ui の pi-agent-core 連携）と目的（実行中ループ可視化）」を1行で固定し、その要約に一致する kebab-case 名を採用する。 |
| `visualize-agent-loop-ui` の artifacts（proposal/design/specs/tasks）を `openspec-ff-change` で一括作成。 | proposal で capability を先に固定せず進めると、specs ファイル名と Modified 対象が後半でずれやすい。 | `ff-change` 開始時に proposal の `New/Modified Capabilities` を確定し、その名前と同一パスで `specs/<capability>/spec.md` を先に空作成してから本文を埋める。 |
| `visualize-agent-loop-ui` の apply 実装で Main->Renderer ループイベント可視化を追加し、GUI E2E まで完了。 | preload から Main モジュール定数を参照すると、環境差異で `window.lilto` 初期化不全の切り分けが難しくなる。 | preload は依存を最小化し、IPC チャネル名はローカル定数で定義して bridge 初期化の単純性を優先する。 |
| 進行可視化を上部パネルからアシスタント返信内の逐次ログ表示へ変更し、live E2E で確認。 | 進行表示を別UI（上部パネル）に分離すると、ユーザーの会話文脈から離れて「作業過程が見えない」印象になる。 | 進行イベントは pending assistant メッセージ本文に追記し、最終回答時もログを残して「増えていく表示」を維持する。 |
| 進行ログを「開始＋詳細表示」に調整し、`ツール完了/実行完了` 行を削除。 | 進行イベントを対称的に全表示すると、ユーザーには完了通知が冗長でノイズになりやすい。 | 進行ログは `tool_execution_start` を主軸にし、開始時の引数要約（command/path など）を追記して情報密度を上げる。 |

## 2026-02-24

| 変更内容 | ミス/課題 | 再発防止ルール |
|---|---|---|
| `add-bundled-skill-creator-skill` の proposal を作成し、`skill-creator` 同梱とスキル化依頼時の優先選択方針を定義。 | 新規 capability 追加と既存 capability 変更の境界を曖昧にすると、後続の specs で requirement の責務が重複しやすい。 | proposal 作成時に「新規挙動は New Capabilities、既存 discovery の挙動拡張は Modified Capabilities」と責務を分離して記述する。 |
| スキル保存先を再検討し、組み込みとユーザー生成で分離する方針を proposal/policy に反映。 | `~/.pi/workspaces` は TTL クリーンアップ対象のため、再利用前提スキルを置くと消失リスクがある。 | 再利用資産はクリーンアップ対象外の永続ディレクトリ（`~/.pi/skills`）に保存し、組み込み資産は `<app data>/skills/bundled` と分離して管理する。 |
| `openspec-ff-change` で `add-bundled-skill-creator-skill` の design/specs/tasks を一括作成。 | Modified capability の spec で requirement 名が既存 spec と一致しないと、archive 同期時に意図した更新として扱われない。 | `## MODIFIED Requirements` を書く前に `openspec/specs/<capability>/spec.md` の `### Requirement:` 見出しを確認し、同一見出し名で全文更新する。 |
| `add-bundled-skill-creator-skill` の tasks に E2E 最終検証（事前クリーンアップ + 再現実行）を追加。 | テスト用スキル削除条件を曖昧にすると、`~/.pi/skills` 内の手作業スキルまで誤削除する事故が起きる。 | E2E 用スキルには固定マジックワード（`[[LILTO_SKILL_E2E_MAGIC]]`）を必ず埋め込み、削除処理はその文字列を検出したスキルに限定する。 |
| `openspec-apply-change` で `add-bundled-skill-creator-skill` を実装し、live E2E（取得→スキル化→再現）を完了。 | 組み込みスキルの同梱元を単一路径に固定すると、依存配置差異（node_modules/ローカル同梱）で起動時に欠落しやすい。 | 組み込みスキルは複数候補パスから解決し、見つからない場合はスキル名付きで明示エラーにして検知を早める。 |
| `skill-creator` を「ビルド時に最新取得・非Git管理」へ運用変更。 | 同梱スキルをリポジトリ管理すると更新頻度の高い upstream 差分でノイズが増え、最新版追従も手動化しやすい。 | upstream 追従が必要な同梱資産は `prebuild` で同期し、生成先ディレクトリを `.gitignore` で除外してソース管理対象を最小化する。 |
| `start-new-session-with-plus-button` の artifacts（proposal/design/specs/tasks）を `openspec-ff-change` で一括作成。 | 既存仕様にある Requirement 名を確認せずに `MODIFIED` を書くと、同期時に意図しない差分適用になりやすい。 | `specs` 作成前に `openspec/specs/<capability>/spec.md` の Requirement 見出しを確認し、変更は既存見出しに寄せて全文更新する。 |
| `start-new-session-with-plus-button` を apply 実装し、＋ボタンで新規セッション開始と GUI E2E を完了。 | E2E で非同期 UI 状態（送信中 disabled）を瞬間値で検証すると、モック応答が速い環境でフレークしやすい。 | 非同期状態の E2E 検証は時間依存の瞬間観測を避け、制御可能な状態（例: `isSending` の明示切替）で deterministic に確認する。 |

## 2026-02-25

| 変更内容 | ミス/課題 | 再発防止ルール |
|---|---|---|
| OpenSpec CLI の導入と `fix-windows-compatibility` change 再作成準備。 | Windows PowerShell の実行ポリシーで `npm` / `openspec` の `.ps1` がブロックされ、CLI が未導入・未起動に見えて手順が停止した。 | Windows では CLI 初期確認時に `npm.cmd` / `npx.cmd` / `openspec.cmd` を優先し、`--version` 成功を確認してから OpenSpec フロー（`new change` → `status` → `instructions`）へ進む。 |
| `fix-windows-compatibility` で `/opsx:ff` を実行し、`proposal → design → specs → tasks` を依存順で一括作成。 | status の `ready` / `blocked` を都度再確認せずに進めると、依存未解決 artifact を先に作って整合が崩れやすい。 | `/opsx:ff` では artifact 作成ごとに `openspec status --change <name> --json` を再実行し、`applyRequires` が `done` になるまで「instructions取得→依存読込→作成」を固定ループで回す。 |
| `fix-windows-compatibility` の apply 実装で Windows `.cmd` 互換ユーティリティと検証フローを追加。 | Windows 対応をスクリプト個別分岐で増やすと、Main ランタイム・E2E・運用手順で実行コマンド規約が再び乖離しやすい。 | OS 互換は共通ユーティリティ（コマンド解決・引数/cwd正規化・実行ポリシーエラー判定）へ集約し、README/docs/AGENTS とテストを同一タイミングで更新して仕様と運用を同期する。 |
| OpenSpec 運用時に CLI コマンド未検出ケースを整理。 | `openspec` コマンドが見つからない状態で原因切り分けを続けると、実装タスクに着手できず作業が停滞する。 | `openspec --version`（Windows は `openspec.cmd --version`）で未検出なら無理に回避せず、`npm i -g @openspec/cli` でグローバルインストールしてからフローを再開する。 |
| `add-corporate-proxy-support` の OpenSpec change を新規作成し、初回 artifact 指示（proposal）まで取得。 | 受け入れ条件に「擬似Proxy必須環境での疎通確認」がある変更は、名前や初期スコープが曖昧だと後続 artifact で検証要件が抜け落ちやすい。 | `openspec new change` 前に完了条件を1行で固定し、それを含む change 名（例: proxy 必須動作）にしてから `status` と `instructions` 取得で停止する。 |
| `openspec-ff-change` で `add-corporate-proxy-support` の proposal/design/specs/tasks を一括作成。 | Modified capability の delta spec で既存 Requirement 見出しを変えると、archive 同期時に意図した更新として扱われない。 | `MODIFIED Requirements` を書くときは `openspec/specs/<capability>/spec.md` の見出し名を厳密一致で再利用し、作成後に `openspec status --change <name>` で `4/4` を確認する。 |
| `openspec-apply-change` で `add-corporate-proxy-support` を実装し、擬似 Proxy 必須 E2E（未設定失敗→設定成功）まで完了。 | Proxy 必須検証を既存 E2E に後付けすると、テスト環境準備（擬似外部API/擬似Proxy）と UI 操作の責務が混ざり、失敗原因の切り分けが遅れる。 | Proxy 系 E2E は先に `scripts` へ環境フィクスチャ（ターゲット/Proxy）を分離実装し、シナリオ側は「未設定失敗・設定成功」の観測に専念させる。 |
| `add-corporate-proxy-support` を同期付きで archive し、main specs へ反映。 | archive 前の同期確認を省くと、delta spec の更新内容（追加/変更件数）が把握できず、意図した仕様反映かを説明しづらい。 | `archive` 実行時は同期サマリ（`+/-/~` 件数と capability 別内訳）を必ず確認し、完了報告に「どの spec が何件更新されたか」を明記する。 |

## 2026-02-26

| 変更内容 | ミス/課題 | 再発防止ルール |
|---|---|---|
| `show-thinking-content` で `/opsx:ff` を実行し、`proposal → design → specs → tasks` を依存順に作成して apply-ready まで完了。 | `specs` を先に作り始めると、proposal の capability 名と spec パスがずれて後で修正が発生しやすい。 | `/opsx:ff` では proposal 完了後に capability 名を固定し、`specs/<capability>/spec.md` をその名前で作成してから本文を埋める。作成ごとに `openspec status --change <name> --json` を再確認する。 |
| `web-ui` の thinking / command 表示を参照し、lilt-ai の assistant 実行中表示を構造化（Thinking 折りたたみ + Command ブロック）した。 | 実行中ログを単純なプレーンテキスト連結で持つと、thinking とコマンド実行情報が混在して可読性が急落する。 | 実行中表示は `status / thinking / tools` を構造化データとして保持し、renderer でセクション分けして描画する。最終回答テキストとは表示層で分離する。 |
| Thinking のデフォルト開閉と長文表示を再調整し、デフォルト折りたたみ＋行数上限＋追加展開に統一。 | 長文を一括表示すると pending 時の視線移動が大きく、重要なコマンド進捗が埋もれやすい。 | 実行中の長文ブロックは「初期は閉じる」「先頭N行だけ表示」「残りは明示的に展開」の3段階で設計し、情報密度と可読性を両立する。 |
| Thinking ブロックの開閉状態をセッション中に保持し、再描画時も同じ展開状態を維持。 | `details` の状態をDOM任せにすると、ストリーミング更新で再レンダリングされた際に開閉が初期化されやすい。 | 開閉状態はコンポーネント内の状態（メッセージキー→open）で保持し、`.open` バインド＋`@toggle` で双方向同期する。新規セッション時は状態を明示的にクリアする。 |
| 実装後に OpenSpec artifacts を逆同期し、仕様と実装の乖離を解消。 | 実装追加（折りたたみ初期状態・行数プレビュー・開閉状態保持）を specs/tasks に反映しないと、後続レビューで「未実装/仕様外」に見える。 | 実装変更後は proposal/design/specs/tasks をまとめて見直し、挙動追加分を requirement と task 完了状態へ即時反映する。 |
| Suggestion 対応として、Thinking 開閉状態のキーを message index 依存から stable message ID 依存へ変更。 | index ベースの UI 状態キーは、メッセージ挿入/削除/並べ替え時に別メッセージへ誤適用されるリスクがある。 | UI 状態キーは配列位置ではなく永続識別子（message ID / request ID）を使い、表示再構成に強い設計にする。 |
| 安定キーをさらに requestId 優先へ拡張し、同一実行ターン単位で Thinking 状態を管理。 | message ID 単体だと将来のメッセージ再構成時に「同一実行ターン」の状態共有を表現しにくい。 | 実行起点の状態管理は requestId を第一キーにし、requestId 未設定時のみ message ID にフォールバックする。run_start 時に pending メッセージへ requestId を注入する。 |
| requestId 優先キー化を OpenSpec artifacts（proposal/design/specs/tasks）へ逆同期。 | 実装だけ更新して artifacts を据え置くと、verify/archive 時に「仕様と実装の説明」が一致しなくなる。 | requestId など設計上の重要変更は、実装完了直後に proposal・design・spec・tasksを同時更新し、要求・判断・実装ステップの3点を揃える。 |
| E2E mock 応答を単発エコーから「thinking + 複数コマンド進行 + 最終回答」へ更新し、unit/E2E テストを同期。 | モックが最終テキストのみだと、進行可視化 UI の回帰を検知できず、実運用との差分が見えにくい。 | モック設計時は最終応答だけでなく loop イベント（thinking/tool start-end）も含め、UI が期待する進行表示をテストで必ず検証する。 |
| mock loop event を即時連打した際の E2E フレークを解消。 | IPC イベントと `submitPrompt` 完了レスポンスの到達順が近すぎると、renderer 側で進行表示反映前に最終判定して偽陰性になりうる。 | mock で進行イベントを検証する場合は、短い間隔で逐次送出するか、E2E 側でイベント到達待ちを入れて順序依存を排除する。 |
| Proxy 設定を「URL入力」から「環境変数利用 + useProxy チェック」へ変更し、OFF で環境変数を無効化・ON で利用する挙動を実装。 | デフォルト値をモジュール読込時に固定すると、テストや実行時に変更した環境変数が既定値へ反映されず、仕様（env があれば ON）とずれる。 | 環境変数依存の既定値は定数初期化で固定せず、インスタンス生成時または正規化時に都度評価する。 |
| thinking が表示されないケースに対し、`thinking_end` の content を fallback として loop event 化。 | provider により `thinking_delta` が来ず `thinking_end` の content だけが届く経路を想定していないと、UI に本文が一切表示されない。 | thinking 表示は `thinking_delta` だけに依存せず、`thinking_end.content` を補完経路として扱い、イベント形式の差異を吸収する。 |
| proxy 関連 spec を `http/https/no_proxy` 前提から `networkProxy.useProxy` 前提へ更新。 | 実装が boolean トグルへ移行した後に spec が旧入力項目のままだと、レビュー時に仕様/実装不一致として誤検知される。 | proxy モデル変更時は runtime/UI/E2E の spec を同時更新し、条件（ON/OFF）と設定キー名を実装と一致させる。 |
| `expand-oauthprovider-config-options` の OpenSpec change を新規作成し、初回 artifact（proposal）指示まで取得。 | OAuth provider 候補が複数ある要件で change 名を曖昧にすると、proposal 以降で対象範囲（許可値追加かUI改善か）がぶれやすい。 | `/opsx:new` 開始時に「対象設定（OAuthProvider）」「期待する許可値追加」を1行で固定し、目的が伝わる kebab-case 名で作成して `status` と `instructions` 表示で停止する。 |
| `openspec-ff-change` で `expand-oauthprovider-config-options` の proposal/design/specs/tasks を一括作成。 | Modified capability の delta spec で既存 Requirement 本文を省略すると、archive 時に仕様詳細が欠落して意図しない差分になる。 | `## MODIFIED Requirements` では既存 `### Requirement:` ごとに全文（説明＋全 Scenario）をコピーして更新し、作成後に `openspec status --change <name>` で `4/4` を確認する。 |
| `openspec-apply-change` で `expand-oauthprovider-config-options` を実装し、OAuth provider 選択肢5種・保存復元・E2E検証まで完了。 | GUI 検証を `npm run e2e:electron` のみに依存すると、`prebuild` の外部取得失敗（GitHub 403）で本体E2Eに到達できない場合がある。 | GUI変更時はまず `npm run e2e:electron` を試行し、外部依存で阻害された場合は `npx tsc -p tsconfig.json && npx vite build && node scripts/e2e-electron-agent-browser.js` で本体E2Eを実行し、`test/artifacts/electron-e2e.png` 生成を確認する。 |
| sync script を API から git 取得へ変更。 | GitHub API rate limit 403 で `prebuild` が停止した。 | 起動必須の取得は API より `git clone --sparse` を優先し、起動不能リスクを下げる。 |
| 設定画面の OAuth セクション文言を Claude 固有表現から provider 汎用表現へ修正。 | provider 対応を実装しても UI 文言に Claude 固有ラベルが残ると、機能実態と表示が不一致になり誤解を招く。 | provider 拡張時は UI 文言レビューで「特定provider名が残っていないか」をチェックし、セクション見出し・ボタン文言・補助説明を同時更新する。 |
| メイン画面の未準備ステータス文言を「プロバイダー設定が必要」へ統一。 | provider 対応後にステータスメッセージが provider 固有名を含むままだと、UX 文言と設定モデルがずれる。 | provider 複数対応時の状態文言は特定サービス名を避け、設定アクションを示す汎用表現（例: プロバイダー設定が必要）へ統一する。 |
| OAuth Provider を切り替えても認証ボタンで Claude サイトへ遷移する不具合を修正。 | OAuth Provider 選択値を UI ローカル状態に保持しただけで認証開始すると、保存済み設定（既定 anthropic）が使われ続ける。 | 設定依存のアクション（OAuth 開始）では、実行直前に対象設定を永続化してから処理を呼び出し、UI状態と実行時設定の乖離を防ぐ。 |
| `openspec-ff-change` で `add-liltobook-heartbeat-skill-integration` の artifacts（proposal/design/specs/tasks）を一括作成。 | 新規 capability と Modified capability を同時に扱う変更で、既存 spec 名の確認を省くと delta spec の配置先や要件種別（ADDED/MODIFIED）がぶれやすい。 | `ff-change` 着手時に `openspec/specs` の既存 capability 名を先に確定し、proposal の capability 宣言と `specs/<capability>/spec.md` の実ファイルを1対1で固定してから本文を作成する。 |
| `openspec-apply-change` で `add-liltobook-heartbeat-skill-integration` を実装し、heartbeat 起点の承認付きスキル化フローを追加。 | heartbeat 自律処理だけを実装すると、承認導線が別経路（通常プロンプト）に残ってユーザー確認要件が抜けやすい。 | 自律提案を入れる変更では、`submitPrompt` 側に pending 提案ハンドラ（承認/拒否/再案内）を先に実装し、heartbeat と通常対話の制御を同一ランタイムで完結させる。 |
| Mock なし再現用に `e2e-electron-liltobook-live` を追加し、heartbeat 提案→承認→重複未増加を自動検証可能にした。 | live E2E は認証前提（`.lilto-auth.json`）が欠けると途中失敗し、実装不具合と環境不備の切り分けが曖昧になる。 | live E2E には preflight で認証ファイル・mock無効・agent-browser可用性を先に検証し、満たさない場合は即時に明確な原因メッセージで停止する。 |
| `liltobook` live E2E の原因調査で heartbeat とユーザー送信の同時実行競合を切り分けた。 | heartbeat が実行中セッションに割り込むと `Agent is already processing` が発生し、提案待ちシナリオが `AGENT_BUSY` で崩れる。さらに baseline 応答文は provider 出力差で固定文言に揺らぎがある。 | heartbeat 系機能はランタイム側で「実行中ならスキップ」ガードを必須化し、live E2E は単一フレーズ固定一致ではなく代替表現を許容する待ち条件（複数候補一致）で実装する。 |
| `e2e-electron-liltobook-live` を安定化し、Step 直列化とログ起点待機で flake を解消した。 | 送信ボタン押下直後に次ステップへ進むと、前リクエストが未完了のまま次入力が重なって会話履歴条件（完了ターン）が欠落し、heartbeat proposal が発火しない。 | live E2E では各ステップで `待機中` ステータスを待ってから次入力へ進める。さらに heartbeat 成功は UI 文言依存ではなく Main ログ（`status\":\"proposed\"`）で待機し、表示検証はその後に行う。 |
