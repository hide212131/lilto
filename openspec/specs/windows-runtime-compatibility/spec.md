# windows-runtime-compatibility Specification

## Purpose
Windows 環境での CLI 実行・パス解決・プロセス起動の差異を吸収し、OpenSpec とアプリ実行の主要フローを安定化する。

## Requirements
### Requirement: Windows コマンド実行互換
システムは、Windows 環境で CLI 実行が必要な場合に `*.cmd` シム（例: `npm.cmd`、`npx.cmd`、`openspec.cmd`）を優先して呼び出さなければならない（MUST）。

#### Scenario: PowerShell 実行ポリシー環境でも OpenSpec が実行できる
- **WHEN** Windows PowerShell で `openspec` の `.ps1` 実行が制限されている
- **THEN** システムは `openspec.cmd` を利用して同等の CLI 操作を成功させる

### Requirement: OS 差異を吸収したプロセス起動
システムは、コマンド実行前に OS 差異（実行ファイル名、パス区切り、引数解釈）を正規化し、主要フローが OS 間で同等に動作するようにしなければならない（MUST）。

#### Scenario: Windows でパス解決差異による失敗を回避できる
- **WHEN** Main プロセスがローカルコマンドを実行する
- **THEN** システムは Windows 互換のパス・実行形式に変換して実行し、解決不能エラーを防ぐ

### Requirement: 互換性検証の完了条件
システムは、Windows 環境で `new change`、`status`、`instructions` の最小 OpenSpec フローを成功させることを互換性の完了条件として扱わなければならない（MUST）。

#### Scenario: apply 前フローが Windows で完了する
- **WHEN** ユーザーが Windows で change 作成から最初の artifact 指示取得までを実行する
- **THEN** すべてのコマンドが成功し、ready artifact を取得できる
