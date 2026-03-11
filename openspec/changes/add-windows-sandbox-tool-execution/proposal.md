## Why

Windows 上で Bash / Write などのツールをそのままホスト実行すると、ローカル環境への副作用が大きくなりやすい。既存の変更では Windows 分離実行を導入したが、実装責務が Electron Main に寄りすぎており、Pi の built-in tool override / Extensions という拡張ポイントを十分に活用できていなかった。

今回の変更では、`codex-rs/windows-sandbox-rs` の責務分離を参考にしつつ、Windows 分離実行の適用点を Pi Extensions ベースへ寄せる。これにより、ツール差し替えの責務を Pi SDK 側の標準的な仕組みに合わせ、今後の拡張や差し替えをしやすくする。

## What Changes

- Windows 向け設定 `useWindowsIsolatedToolExecution` で ON/OFF できることは維持する
- OFF 時は従来どおりホスト実行を使う
- ON 時は `WindowsIsolatedExecutor` を使った `bash` / `edit` / `write` の override を Pi Extension として注入する
- Electron Main は「モード判定」と「適切な resourceLoader を Pi SDK に渡す」責務に絞る
- 分離実行アダプタ自体は `windows-sandbox-rs` を参考にした最小構成のまま維持する

## Capabilities

### New Capabilities

- `windows-sandbox-tool-execution`: Windows で Bash / Edit / Write 系ツールを設定に応じてホスト実行または分離実行へ切り替える

### Modified Capabilities

- なし

## Impact

- 設定 UI と設定モデル
- Main の Pi SDK セッション生成経路
- Windows 分離実行アダプタ
- Windows 向け回帰テスト / E2E / manual verification
