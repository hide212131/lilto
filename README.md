# Lilt-AI
PCの作業を人間の代わりに行うAIアシスタント。

## 機能
軽量なAIエージェントとして実装
- macos と windows 両方で動く
- デスクトップに常駐する。
- ユーザのテキストの要求を受け取り、ブラウザ操作やファイル作成などのPC操作を行う
- 一定時間ごとのハートビートにより事前に登録された処理もおこなう。
- 音声操作ができることが望ましい。
  - "Hey Siri"や"OK Google" "Alexsa" などのwake word で発動する。
  - 入力をテキストの代わりに音声で可能

## 実装
- AIエージェントの機能は、[Pi](https://github.com/badlogic/pi-mono)を使う
- アプリ基盤はElectronを使う。
- ElectronのMainプロセスで動くAIエージェントは[pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)を活用する。

- ElectronのRendererプロセスで動くUIは、
イメージとしては、[pi-web-ui](https://github.com/badlogic/pi-mono/tree/main/packages/web-ui)やそれをベースとしたUI実装[pi-web-ui-example](https://github.com/badlogic/pi-mono/blob/main/packages/web-ui/example)に近づけることがのぞましい。ただしこれらは[pi-agent-core](https://github.com/badlogic/pi-mono/tree/main/packages/agent)などファイル入出力を伴うライブラリに依存しているため、そのままではElectronのRendererには使えない。Electronのmainで動くようにポーティングする必要がある。

