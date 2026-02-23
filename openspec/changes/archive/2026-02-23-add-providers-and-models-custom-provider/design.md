## Context

現行 Renderer 設定モーダルは `Claude Auth` 単一メニューで、Claude OAuth の開始とコード投入のみを扱う。今回の要件は `pi-web-ui` / `web-ui/example` に揃えて `Providers & Models` へ拡張し、Claude と Custom Provider（OpenAI Completions Compatible）を同じ設定面で扱うこと。既存 Main 側は Claude 前提の実行可否判定を持つため、送信時の provider 解決とエラーハンドリングも再設計が必要になる。

## Goals / Non-Goals

**Goals:**
- Settings モーダルに `Providers & Models` を導入し、Claude と Custom Provider の 2 系統を並列に設定できるようにする。
- Custom Provider で `name` / `baseUrl` / `apiKey`（任意）を保存し、OpenAI Completions Compatible 接続先として利用できるようにする。
- 送信時に現在選択された provider 設定を Main が解釈し、設定不足時は理由つきで拒否する。
- 既存 Claude OAuth フロー（開始、コード投入、状態更新）を Providers & Models 配下へ移設して維持する。

**Non-Goals:**
- OpenAI Responses Compatible や Anthropic Messages Compatible など、今回要件外 provider 種別の追加。
- `pi-web-ui` の全 UI コンポーネント群をそのまま導入する大規模置換。
- 永続化ストア基盤の全面刷新（今回は現行保存方式へ最小拡張する）。

## Decisions

1. 設定 UI を「単一 Claude 画面」から「Providers & Models（Claude + Custom）」へ再編する。  
理由: 要件の中心が複数 provider 管理であり、`pi-web-ui/example` のタブ名称・責務に合わせると今後 provider 追加時の拡張コストが低い。  
代替案: Claude Auth を残したまま別メニュー追加。  
不採用理由: 設定導線が分散し、どこで実行 provider が決まるか不明瞭になる。

2. Custom Provider の初期スコープを `openai-completions` のみに限定し、必須入力は `name` と `baseUrl` とする。  
理由: ユーザー要求に一致し、最小実装で接続先差し替えを可能にできる。`apiKey` はエンドポイント要件差があるため任意。  
代替案: 複数 custom type を同時実装。  
不採用理由: UI/検証の分岐が増え、今回 change の完了条件を不必要に拡大する。

3. Main の実行前バリデーションを「Claude 認証済み必須」から「選択 provider ごとの準備完了必須」へ変更する。  
理由: Claude は OAuth 状態、Custom Provider は baseUrl/apiKey 等で成立条件が異なるため、共通の `AUTH_REQUIRED` だけでは不十分。  
代替案: Renderer だけで判定して Main では従来どおり。  
不採用理由: IPC 呼び出し経路の一貫性が崩れ、将来の UI 追加時にガード漏れが発生しやすい。

4. `pi-web-ui` からは責務を移植し、コンポーネント実装は既存 renderer 構造へ合わせて手書き移植する。  
理由: Desktop 側は純 HTML/CSS + renderer.ts で構成され、Lit ベースのコンポーネントを直接導入すると影響範囲が大きい。  
代替案: `pi-web-ui` コンポーネントを直接組み込み。  
不採用理由: ビルド/依存の増加と既存 E2E セレクタ崩壊リスクが高い。

## Risks / Trade-offs

- [Risk] Provider 状態（Claude OAuth と Custom 設定値）の同期漏れで送信ボタン制御が誤る → Mitigation: Renderer 表示状態と Main バリデーション結果を二重で検証し、`status` 表示を provider 別エラー文言に更新する。
- [Risk] 設定項目追加で既存 E2E セレクタが破損する → Mitigation: 既存 `id` を極力維持しつつ、新規要素は専用 `id` を付与して `npm run e2e:electron` を更新する。
- [Trade-off] 最小移植のため `pi-web-ui` の高度機能（自動モデル発見、複数 custom type 管理）は今回見送る → Mitigation: 次 change で type 拡張可能なデータ構造を先に決める。

## Migration Plan

1. Renderer 設定 UI を `Providers & Models` レイアウトへ差し替え、Claude セクション + Custom Provider セクションを追加する。
2. preload/main IPC に provider 設定取得・保存 API を追加し、起動時 hydrate を実装する。
3. Main 実行分岐を provider ベースへ変更し、Claude と custom-openai-completions の両経路を実装する。
4. 既存 E2E を更新し、GUI 変更の完了条件として `npm run e2e:electron` 成功とスクリーンショット生成を確認する。
5. ロールバック時は UI メニューと Main 判定を Claude 専用実装へ戻し、追加設定データを無視して従来動作に復帰する。

## Open Questions

- Custom Provider のモデル選択 UX（固定モデル、手入力、または候補一覧）は今回どこまで含めるか。
- Custom Provider 利用時の認証エラーコード体系を Claude と共通化するか、provider 別に分けるか。
