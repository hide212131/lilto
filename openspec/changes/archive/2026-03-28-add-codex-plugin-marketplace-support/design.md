## Context

現在の lilto は Codex skill の一覧・導入・削除を Main プロセス側で管理していますが、Codex plugin については marketplace の探索、インストール、削除、runtime への反映を扱う境界を持っていません。一方で Codex plugin の公式ドキュメントでは、plugin は marketplace JSON と plugin bundle の組み合わせで扱われ、repo marketplace または personal marketplace から Codex が読み込む構成が前提です。

今回の要件では、OpenAI curated marketplace と、アプリルート相対 `.agents/plugins/marketplace.json` の両方を扱える必要があります。ただし OpenAI curated marketplace の entry は repo 相対 `./plugins/...` を前提にしているため、`marketplace.json` 単体を参照するだけでは動作しません。一方で Codex 本体のコードを確認すると、TypeScript SDK README には plugin API は出ていないものの、app-server protocol v2 には `plugin/list` / `plugin/read` / `plugin/install` / `plugin/uninstall` RPC が存在し、内部実装も `PluginStore` を通じて `plugins/cache` レイアウトを管理しています。そのため v1 は filesystem layout を再実装するより、lilto 側で plugin source catalog を補いながら Codex app-server RPC を adapter の裏で利用する設計が妥当です。

## Goals / Non-Goals

**Goals:**

- OpenAI curated marketplace と lilto 組み込み marketplace の両方を source catalog として扱えるようにする。
- plugin install/list/uninstall と install metadata 管理を Main プロセスへ集約する。
- インストール済み plugin を lilto が管理する Codex 実行環境へ materialize し、通常の Codex runtime から利用可能にする。
- plugin 管理の backend を adapter 境界の裏へ閉じ込め、将来の SDK plugin API へ移行しやすくする。
- Settings モーダルに `Plugins` タブを追加し、v1 として必要十分な管理 UI を提供する。

**Non-Goals:**

- v1 で専用の plugin browser 画面を新設すること。
- v1 で plugin ごとの enable/disable UI を追加すること。
- plugin manifest 内の app / MCP / asset 全機能を個別 UI で露出すること。
- OpenAI curated marketplace の公開更新をリアルタイム同期すること。

## Decisions

### 1. plugin 管理は `PluginService` + app-server RPC adapter 境界へ分離する

`skills` 管理と同様に Main プロセスが状態管理を担いますが、plugin は skill runtime に直接混ぜず、`PluginService` または同等の adapter interface を新設して閉じ込めます。Renderer / IPC / runtime はこの interface だけに依存し、現時点では Codex app-server の `plugin/list` / `plugin/read` / `plugin/install` / `plugin/uninstall` RPC を呼ぶ backend を実装します。lilto は source catalog の解決と、RPC 入出力を UI 向け state へ写像する責務を持ちます。

理由は、Codex 本体が既に plugin install/uninstall の正規経路を app-server に持っており、`plugins/cache` レイアウトもその内部で管理しているためです。SDK に plugin API が追加されたときにも UI 契約や runtime 起動コードを崩さず、backend 実装だけ差し替えられます。

代替案として `skill-runtime.ts` に plugin ロジックを直接追加したり、Codex の cache layout を lilto 側で再実装する案もありますが、内部レイアウト追従の負荷が高く、Codex 側の install フローとも乖離するため採用しません。

### 2. source catalog と Codex 管理の installed plugin store を分離する

v1 では plugin の状態を 2 種類に分けます。ひとつは探索元としての source catalog、もうひとつは Codex が管理する installed plugin store です。lilto 組み込み `.agents/plugins/marketplace.json` と OpenAI curated repo は source catalog として扱い、インストール済み plugin の正は Codex app-server が管理する `CODEX_HOME/plugins/cache/...` に委ねます。personal marketplace の `~/.agents/plugins/marketplace.json` は必要になった場合でも「追加の source catalog」を表すものであり、インストール済み一覧の正としては扱いません。

理由は、公式ドキュメントでも marketplace は「Codex can read and install」するための catalog とされ、実コードでも `PluginStore::new(codex_home)` が `plugins/cache` を install 先として管理しているためです。app root の組み込み catalog と実際の install state を混同しないことで、公式の install model に寄せられます。

代替案として source catalog をそのまま runtime から読ませたり、installed state も personal marketplace JSON で表現する案もありますが、OpenAI curated のように repo 相対 path を含む catalog を install 済み state と同一視すると、公式の cache ベースの install model と整合しません。

### 3. OpenAI curated marketplace は app-server の curated flow を使う

