# browser-automation-skill Specification

## Purpose
TBD - created by archiving change agent-browser-skill. Update Purpose after archive.
## Requirements
### Requirement: `agent-browser` スキルの組み込み提供
システムは `agent-browser` スキルを組み込みで提供しなければならない（SHALL）。

#### Scenario: 組み込みスキルの存在
- **WHEN** スキル一覧が取得される
- **THEN** `agent-browser` が一覧に含まれる

### Requirement: ブラウザ操作依頼時の優先選択
チャットでブラウザ操作が求められる場合、システムは `agent-browser` を優先して選択しなければならない（SHALL）。

#### Scenario: ブラウザ操作の依頼
- **WHEN** ユーザが「ブラウザで確認してほしい」等の操作依頼を送る
- **THEN** `agent-browser` が選択される

### Requirement: 組み込みスキルの配置
システムは組み込みスキルをアプリ専用ディレクトリに配置しなければならない（SHALL）。

#### Scenario: 配置場所の検証
- **WHEN** 組み込みスキルが配布される
- **THEN** `<app data>/skills/agent-browser/SKILL.md` に配置される

