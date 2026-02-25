## Why

現状のアプリは WSL2 上での動作確認を前提としており、Windows ネイティブ環境ではコマンド実行・パス解決・起動フローの差異により機能が不安定になる。日常利用環境である Windows で再現可能かつ安定して動作する状態を先に担保しないと、以降の機能開発と検証の信頼性が落ちる。

## What Changes

- Windows 環境での起動・実行に関わる前提（CLI 呼び出し、シェル実行、パス解決）を仕様として明文化する。
- OS 差異を吸収する実行ルール（Windows での `.cmd` 優先、パス/プロセス実行の正規化）を Main 側ランタイムの要件として追加する。
- OpenSpec ワークフロー実行時に Windows で詰まりやすい導入・運用条件を再現可能な形で定義する。
- 既存の Linux/WSL2 動作を維持しつつ、Windows で同等の結果になることを完了条件に含める。

## Capabilities

### New Capabilities
- `windows-runtime-compatibility`: Windows 環境での CLI 実行、パス解決、プロセス起動の互換要件と検証条件を定義する。

### Modified Capabilities
- `desktop-shell`: デスクトップアプリの OS 別起動・実行ルールに Windows 固有の実行制約と回避手順を追加する。
- `pi-main-agent-runtime`: メインプロセスのコマンド実行・エージェント起動処理に Windows 互換の実行要件を追加する。

## Impact

- 影響範囲: `src/main/*`（プロセス実行・設定読込・ランタイム初期化）、OpenSpec 運用手順、関連ドキュメント。
- 外部依存: Node/npm 実行シム（`*.cmd`）の扱い、PowerShell 実行ポリシー前提の吸収。
- API/契約: IPC 契約の拡張は原則不要だが、エラー分類とログ文言は Windows 向けに明確化される可能性がある。
- テスト/検証: Windows での起動確認・主要操作の回帰確認を実施し、既存 WSL2 フローとの互換を維持する。