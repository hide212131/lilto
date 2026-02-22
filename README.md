# Lilt-AI
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
- Electron の Main プロセスで動くAIエージェントは [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) を活用する
- Electron の Renderer プロセスで動くUIは、[pi-web-ui](https://github.com/badlogic/pi-mono/tree/main/packages/web-ui) およびそれをベースにした [pi-web-ui-example](https://github.com/badlogic/pi-mono/blob/main/packages/web-ui/example) に近い構成を目指す
- ただし上記UIは [pi-agent-core](https://github.com/badlogic/pi-mono/tree/main/packages/agent) などファイル入出力を伴うライブラリに依存するため、そのままでは Electron の Renderer では利用できない。必要に応じて Main 側で動作するようにポーティングする
