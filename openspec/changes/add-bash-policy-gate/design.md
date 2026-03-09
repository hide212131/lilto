## Context

lilto は Electron Main プロセス内で `pi-coding-agent` SDK を起動し、custom tool を追加して agent runtime を構成しています。一方、Pi 本体の built-in `bash` は `operations`、`commandPrefix`、`spawnHook` などの実行差し替え用オプションは持つものの、公開 API として Allow / Deny リストは持っていません。

Pi の extension API では `tool_call` イベントで `bash` 実行前に介入でき、公開サンプル `permission-gate` も危険コマンドを確認またはブロックする流れを採っています。したがって lilto 側でまず採るべき実装は、built-in `bash` を置き換えるより前に、runtime が読み込む extension で `bash` 呼び出しを前段判定する構成です。

この change は安全性だけでなく、既存 runtime 互換性も重視します。既存の Bash 実行結果表示、Windows の `.cmd` 優先実行、将来の `bash` override 余地を壊さず、設定ファイルと監査ログを加える設計が必要です。

## Goals / Non-Goals

**Goals:**
- `bash` tool 実行前に `deny` / `confirm` / `allow` / `audit` を判定する policy gate を lilto の Pi runtime に追加する。
- ルールを YAML 設定ファイルで管理し、正規表現ベースの一般的な危険コマンド制御と保護パス制御を実現する。
- `confirm` は UI 確認、`deny` は理由付きブロック、`audit` は JSON Lines 監査ログ出力として標準化する。
- ポリシー未設定・設定破損・非対話実行時の fail-safe 動作を明確化し、テストで固定する。

**Non-Goals:**
- 初版で built-in `bash` を完全に置き換える custom tool override を実装しない。
- 完全な shell parser や alias/function 展開後の意味解析までは行わない。
- 組織横断の集中管理サーバー、複数端末同期、クラウド配布ポリシーは扱わない。

## Decisions

1. **実装方式は `tool_call` extension を第一段階とする**
   - lilto は `DefaultResourceLoader` に app 管理の extension path または inline extension factory を追加し、Pi session 作成時に常に `bash-policy-gate` を読み込む。
   - extension は `tool_call` で `event.toolName === "bash"` のみを対象にし、`event.input.command` を判定して `block` または UI 確認を返す。
   - 理由: built-in `bash` の既存描画・出力 shape・OS 依存処理を流用でき、初期実装の差分が最小で済むため。
   - 代替案: built-in と同名の `bash` custom tool を登録して override する。
   - 不採用理由: 結果 shape とレンダラ互換を lilto 側で再実装する必要があり、初版の目的に対して過剰。

2. **ポリシーは `PolicyLoader` / `CommandNormalizer` / `PolicyEngine` / `GateExtension` に分離する**
   - `PolicyLoader` は YAML を読み、effect・regex・protectedPaths・default action を runtime 用構造へ変換する。
   - `CommandNormalizer` は空白整理、複合コマンド区切りの簡易抽出、引用符を壊さない程度の前処理を行う。
   - `PolicyEngine` は `deny` → `protected path deny` → `confirm` → `allow/audit` → `default` の順で評価し、決定と一致ルールを返す。
   - `GateExtension` は Pi extension として engine を呼び、UI・ログ・block 応答へ変換する。
   - 理由: ルール評価、UI、ログを分離すると単体試験しやすく、将来の `bash` override でも engine を再利用できるため。

3. **設定ファイルは YAML、既定値は `default: confirm` を採る**
   - 初版の保存場所は app config から解決する。候補は `userData` 配下既定ポリシー、または env/config で上書きできる path とする。
   - schema には `default`, `nonInteractiveDefault`, `rules`, `protectedPaths`, `auditLog`, `explain` を含める。
   - 理由: 運用者が編集しやすく、未一致コマンドを即 deny にしないことで開発時の停止率を下げられるため。
   - 代替案: JSON 固定またはコード埋め込みルール。
   - 不採用理由: 人手編集の見通しが悪く、組織ごとの調整がしづらい。

