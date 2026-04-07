## Context

Lilt-o は現在、`npm run start` で TypeScript build とネイティブ補助バイナリ build を済ませたあとに `electron .` で起動する開発フローが中心である。`package.json` には `extraResources` の断片設定はあるが、配布ツール、アプリ metadata、成果物形式、配布後の検証手順が揃っていない。

一方で実装側では、`SchedulerService` は配布済みアプリを想定して `process.resourcesPath/bin` を参照できるが、`speech-transcriber` は依然として `process.cwd()` 基準で helper を探している。標準的な Electron アプリとしてインストール可能にするには、配布ビルド設定だけでなく、開発時と配布時の resource 解決を Main 側で統一する必要がある。

## Goals / Non-Goals

**Goals:**

- macOS と Windows で標準的にインストール可能な配布成果物を生成できるようにする。
- 開発起動用 script と配布ビルド用 script を分離し、配布時に必要な metadata と resource bundling を一元管理する。
- `scheduler-daemon` と `speech-transcriber` が、開発環境と配布済みアプリの両方で同じ規約に従って解決されるようにする。
- 配布成果物の存在確認と起動確認を、実装完了条件に組み込む。

**Non-Goals:**

- macOS notarization や Windows code signing の本番証明書運用をこの change で完了させること。
- 自動更新基盤の導入。
- Linux 向け配布成果物の追加。

## Decisions

### 1. 配布ツールは `electron-builder` を採用する

`electron-builder` を dev dependency として追加し、`package.json` もしくは専用設定ファイルに配布 metadata を集約する。代替として `electron-forge` もあるが、このリポジトリはすでに素の Electron + TypeScript/Vite 構成で動いており、forge へ寄せるより builder を後付けする方が変更面積が小さい。

採用理由:

- Windows NSIS installer と macOS の一般的な配布形式を少ない設定で出力できる。
- `extraResources` をそのまま活かしつつ、`files`、`asar`、`directories.output`、`win/mac` ごとの metadata を宣言的に追加できる。
- 現在の `build:native` と `build` script を前段として利用しやすい。

### 2. 配布成果物は macOS `dmg` と Windows NSIS installer を標準とする

「標準的な Electron アプリとしてインストールできる」という要求に対して、macOS は `.app` 単体より `dmg` が配布導線として自然であり、Windows は zip 展開より NSIS installer の方が期待に合う。そのため、最小構成として以下を標準成果物とする。

- macOS: `dmg` と内部の `.app`
- Windows: NSIS の `Setup.exe`

portable build や store 配布形式は非対象とし、必要になれば別 change で拡張する。

### 3. Main プロセスの native helper 解決を「development / packaged」の二段階へ統一する

ネイティブ helper の探索ロジックを共通化し、以下の順で解決する。

1. 明示的 override 環境変数
2. 開発環境の `native/**/bin` または build 出力
3. 配布済みアプリの `process.resourcesPath/bin`

`SchedulerService` ですでに使っている packaged fallback を、`speech-transcriber` にも拡張する。代替案として helper ごとに個別解決を維持する方法もあるが、packaging 対応の抜け漏れを増やすため採用しない。

### 4. 配布ビルド script は事前 build を内包した単一入口にする

`npm run dist` のような単一 script を追加し、以下を順に実行する。

1. `build:native`
2. `build`
3. `electron-builder`

これにより、配布手順を README や release 手順にそのまま書ける。開発者が `electron-builder` だけ直接叩く運用は、前段 build 漏れで壊れやすいため標準経路にしない。

### 5. 検証は「成果物生成」と「配布後起動前提」の両方を完了条件に含める

配布機能は unit test だけでは不十分なので、少なくとも以下を tasks の完了条件に含める。

- `npm run dist` による成果物生成
- `release/` 配下に想定ファイルが出ることの確認
- packaged resource path 前提の起動確認または path 解決テスト

GUI 変更ではないため live UI / E2E は主対象ではないが、配布後起動を壊していないことを示す検証は残す。

## Risks / Trade-offs

- [Risk] `electron-builder` 導入で build 時間と依存が増える
  Mitigation: 既存 build フローは保持し、配布ビルドだけ追加する。通常開発では `npm run start` を変えない。
- [Risk] macOS / Windows で要求される icon や metadata が不足すると packaging が失敗する
  Mitigation: 初期 change では最小必須 metadata を揃え、欠ける asset はプレースホルダーでもビルドが通る形で固定する。
- [Risk] `speech-transcriber` の packaged path 未対応がインストール版だけの不具合になる
  Mitigation: helper path 解決の共通関数化と packaged path 前提テストを追加する。
- [Risk] 署名なし配布物は OS 警告が出る
  Mitigation: 本 change では「インストール可能な artifact 生成」までを対象とし、署名運用は別 change に切り出す。

## Migration Plan

1. 配布設定と script を追加しても既存の `start` / `test` / `e2e:electron` が壊れない状態を保つ。
2. native helper path を開発時・配布時の両方に対応させる。
3. `npm run dist` を実行し、`release/` の成果物と native resource 同梱を確認する。
4. 問題があれば packaging 用 dependency と script、resource path 変更をまとめて revert し、開発起動フローだけに戻せるよう変更を局所化する。

## Open Questions

- アプリ名を `Lilt-o` のまま配布名へ使うか、表示名を別名へ調整するか。
- macOS icon / Windows icon をこの change で正式 asset に置き換えるか、暫定 asset で先に packaging を成立させるか。
