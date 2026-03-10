## Why

Windows 上で Bash/Write などのツールをそのまま実行すると、ホスト環境への影響範囲が広くなりやすく、安全性の担保が難しい。VM ベースの Windows Sandbox に依存するのではなく、`codex-rs/windows-sandbox-rs` の Restricted Token / ACL / ネットワーク遮断に寄せた「Windows 分離実行」を選べるようにし、必要時のみ隔離寄りの実行経路を使えるようにする。

## What Changes

- Windows 向けに、ツール実行先として Windows 分離実行を選択できる設定を追加する。
- 設定が ON の場合のみ、分離実行用の最小環境を都度構築してからツールを実行する。
- 設定が OFF の場合は、既存のホスト実行フローを維持する。
- 実行フローは `codex-rs/windows-sandbox-rs` の責務分離を参考にしつつ、VM 起動ではなく executor 抽象と最小限の環境隔離に限定する。

## Capabilities

### New Capabilities
- `windows-sandbox-tool-execution`: Windows でのツール実行を設定で切り替え可能にし、ON 時のみ分離実行経路で実行する機能を定義する。

### Modified Capabilities
- なし

## Impact

- 設定 UI（Windows 分離実行 ON/OFF トグルの追加）
- 設定永続化と Main プロセスへの反映
- ツール実行オーケストレーション（ホスト実行と分離実行の分岐）
- Windows 向け executor モジュール追加（実行・結果回収・後片付け）
