## Why

現状の Lilt-o は開発用起動と手動検証が中心で、macOS と Windows の配布用ビルドを継続的に作る導線や、GitHub / GitLab の両方へバイナリーを載せる手順が整っていない。特にこの環境は macOS であり、Windows 版は現地確認を前提に段階的に詰める必要があるため、まず「作れるところまで自動化し、未確認部分を明示して前進できる」変更として整理する必要がある。

## What Changes

- macOS 向け配布ビルドをローカルおよび CI で再現可能にし、成果物の出力先と release 用メタデータ生成手順を定義する。
- Windows 向け配布ビルドを macOS 上で可能な範囲まで整備し、Win 実機で追加確認すべき項目と段階的な完了条件を明文化する。
- GitHub Releases と GitLab Releases の双方に同じ配布成果物を載せるための publish フロー、必要な認証情報、失敗時の切り分け手順を定義する。
- ローカル開発者が release 候補を作成しやすいように、build / package / publish のスクリプトと運用手順を整理する。

## Capabilities

### New Capabilities
- `desktop-release-publishing`: Electron アプリの macOS / Windows 配布ビルド生成、成果物整理、GitHub / GitLab への release 公開手順を定義する。

### Modified Capabilities
- `desktop-shell`: 開発起動だけでなく、配布用パッケージングに必要な Main/Electron リソース同梱条件と成果物生成条件を追加する。
- `windows-runtime-compatibility`: Windows 実行互換に加え、Windows 向け配布物の生成・引き継ぎ・実機検証の段階的完了条件を追加する。

## Impact

- 影響範囲: `package.json` の build/publish scripts、Electron Builder 設定、配布物同梱用スクリプト、CI 設定、release 手順書。
- 外部依存: Electron 配布ビルドツール、GitHub / GitLab の release API または CLI、署名未対応時の暫定運用ルール。
- API/契約: ユーザー向け IPC 契約変更は原則不要だが、配布ビルドで必要な native binary / assets の同梱契約は明確化される。
- テスト/検証: macOS での release build 成功、GitHub / GitLab 向け dry-run 相当確認、Windows 実機での追加確認項目の記録が必要になる。
