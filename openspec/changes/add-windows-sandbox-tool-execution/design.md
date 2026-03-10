## Context

現在のツール実行はホスト OS 上で直接行われるため、Windows ではコマンドの副作用がローカル環境へ及ぶ。今回の変更では、設定画面で Windows 分離実行を選択できるようにし、ON 時のみ分離 executor 経路でツールを実行する。参考実装として `codex-rs/windows-sandbox-rs` の責務分離を採用するが、実装は最小限の executor 置換と結果回収に限定する。

制約:
- Windows 以外の OS の挙動は変更しない。
- 既存のホスト実行フローとの互換性を維持する。
- 初期版では VM や OS feature 有効化を前提にしない。

## Goals / Non-Goals

**Goals:**
- 設定画面で Windows 分離実行の ON/OFF を切り替え可能にする。
- ON 時にのみ分離実行経路へ分岐し、最小限の実行環境を自動構築する。
- OFF 時は既存のホスト実行を維持し、既存利用者の挙動を壊さない。
- 実行失敗時に、設定値と分岐経路が追跡可能なログを残す。

**Non-Goals:**
- Linux/macOS 向けの隔離実行の追加。
- 完全な Windows API helper 再実装。
- 高度なリソース制御（CPU/メモリ制限の詳細チューニング）。
- 既存ツールの仕様変更（Bash/Write の API 自体は維持）。

## Decisions

1. 設定モデルに `useWindowsIsolatedToolExecution`（boolean）を追加し、旧 `useWindowsSandboxForTools` は読み込み時のみ後方互換で受ける
- 理由: UI と実装の命名を VM 固有から切り離しつつ、既存設定ファイルは壊さないため。

2. Main 側に `ToolExecutionModeResolver` を置き、`host` / `windows-isolated` を実行直前に判定する
- 理由: 実行分岐を 1 箇所に閉じ、各ツール実装への影響を最小化する。

3. 実行は専用アダプタ（`WindowsIsolatedExecutor`）に集約する
- 理由: `windows-sandbox-rs` の責務分離を踏襲しつつ、アプリ本体は抽象インターフェースで扱える。

4. Windows Sandbox feature 有効化や VM 起動前提のフローは削除する
- 理由: 今回求められているのは VM 分離ではなく、Restricted Token / ACL / 専用実行経路寄りの設計へ寄せることだから。

## Risks / Trade-offs

- [初期版の分離が `windows-sandbox-rs` 完全互換ではない] → executor 抽象と設定名を先に揃え、native helper 導入余地を残す。
- [既存設定キーの変更で互換性が壊れる] → 読み込み時に legacy キーを受けて新キーへ正規化する。
- [運用中のデバッグ難度上昇] → 実行モードと失敗ステージを構造化ログに残す。

## Migration Plan

1. 設定スキーマに新フラグを追加し、既存ユーザーはデフォルト OFF とする。
2. 設定画面のトグル文言を Windows 分離実行へ変更する。
3. Main のツール実行入口に `windows-isolated` 分岐と executor を接続する。
4. Windows で ON/OFF の手動確認と既存回帰確認を行う。

## Open Questions

- native helper を追加する際、`windows-sandbox-rs` の token / acl / firewall のどこまでを取り込むか。
- 分離実行でネットワーク遮断をどこまで強制するか。
