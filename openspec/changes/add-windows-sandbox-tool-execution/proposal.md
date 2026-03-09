## Why

Windows 上で Bash/Write などのツールをそのまま実行すると、ホスト環境への影響範囲が広くなりやすく、安全性の担保が難しい。設定画面から明示的に Windows Sandbox 実行を選べるようにし、必要時のみ隔離環境を構築して実行できるようにする。

## What Changes

- Windows 向けに、ツール実行先として Windows Sandbox を選択できる設定を追加する。
- 設定が ON の場合のみ、Sandbox 起動と最小限の実行環境セットアップを行ってからツールを実行する。
- 設定が OFF の場合は、既存のホスト実行フローを維持する。
- Sandbox 実行フローは `codex-rs/windows-sandbox-rs` の構成を参考にしつつ、最小限の機能（起動・投入・実行・結果取得）に限定する。

## Capabilities

### New Capabilities
- `windows-sandbox-tool-execution`: Windows でのツール実行を設定で切り替え可能にし、ON 時のみ隔離環境で実行する機能を定義する。

### Modified Capabilities
- なし

## Impact

- 設定 UI（Sandbox 実行 ON/OFF トグルの追加）
- 設定永続化と Main プロセスへの反映
- ツール実行オーケストレーション（ホスト実行と Sandbox 実行の分岐）
- Windows Sandbox 利用のための補助モジュール追加（起動・実行・後片付け）
