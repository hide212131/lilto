## Context

現在の `src/main/agent-sdk.ts` は `buildCodexSdkEnvironment()` で `process.env` をそのままコピーし、`CODEX_HOME` と一部の `PATH` 追記だけを行って `new Codex({ env })` に渡している。これは「Electron Main がどの環境で起動されたか」をそのまま Codex 実行条件として固定しており、Windows で Explorer やスタートメニューから起動した場合に、対話的に開いた `cmd` / `PowerShell` で見えている `PATH` や標準環境との差分を吸収できない。

一方で、exact に「現在ユーザーが開いている shell セッション」と同じ環境を再現するのは難しい。shell profile の実行は任意コード実行になり、起動遅延と副作用も大きい。そのため、今回の設計では Codex 実行に必要な標準環境を安全に補完しつつ、lilto が管理する `CODEX_HOME`、proxy、MCP bridge、packaged Codex binary path などの override を壊さないことを優先する。

## Goals / Non-Goals

**Goals:**
- `new Codex({ env })` に渡す environment を、Electron 親プロセスの生 `process.env` から分離して組み立てられるようにする。
- Windows では `PATH` と代表的な標準環境変数を、persistent な User/Machine 環境から補完できるようにする。
- `CODEX_HOME`、proxy、scheduler bridge、packaged Codex path など lilto 管理の値が最終的に優先される構成にする。
- environment 解決ロジックをユニットテスト可能な helper に切り出し、Electron 起動差分をテストで固定する。

**Non-Goals:**
- PowerShell profile や `cmd` AutoRun を実行して、現在の対話 shell セッションを完全再現すること。
- 設定画面に environment 編集 UI を追加すること。
- `HOME` / `USERPROFILE` の境界方針を再変更すること。
- Codex SDK 以外のすべての子プロセス起動経路を同時に置き換えること。

## Decisions

1. Codex SDK 向け environment builder を非同期 helper として分離する。

`createCodexThreadFromSdk()` の中で直接 `process.env` をコピーするのではなく、Codex 起動直前に `resolveCodexSdkEnvironment()` のような helper を呼び出して最終 env を取得する。helper は将来的に auth/app-server 起動へも再利用できるが、この change ではまず Codex SDK 経路を対象にする。

代替案として既存の同期 `buildCodexSdkEnvironment()` を拡張する方法もあるが、Windows の補完処理に外部コマンド実行または非同期 I/O を含めたくなった時点で破綻しやすい。

2. Windows の補完元は「shell profile」ではなく persistent な User/Machine 環境にする。

Windows では PowerShell などを介して User/Machine environment を機械可読で取得し、`PATH`、`PATHEXT`、`ComSpec`、`SystemRoot`、`windir`、`TEMP`、`TMP` のような標準変数を補完対象にする。`PATH` は文字列全置換ではなく、現在の `process.env.PATH` を先頭に保ったまま、persistent 環境にのみ存在する directory を後ろへ追加する。

この方針により、Electron が古い `PATH` を持って起動していても Codex 実行では最新の persistent path を参照しやすくなる。一方で shell profile 実行を避けるため、任意コード実行や起動遅延を持ち込まない。

3. lilto 管理 override は補完後に再適用する。

Windows 補完で得た environment をそのまま使うのではなく、最終段で次の値を再適用する。

- `CODEX_HOME`
- proxy 関連 override
- packaged Codex binary の `extraPath`
- Windows で必要な PowerShell search path 補助
- scheduler bridge 用 env
- `ELECTRON_RUN_AS_NODE` など Electron 固有補助

これにより、環境補完が app-managed state や runtime bridge 設定を上書きすることを防ぐ。

4. 補完失敗時はログを残して `process.env` ベースへフォールバックする。

Windows 環境取得に失敗しても、Codex 実行自体は止めない。helper は失敗をログへ記録し、既存同等の `process.env` ベース構築へ戻す。これにより改善機能を fail-open に保ち、既存動作を退行させない。

5. テストは merge ルールを pure function として固定する。

実装では「Windows persistent env の取得」と「env merge ルール」を分ける。`PATH` の重複排除、standard key 補完、lilto override 優先は pure function の単体テストで確認し、外部コマンド呼び出し部分は stub 可能な薄い層に留める。

## Risks / Trade-offs

- [現在の対話 shell でだけ一時的に設定した env は再現できない] → profile 実行ではなく persistent env 補完を明示仕様とし、exact な shell 複製はスコープ外にする。
- [Windows 補完取得が遅いと初回送信待ち時間が伸びる] → 1 プロセス内で結果をキャッシュし、取得失敗時は即時フォールバックする。
- [過剰に多くの変数を上書きすると app-managed env を壊す] → 補完対象 key を限定し、最終段で lilto override を再適用する。
- [Codex SDK と他 subprocess で env 挙動がずれる] → helper を再利用可能な形で切り出し、後続 change で auth/app-server へ横展開しやすくする。

## Migration Plan

1. Codex SDK 用 environment helper を導入する。
2. `createCodexThreadFromSdk()` を helper 利用へ切り替える。
3. 既存の `CODEX_HOME` / proxy / packaged path の優先順をテストで固定する。
4. Windows 環境差分を模したテストを追加する。

ロールバック時は helper 呼び出しを外し、既存の `process.env` コピー実装へ戻せばよい。

## Open Questions

- 同じ helper を `auth-service` と `codex-app-server-client` に同ターンで適用するかは実装時の変更規模を見て判断する。少なくとも API は共有可能な形で切り出す。