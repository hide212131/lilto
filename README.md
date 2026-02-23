# Lilt-o
PC作業を人間の代わりに実行する、軽量なAIアシスタント。

## 機能
- 軽量なAIエージェントとして動作する
- macOSとWindowsの両方で動作する
- デスクトップに常駐する
- ユーザーのテキスト要求を受け取り、ブラウザ操作やファイル作成などのPC操作を実行する
- 一定間隔のハートビートで、事前登録した処理を実行する
- 音声操作への対応を目指す
  - "Hey Siri"、"OK Google"、"Alexa" などのウェイクワードで起動する
  - テキスト入力の代わりに音声入力を受け付ける

## 実装方針
- AIエージェント機能は [Pi](https://github.com/badlogic/pi-mono) を利用する
- アプリ基盤は Electron を利用する
- Electron の Main プロセスで動くAIエージェントは [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) の SDK を活用する
- Electron の Renderer プロセスで動くUIは、[pi-web-ui](https://github.com/badlogic/pi-mono/tree/main/packages/web-ui) およびそれをベースにした [pi-web-ui-example](https://github.com/badlogic/pi-mono/blob/main/packages/web-ui/example) に近い構成を目指す
- ただし上記UIは [pi-agent-core](https://github.com/badlogic/pi-mono/tree/main/packages/agent) などファイル入出力を伴うライブラリに依存するため、そのままでは Electron の Renderer では利用できない。必要に応じて Main 側で動作するようにポーティングする

## UIポーティング方針
- 詳細は `docs/ui-porting-guidelines.md` を参照

## 現在の実装スコープ（初期）
- Electron の Main/Renderer 最小構成
- Renderer から Main への IPC 経由で Pi SDK を呼び出す Agent Bridge
- Pi `ai` パッケージによる Claude OAuth 認証導線（外部ブラウザ起動 + コード入力 + 状態表示）
- 固定間隔ハートビートと登録ジョブ実行
- エラーの標準化レスポンスとログ出力

## 現在の非対象
- 音声入力
- ウェイクワード検出
