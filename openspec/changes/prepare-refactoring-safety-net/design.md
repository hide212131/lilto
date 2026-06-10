## Context

Lilt-o のリファクタリング計画では、main / renderer / build scripts を段階的に分割する前提になっているが、現状の検証基盤はその反復速度と回帰検知の両方で不足している。`npm test` は `dist/` を前提にフルビルドを要求し、CI では型チェックや unit テストを継続的に止める仕組みがないため、小さな構造変更でも確認コストが高い。

加えて、フェーズ 2 以降で分割対象になる `src/main/ipc.ts` は多数のハンドラを 1 ファイルに集約しており、チャネル名や payload 形状が暗黙のまま変化しやすい。フェーズ 0 では本番機能を変えずに、後続フェーズの安全網だけを先に整備する必要がある。

## Goals / Non-Goals

**Goals:**

- renderer バンドルを経由しない高速な unit テスト経路を追加し、main / shared 中心の変更確認を短縮する。
- macOS と Windows の両方で型チェックと unit テストを自動実行する CI ゲートを追加する。
- 未使用 export / 依存関係 / ファイル数 / 行数のベースラインを記録し、後続フェーズとの比較基準を固定する。
- IPC 分割前に、主要チャネルの契約を固定する特性テストを追加する。

**Non-Goals:**

- プロダクト機能や UI 挙動を変更すること。
- リファクタリング本体の実施や `src/main/ipc.ts` の分割を始めること。
- knip や depcheck の結果を使った削除作業そのものをこの change で完了すること。
- フルの packaged build や GUI E2E のフローを置き換えること。

## Decisions

### 1. 高速確認用に `test:unit` を `tsc + node --test` 経路として追加する

後続の main / shared リファクタリングでは、renderer バンドルが不要なケースが多い。そのため `npm test` は従来のフル検証として残しつつ、フェーズ 0 では `tsc -p tsconfig.json` と `node --test` を組み合わせた `test:unit` を追加する。

代替案として test runner 自体の刷新もありうるが、フェーズ 0 の目的は安全網の追加であり、テスト基盤の全面更新ではない。既存の `dist/` 依存を最小限のスクリプト差分で短縮する方が変更面積を抑えられる。

### 2. TypeScript の incremental build を有効化して局所変更の再検証を短縮する

`test:unit` を繰り返し使う前提では、毎回フル再コンパイルすると効果が薄い。そこで main 用の TypeScript build に incremental を有効化し、開発時の反復を速くする。成果物の置き場は既存の build フローと衝突しない位置に保つ。

### 3. CI は既存 workflow を壊さず、独立した品質ゲートとして追加する

既存の Windows ネイティブ build workflow はそのまま維持し、新規 workflow で macOS / Windows の `tsc --noEmit` と `npm run test:unit` を実行する。これにより、配布やネイティブ build の失敗とは分けて、日常的な型・単体回帰だけを早く検知できる。

代替として既存 workflow にジョブを足す案もあるが、役割が異なるため分離した方が失敗原因を追いやすい。

### 4. ベースライン計測は `tasks/refactoring-baseline.md` に保存する

未使用 export、未使用依存、ファイル数、行数、主要テスト所要時間は、後続フェーズの効果測定に使う。ログだけに残すと比較しづらいため、レビュー対象として追跡できる Markdown ファイルへ保存する。

計測コマンドは `knip` を第一候補とし、必要に応じて `depcheck` や行数集計コマンドを併用する。フェーズ 0 では「現状の記録」を目的とし、自動修正は行わない。

### 5. IPC 安全網は実装詳細ではなく契約の固定を優先する

`ipc.ts` の分割前に必要なのは、内部実装の構造ではなく、チャネル名と引数・戻り値の形が変わっていないことの保証である。そのため特性テストは `*-ui-contract.test.js` に近い流儀で、公開チャネル単位の契約を固定する。

代替として `ipc.ts` の全分岐を詳細に unit test 化する方法もあるが、フェーズ 0 ではコストが高く、分割前の safety net としては過剰である。

## Risks / Trade-offs

- [Risk] `test:unit` と従来の `npm test` の責務が曖昧になる
  Mitigation: `test:unit` は高速な main/shared 回帰確認、`npm test` はフル build を含む総合検証として README や tasks に役割を明記する。
- [Risk] incremental build の cache が壊れると偽陽性・偽陰性につながる
  Mitigation: CI ではクリーン環境で同じコマンドを実行し、ローカル cache 依存の不整合を検知する。
- [Risk] knip や depcheck が動的参照を未使用と誤判定する
  Mitigation: ベースライン記録では機械的な検出結果を保存するだけに留め、削除判断は後続フェーズで grep と実行検証を前提に行う。
- [Risk] IPC 特性テストが実装に密着しすぎると、将来の分割でノイズになる
  Mitigation: チャネル契約の表面だけを対象にし、内部 helper や登録順序には依存しない形で書く。

## Migration Plan

1. `test:unit` と incremental build を追加し、既存の `npm test` を残したまま並行運用できるようにする。
2. CI workflow を追加し、ローカルと同じ型チェック・unit テストを macOS / Windows で実行する。
3. ベースライン計測を取得して `tasks/refactoring-baseline.md` に保存する。
4. IPC 特性テストを追加し、分割前の公開契約を固定する。
5. 問題があれば新設した script / workflow / ベースライン文書 / 特性テストだけを個別に巻き戻せるよう、変更を局所化する。

## Open Questions

- `test:unit` の対象から renderer 関連テストをどこまで除外するか。
- IPC 契約テストで固定するチャネル範囲を全 33 ハンドラにするか、公開 API 相当のものに限定するか。
- ベースライン計測にテスト実行時間の実測を含める場合、ローカル値と CI 値のどちらを正本として扱うか。