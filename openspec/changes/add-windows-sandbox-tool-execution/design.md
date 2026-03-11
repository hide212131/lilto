## Context

現在のアプリは Pi SDK を Electron Main から組み込んでおり、通常は Pi の built-in tools をそのまま使っている。Windows 分離実行の初期実装では、Main 側で `tools` 配列を直接差し替えて `WindowsIsolatedExecutor` を噛ませていた。

ただし Pi 本体の README / Extensions ドキュメントでは、built-in tool の差し替えは Extensions による override が標準的な拡張点として定義されている。今回のリファクタでは、その標準構造に合わせて「Main が実行モードを決め、ON 時だけ inline extension を含む `resourceLoader` を Pi SDK に渡す」構成へ寄せる。

## Goals / Non-Goals

**Goals**

- Windows 分離実行 ON/OFF の UX と設定キー互換を維持する
- ON 時にのみ `bash` / `edit` / `write` が Windows 分離実行へ差し替わる
- 差し替えの実装ポイントを Pi Extensions に寄せる
- `WindowsIsolatedExecutor` は最小アダプタとして独立維持する
- 失敗時は暗黙フォールバックせず、明示エラーを返す

**Non-Goals**

- Linux/macOS 向けの分離実行
- `windows-sandbox-rs` 完全互換の native helper 導入
- `read` / `grep` / `find` / `ls` など他ツールへの拡張
- UI/設定項目の大幅な再設計

## Decisions

1. 設定モデルは `useWindowsIsolatedToolExecution` を canonical とし、旧 `useWindowsSandboxForTools` は読み込み互換のみ残す

- 理由: UI/仕様から VM 前提の命名を外し、分離の本質を設定名へ反映するため

2. Main 側には `ToolExecutionModeResolver` を残し、`host` / `windows-isolated` をセッション生成直前に判定する

- 理由: 実行モードの判断はアプリ側設定に依存するが、実際のツール差し替えは Pi 側の拡張ポイントへ寄せたいから

3. `windows-isolated` の場合は、Pi SDK の `DefaultResourceLoader` に inline extension を注入して `bash` / `edit` / `write` を override する

- 理由: Pi README の Extensions 方針に沿って built-in tool override を使うことで、責務分離と将来の差し替えを自然にできる

4. override に使う実体は `WindowsIsolatedExecutor` が提供する operations とする

- 理由: 分離実行の準備・実行・結果回収・後片付けを 1 箇所へ集約しつつ、Pi の tool factory に接続しやすい

5. custom `resourceLoader` は `createAgentSession()` へ渡す前に `reload()` 済みとする

- 理由: SDK 側は外部から渡された `resourceLoader` を自動 reload しないため、extension が未ロードのままになる事故を防ぐ

## Architecture

### Host mode

1. 設定 OFF または非 Windows
2. `resolveToolExecutionMode()` が `host` を返す
3. Pi SDK には通常の `resourceLoader` / built-in tools を使わせる

### Windows-isolated mode

1. 設定 ON かつ Windows
2. Main が `WindowsIsolatedExecutor.ensureAvailable()` を呼ぶ
3. Main が `DefaultResourceLoader({ extensionFactories: [...] })` を作る
4. inline extension が `createBashTool` / `createEditTool` / `createWriteTool` で built-in tool を override する
5. Pi SDK セッションは override 後の tool registry を使って実行する

## Risks / Trade-offs

- custom resourceLoader の初期化漏れで extension が効かないリスクがある
- tool override を使うため、テストは `tools` 配列ではなく `resourceLoader` 注入を前提に変わる
- 分離アダプタ自体は依然として PowerShell ベースの最小実装であり、より強い token / ACL / firewall 分離は今後の課題

## Migration Plan

1. 設定キーと UI はそのまま維持する
2. Main の `tools` 直差し経路を `resourceLoader + inline extension` へ置き換える
3. テスト期待値を `windows-isolated` 時の `resourceLoader` 注入へ更新する
4. verification と E2E で ON/OFF の実行経路を再確認する

## Open Questions

- 将来 native helper を導入する場合、`WindowsIsolatedExecutor` の内側をどこまで `windows-sandbox-rs` に寄せるか
- network 制限をより強くする場合、Pi Extension 層ではなく native helper 側へどこまで責務を寄せるか
