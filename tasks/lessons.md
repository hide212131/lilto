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