4. **判定はコマンド文字列ヒューリスティックを基本にし、保護パス判定を併用する**
   - ルールの初版 match type は `regex` を中心にし、`protectedPaths` は引数中の path らしき token を `minimatch` 相当で照合する。
   - `rm -rf`, `sudo`, `chmod 777`, `git push`, `npm publish`, `curl` などの典型ケースは同梱デフォルトルールでカバーする。
   - 理由: `tool_call` 時点では生の command 文字列が最も安定した入力であり、完全な shell 解釈より先に危険操作の大半を防げるため。
   - 代替案: シェル AST 解析や spawn 後フックでの実行監視。
   - 不採用理由: 初版の複雑さが高く、Pi extension の範囲を超えやすい。

5. **`confirm` は UI 依存、非対話時は fail-safe 既定値へフォールバックする**
   - `ctx.hasUI` がある場合は、実行コマンド・判定理由・一致ルール ID を含む確認 UI を出し、「今回だけ許可」「拒否」を選ばせる。
   - `ctx.hasUI` がない場合は `nonInteractiveDefault` を適用し、既定は `deny` とする。
   - 理由: CI や自動実行で確認ダイアログ待ちに陥らず、安全側へ倒せるため。

6. **監査ログは app 管理 JSONL とし、通常 logger とは分ける**
   - ログ項目は `ts`, `sessionId`, `cwd`, `tool`, `command`, `decision`, `ruleId`, `approved`, `reason` を持つ。
   - `audit` と `confirm` は必ず記録し、`deny` も記録対象に含める。`allow` はオプションで記録できる形にする。
   - 理由: console logger は人間向けであり、後から集計・監査する用途には JSONL が適するため。

7. **将来の `bash` override を見据え、判定結果は transport-agnostic な構造にする**
   - `PolicyEngine` の返り値は `decision`, `ruleId`, `reason`, `matchedText`, `requiresConfirmation` を持つ純粋データにする。
   - 理由: 第2段階で built-in 置換や remote execution へ進んでも policy 部分を再利用できるため。

## Risks / Trade-offs

- **[Risk] shell 展開や入れ子の `bash -lc` を完全には読めず、危険操作を見落とす可能性がある**
  - Mitigation: 初版は典型回避パターン（`sh -c`, `bash -lc`, `xargs`, `&&`, `;`）をテストに含め、将来 override へ進める境界を design に明記する。

- **[Risk] 既定値が厳しすぎると通常の開発作業まで毎回止まる**
  - Mitigation: 既定値を `confirm` にし、読み取り中心コマンドは明示 `allow` ルールを同梱する。

- **[Risk] YAML 破損時の挙動が曖昧だと、安全性と使い勝手が環境ごとにぶれる**
  - Mitigation: `policyLoadErrorMode` を config で明示し、既定を `confirm` または `deny` に固定する。テストでも両モードを確認する。

- **[Trade-off] extension 方式では built-in `bash` の内部実行詳細までは制御できない**
  - Mitigation: 本 change では「実行前に止める」ことへ責務を絞り、書き換えや remote routing が必要になったら第2段階で override を別 change に切り出す。

## Migration Plan

1. app config に policy path / audit log path / fail-safe mode を追加し、既定 YAML を読めるようにする。
2. `PolicyLoader` / `PolicyEngine` / `GateExtension` を追加し、`createPiSessionFromSdk` の `resourceLoader` 構成へ組み込む。
3. 代表的な deny / confirm / allow / audit ルールと protected path 判定の単体テストを追加する。
4. runtime 統合テストで、`bash` tool 実行前に block / confirm が発火すること、Windows 経路を壊さないことを確認する。
5. 将来 override が必要になった場合は、同じ engine を使う新 change で `bash` custom tool 置換へ拡張する。

ロールバックは policy gate extension の読み込みを停止し、追加設定を未使用に戻せばよい。既存 built-in `bash` の実行経路自体は変更しないため、機能切り戻しは比較的容易である。

## Open Questions

- policy 設定ファイルの既定配置を `userData` 配下テンプレート生成にするか、repo 配下のサンプル参照にするか。
- `protectedPaths` 判定で glob 展開をどこまで許容するか。`~` 展開や Windows path separator を engine 側で正規化する範囲。
- `audit` を `allow` と別 decision にするか、`allow + log` の属性として持つか。初版は user-facing に分かりやすい `audit` を採るが、実装表現は再確認余地がある。
- lilto の Renderer 側で `confirm` 理由をどの程度視覚化するか。Pi の標準 UI で十分か、追加の app ログ表示が必要か。
