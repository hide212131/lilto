## Context

lilto は Electron Main から `@openai/codex-sdk` を使って Codex thread を開始しているが、現状は `sandboxMode: "danger-full-access"` を固定しているため、Windows でも Codex の sandbox backend が選択されない。設定画面にも Windows sandbox の保存項目がなく、Codex app-server が持つ `windowsSandbox/setupStart` を呼ぶ導線も未実装である。

一方で lilto はすでに `CODEX_HOME` をアプリ側で管理しており、`codex app-server --listen stdio://` を起動してモデル一覧取得を行う経路も持っている。この既存経路を再利用し、設定保存・setup 実行・thread 起動設定を一貫させることで、TypeScript 側から直接 Rust crate を呼ばずに `windows-sandbox-rs` の利用条件を満たせる。

## Goals / Non-Goals

**Goals:**
- Windows 専用の Codex sandbox モード設定を lilto の設定画面から保存できるようにする。
- Windows sandbox が有効な場合、Codex thread 起動時に `workspace-write` と `windows.sandbox` config を渡して Codex 側 backend を利用可能にする。
- `elevated` / `unelevated` 選択時に Codex app-server の setup API を呼び、成功・失敗・キャンセルを UI へ返す。
- 未対応モードや setup 未完了時の失敗を、利用者が再試行可能な形で標準化して表面化する。

**Non-Goals:**
- `windows-sandbox-rs` を Node/Electron へ直接 FFI 連携すること。
- Windows sandbox backend が未対応の read-only 実行を lilto 側で独自実装して補うこと。
- macOS/Linux の sandbox モデルや approval policy を今回の change で再設計すること。

## Decisions

### 1. ユーザー設定は `ProviderSettings` に `windowsSandbox` を追加して保持する

`ProviderSettings` に `windowsSandbox` オブジェクトを追加し、少なくとも `mode: "off" | "unelevated" | "elevated"` と `privateDesktop: boolean` を保持する。保存対象を provider settings に寄せることで、既存の Settings モーダル保存経路と IPC 契約を再利用できる。

`setup completed` のような一時状態は永続化しない。setup 完了可否は app-server 経由の setup 実行結果で扱い、必要に応じて再実行可能とする。

代替案:
- 別ファイルに Windows sandbox 専用設定を保存する案は、設定画面保存 API と runtime 読み取り経路が分岐して複雑になるため採用しない。
- `useWindowsSandboxForTools` の boolean を復活させる案は、`unelevated` と `elevated` を区別できず Codex 側設定モデルと整合しないため採用しない。

### 2. Codex app-server 呼び出しは再利用可能な Main ユーティリティへ集約する

モデル一覧取得だけでなく Windows sandbox setup でも `codex app-server --listen stdio://` を使うため、stdio ベースの JSON-RPC クライアントを Main 側ユーティリティへ切り出して再利用する。`ModelCatalogService` の ad-hoc 実装をそのまま増やさず、initialize、request、notification 待機、終了処理を共通化する。

これにより setup 開始 (`windowsSandbox/setupStart`) と完了通知 (`windowsSandbox/setupCompleted`) を同じ実装で扱える。

代替案:
- 設定保存時だけ `codex` CLI を直接別プロセスで叩く案は、app-server 既存 API を再実装する形になり保守性が低い。
- 常駐 app-server を Main 起動時から持つ案は、今回必要な範囲に対して寿命管理が重く、まずは on-demand 起動で十分である。

### 3. Windows sandbox 利用時の thread 起動は `workspace-write` に固定する

Windows sandbox backend は `danger-full-access` と external sandbox を受け付けず、制限付き read-only も未対応である。そのため lilto では Windows sandbox モード有効時の Codex thread 起動を `workspace-write` に固定し、Codex config に `windows.sandbox` と必要なら `windows.sandbox_private_desktop` を渡す。

`off` の場合のみ従来どおり `danger-full-access` を維持する。これにより Windows sandbox backend の利用条件を lilto 側で明示的に満たす。

代替案:
- Windows sandbox 有効時も `danger-full-access` のまま起動し、Codex 側に委ねる案は backend が選ばれず目的を満たさないため採用しない。
- read-only と workspace-write を画面から選ばせる案は、backend 未対応のモードを UI に露出することになるため採用しない。

### 4. setup は「設定保存時に前倒し実行」し、失敗時は保存状態を安全側へ戻す

利用者が Windows sandbox を `unelevated` または `elevated` へ変更して保存した時点で setup API を開始する。これにより、最初の会話送信までエラーを遅延させず、UAC 同意や失敗理由を設定画面内で完結して扱える。

setup が失敗またはキャンセルされた場合は、設定を `off` に戻すか、少なくとも保存済み state を「未有効化のまま残さない」安全側へ倒す。再試行は設定画面から明示操作で行う。

代替案:
- 初回送信時にのみ setup する案は、実行失敗とセットアップ不足が混ざり UX が悪い。
- 失敗後も設定を保持する案は、毎回送信失敗を誘発しやすく既存 lessons と矛盾するため採用しない。

### 5. 実行失敗は lilto 独自の標準化エラーへ変換する

Codex 実行時に Windows sandbox 由来のエラーが返った場合、Renderer が設定画面を開き直せるように `WINDOWS_SANDBOX_SETUP_REQUIRED`、`WINDOWS_SANDBOX_SETUP_FAILED`、`WINDOWS_SANDBOX_UNSUPPORTED_MODE` などのエラーコードへ標準化する。既存の `AUTH_REQUIRED` や Proxy 失敗と同じ UI ハンドリングに乗せる。

## Risks / Trade-offs

- [Windows app-server setup API の通知待機が不安定] → setup 専用のタイムアウトと明示的な中断メッセージを持ち、失敗時は `off` へ戻す。
- [モデル一覧取得と setup 実行で app-server 呼び出し実装が二重化する] → 先に共通クライアントを導入し、`model/list` と `windowsSandbox/setupStart` の両方で使う。
- [設定変更直後に sandbox モードと既存 session cache がずれる] → provider settings 保存成功時に AgentRuntime の session cache を破棄し、新設定で再開させる。
- [Windows sandbox backend の制約を UI が隠しきれない] → 設定画面に `workspace-write` 前提であることと read-only 非対応を明示する。
- [Codex upstream が保証していない拒否ケースまで lilto の回帰条件に含めると、lilto 側が upstream の実装詳細を勝手に固定してしまう] → live test は Codex smoke tests と整合する拒否ケースに限定し、PowerShell absolute path 書き込みや ADS は security policy 文書で「未保証」と明示する。

## Migration Plan

1. `ProviderSettings` の JSON に `windowsSandbox` を追加し、既存ファイルは `mode: "off"` を既定値として後方互換で正規化する。
2. Main に app-server 共通クライアントと Windows sandbox setup 呼び出しを追加する。
3. Settings モーダルへ Windows sandbox セクションを追加し、保存時に setup を実行する。
4. AgentRuntime の thread 起動設定を Windows sandbox モードに応じて切り替える。
5. Windows テストを追加し、設定保存・setup 成功/失敗・prompt 実行経路を検証する。

ロールバック時は `windowsSandbox` 設定を無視して `off` 扱いに戻せば既存動作へ復帰できる。既存設定ファイルに追加されたフィールドは後方互換上問題にならない。

## Open Questions

- Settings 保存時の setup 失敗で、完全に `off` へ巻き戻すか、選択値は保持したまま「未セットアップ」表示に留めるかは最終 UX 判断が必要である。本 change では lessons を優先し、まずは `off` への巻き戻しを標準案とする。