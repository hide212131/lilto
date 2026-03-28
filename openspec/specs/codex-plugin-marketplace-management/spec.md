# codex-plugin-marketplace-management Specification

## Purpose
TBD - created by archiving change add-codex-plugin-marketplace-support. Update Purpose after archive.

## Requirements
### Requirement: plugin marketplace source を解決できる
システムは、Codex plugin の source catalog として OpenAI curated marketplace と lilto 組み込み marketplace の両方を解決できなければならない（MUST）。marketplace 内の local path entry は `./` で始まる相対 path のみを受け付け、catalog root の外へ出る path を解決してはならない（MUST NOT）。

#### Scenario: OpenAI curated marketplace を catalog として読み込める
- **WHEN** lilto が OpenAI curated marketplace を更新または参照する
- **THEN** システムは curated repo cache から `marketplace.json` と対応する plugin bundle 群を解決し、catalog 一覧へ反映する

#### Scenario: 組み込み marketplace を catalog として読み込める
- **WHEN** アプリルート相対 `.agents/plugins/marketplace.json` が存在する
- **THEN** システムはその marketplace を source catalog として解決し、catalog 一覧へ反映する

#### Scenario: marketplace path traversal を拒否する
- **WHEN** marketplace entry が `./` で始まらない path または catalog root の外へ出る path を含む
- **THEN** システムはその entry を採用せず、失敗として扱える状態を返す

### Requirement: plugin の install state を管理できる
システムは、選択した marketplace entry から Codex plugin をインストールし、一覧表示し、user-installed plugin のみ削除できなければならない（MUST）。install/list/uninstall は Codex 本体の plugin 管理経路と整合した API を通じて実行しなければならず（MUST）、インストール時は source marketplace と plugin ID を追跡できる metadata を保存しなければならない（MUST）。

#### Scenario: marketplace entry から plugin をインストールできる
- **WHEN** ユーザーが marketplace 一覧から plugin を選んでインストールする
- **THEN** システムは plugin bundle を managed plugin store へ配置し、install metadata を保存する

#### Scenario: インストール済み plugin 一覧を取得できる
- **WHEN** ユーザーが installed plugin 一覧を要求する
- **THEN** システムは plugin 名、version、source marketplace、install path、種別を含む整合的な一覧を返す

#### Scenario: user-installed plugin を削除できる
- **WHEN** ユーザーが user-installed plugin の削除を要求する
- **THEN** システムは対象 plugin bundle と install metadata を削除し、一覧から除外する

#### Scenario: bundled または system plugin の削除を拒否する
- **WHEN** ユーザーが bundled または system 扱いの plugin を削除しようとする
- **THEN** システムはその要求を拒否し、失敗結果を返す

### Requirement: installed plugin store を更新できる
システムは、インストール済み plugin を Codex runtime が読める install store へ反映しなければならない（MUST）。lilto は install store レイアウトを独自実装せず、Codex 本体の plugin install/uninstall 結果と整合した state を利用しなければならない（MUST）。install/uninstall 後は install store の状態が更新され、次回送信または新規 thread から反映できなければならない（MUST）。

#### Scenario: install 後に Codex 管理の install store が更新される
- **WHEN** plugin インストールが成功する
- **THEN** システムは Codex 本体が更新した install store を利用し、インストール済み plugin を Codex runtime から参照可能にする

#### Scenario: uninstall 後に Codex 管理の install store から除外される
- **WHEN** plugin 削除が成功する
- **THEN** システムは Codex 本体が更新した install store を利用し、対象 plugin を installed state から除外する

#### Scenario: install store 更新失敗を表面化する
- **WHEN** plugin store または install store の更新に失敗する
- **THEN** システムは成功扱いにせず、UI が扱える失敗結果を返す