# Lilt-AI
軽量なAIアシスタント。

# 特長
- macos と windows 両方で動く
- デスクトップに常駐する。
- "Hey Siri"や"OK Google" "Alexsa" などのwake word で発動する。
- ユーザの音声やテキストの要求を受け取り、ブラウザ操作やファイル作成などのPC操作を行う
- 一定時間ごとのハートビートにより事前に登録された処理もおこなう。

## 実装
- UI: Tauri
- AIエージェント: まずは1.を活用。ただ2.も視野に入れたいので、差し替え可能な実装が良い
    1. pi-coding-agent: https://github.com/badlogic/pi-mono
    2. Claude Agent SDK 
- [Agent Skills](https://agentskills.io/) に従った複数の Skill の保有と実行する