OpenAI curated marketplace は `marketplace.json` の各 entry が `./plugins/<name>` を指すため、`marketplace.json` の fetch だけでは plugin bundle 本体を解決できません。Codex 本体には official curated marketplace と remote sync の経路があり、`plugin/list(forceRemoteSync=true)` や `plugin/install(forceRemoteSync=true)` がその流れを利用します。そのため v1 は curated source を利用するとき、可能な限り app-server の curated flow を使い、lilto 側は source catalog 選択と force sync の制御だけを持ちます。

理由は、公式 curated の path 規約と remote state の扱いを Codex 本体に委ねられ、upstream 構造変更も lilto が直接追わずに済むためです。

代替案として entry を都度 remote URL へ書き換えて擬似 catalog を生成したり、repo cache を lilto が独自同期する案もありますが、plugin bundle 一式の整合性と update 判定が複雑になるため採用しません。

### 4. install metadata は plugin 単位 record と app-server 応答で保持する

plugin install 後は lilto 側でも UI 用 metadata record を持ちますが、plugin の実インストールと削除は app-server 応答を正とします。少なくとも `marketplaceId`, `marketplacePath`, `pluginId`, `sourceKind`, `installedVersion`, `installedAt` を保持し、一覧や UI 状態は `plugin/list` と照合可能にします。

理由は、実インストール先レイアウトを lilto が所有しない一方、UI では install 元 source や最終操作履歴を保持したいためです。

代替案として installed bundle の manifest だけで状態を復元する案もありますが、元 marketplace や UI 上の source 選択との対応が弱くなります。

### 5. runtime 反映は managed `HOME` / `CODEX_HOME` と app-server state の一貫性で担保する

plugin install state が存在しても、Codex runtime と app-server が別の `HOME` や `CODEX_HOME` を見ていれば利用できません。そのため plugin service が呼ぶ app-server と `AgentRuntime` は同じ managed `HOME` / `CODEX_HOME` を使う前提にそろえます。install/uninstall のたびに plugin 関連 cache と runtime cache を更新し、次回送信または新規 thread から plugin が有効になるようにします。

理由は、skill 管理で既に同種のズレが問題化しており、plugin でも同じ失敗を避ける必要があるためです。

代替案として install state だけ app 側で保持し runtime 側の読み込みは再起動任せにする案もありますが、ユーザー体験が悪く、状態の不一致も調査しづらくなるため採用しません。

### 6. Settings UI は `Agent Skills` と同型の最小管理 UI を採用する

v1 の `Plugins` タブは Settings モーダル内に追加し、source catalog 切替、catalog 一覧、install、installed list、uninstall、状態表示までに限定します。plugin の利用は専用 UI ではなく通常の Codex chat runtime から行う前提とし、「次回送信または新しい thread から反映」という文言で接続します。

理由は、すでに `Agent Skills` タブがあり、操作モデルをそろえることで学習コストと実装コストを抑えられるためです。

代替案として plugin browser を別画面で作る案もありますが、v1 では過剰です。

## Risks / Trade-offs

- [OpenAI curated repo の構造変更] → repo cache 同期時に marketplace と plugin path の整合を検証し、崩れたら catalog 読み込み自体を失敗として表面化する。
- [SDK に plugin API が追加されたとき現在実装が密結合になる] → Renderer / IPC / runtime は `PluginService` interface のみを参照し、現在の app-server RPC 依存は backend 実装へ閉じ込める。
- [marketplace path traversal や不正 path 混入] → `./` prefix と base path containment を必須にし、skills repo の manifest parser と同等の防御を流用する。
- [lilto UI state と app-server plugin state の不整合] → install/uninstall 完了後に `plugin/list` を再取得して UI state を再同期し、lilto 側 record は補助情報として扱う。
- [plugin に app/MCP 連携が含まれる場合の初回利用失敗] → v1 では install surface と state 管理までを対象にし、接続や認証は Codex 側の標準導線へ委ねることを UI と docs に明記する。

## Migration Plan

1. OpenSpec で plugin 管理 capability と runtime/UI delta を確定する。
2. Main に plugin service、app-server RPC adapter、catalog source resolver、UI 用 plugin metadata record を追加する。
3. IPC / preload / Settings の `Plugins` タブを追加する。
4. `AgentRuntime` を plugin service と同じ managed `HOME` / `CODEX_HOME` へそろえ、install/uninstall 後に refresh する。
5. unit test、contract test、manual verification、最終 E2E を通してから apply 完了とする。

## Open Questions

- なし。v1 は source catalog 2 種、Settings 内最小 UI、adapter 境界の採用で進める。