## Context

現状の OAuth 認証実装は `auth-service` 内で `anthropic` 固定の provider 解決を行っており、Settings 側にも OAuth provider の選択状態を保持するデータ構造がない。一方で `Providers & Models` には active provider（`claude` / `custom-openai-completions`）と Custom Provider 設定の保存機構がすでにあるため、今回の変更ではこの保存機構を拡張し、OAuth provider 選択を同じ経路で永続化・適用する。

## Goals / Non-Goals

**Goals:**
- OAuth provider を `anthropic` / `openai-codex` / `github-copilot` / `google-gemini-cli` / `google-antigravity` から選択・保存・復元できる。
- OAuth 開始時に選択済み provider を `getOAuthProvider(providerId)` へ渡し、実行先を切り替える。
- Renderer の送信可否文言と Settings 状態表示が、選択中 OAuth provider に追従する。

**Non-Goals:**
- OAuth provider ごとの追加入力項目（スコープやリージョン）を新設すること。
- Custom Provider（OpenAI Completions Compatible）の保存項目や実行経路を再設計すること。
- 新規 provider 文字列を動的取得すること（今回は固定列挙値のみ）。

## Decisions

1. ProviderSettings に `oauthProvider` を追加し、既定値は `anthropic` とする。
- 理由: 既存の `providers:getSettings` / `providers:saveSettings` 経路を再利用でき、保存処理の責務を増やしすぎない。
- 代替案: `auth-service` 専用ファイルで OAuth provider を別保存する。
- 不採用理由: 設定画面の状態源泉が分散し、再起動復元・UI反映が複雑になる。

2. OAuth provider は shared 型で union literal として定義し、Main/Renderer で同一型を共有する。
- 理由: 許可値の不一致（UI は追加済みだが Main が未対応）をコンパイル時に防げる。
- 代替案: string で受け取り実行時に正規化する。
- 不採用理由: 無効値の混入検知が遅れ、保存済み不正値に起因する実行時エラーが増える。

3. `auth-service` の provider 解決を `oauthProvider` 引数化し、未解決時は provider 名を含む失敗理由を返す。
- 理由: provider 拡張時の調査容易性を上げ、ユーザーに再設定の判断材料を提示できる。
- 代替案: 未解決時も汎用エラー（認証失敗）で返す。
- 不採用理由: 選択値ミスと一時的ネットワーク障害の区別ができない。

4. Settings UI は OAuth provider 選択（select/radio）を Claude セクション内に追加し、保存は既存「保存」操作で一括処理する。
- 理由: 既存操作モデルを維持でき、ユーザーが provider 切替後に保存忘れしにくい。
- 代替案: OAuth provider 切替時に即時保存する。
- 不採用理由: 一部入力だけ先に保存されるため、Custom/Proxy の保存単位と一貫しない。

## Risks / Trade-offs

- [Risk] provider を切り替えても旧トークンが残り、期待しない provider で送信可能に見える可能性。
  → Mitigation: 認証状態の判定を「選択中 oauthProvider と一致する資格情報があるか」に変更し、不一致時は未認証として扱う。

- [Risk] 既存保存ファイルに `oauthProvider` がなくても読める必要がある。
  → Mitigation: load 時に後方互換デフォルト `anthropic` を補完し、save 時に新項目を常に出力する。

- [Trade-off] 固定列挙値で先に制約するため、将来 provider 追加時にコード修正が必要。
  → Mitigation: 列挙値は shared 定義1箇所に集約し、UI/validation/runtime が同時更新される構造にする。

## Migration Plan

1. shared 型と provider-settings 永続化形式へ `oauthProvider` を追加し、既存ファイル読み込み互換を確保する。
2. Settings UI に OAuth provider 選択欄を追加し、保存 payload に `oauthProvider` を含める。
3. `auth-service` の OAuth 開始処理を `oauthProvider` 指定で呼び出すよう更新する。
4. provider 別の送信可否判定・メッセージを更新し、ユニット/統合テストを追加する。

## Open Questions

- `openai-codex` / `github-copilot` / `google-gemini-cli` / `google-antigravity` で Pi `ai` 側が返す認証状態差分（必要入力・失敗コード）を UI でどこまで個別表示するかは実装時に観測して必要最小限で調整する。
