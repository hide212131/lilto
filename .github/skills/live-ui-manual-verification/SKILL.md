---
name: live-ui-manual-verification
description: ElectronアプリのライブUI検証を、Playwright 主体で素早く進め、Electron 固有の難所だけ別手段へ切り替えるための標準手順。
license: MIT
compatibility: Requires npm start and the local Playwright helper script. On Windows, prefer npm.cmd.
metadata:
  author: lilto
  version: "1.4"
---

この Skill は、障害解析、仕様確認、回帰切り分けで **最初に選ぶ** 手段である。
対象アプリで「要求→回答→任意 UI 操作→検証」を、その場で観測しながら進める。

この Skill は **専用 E2E プログラムを新規作成しない**。既存のローカル補助 CLI を使い、Playwright 主体でライブ検証する。

---

## 目的

次をライブ環境で確実に完了する:

1. アプリ起動
2. Playwright 接続
3. 任意要求の入力
4. AI回答の確認
5. 任意 UI 操作（例: リンククリック / 設定画面の開閉 / 入力保存）
6. 期待結果の検証

---

## 第一選択の理由

- GUI の障害解析では、まずライブ画面を観測しながら原因を狭める
- 主要なユーザー操作は Playwright で十分に扱える
- Electron 固有の難所だけを後段へ追い出すと、通常ケースの手順がぶれない
- よって、この Skill を Electron UI 問題の標準入口にする

---

## 基本方針

1. 主要なユーザー操作は Playwright で行う
2. Playwright で扱いにくい Electron 固有 UI だけ WebdriverIO Electron Service で補う
3. それでも不要なら素直に使わない。Electron Service を標準経路にしない
4. 変更完了後の最終リグレッション確認は `npm run e2e:electron` で行う

---

## 実行手順

1. 既にアプリが起動中なら終了する
2. CDP 付きで起動する
3. ローカル Playwright helper で `wait-app` を通す
4. `status-text` / `open-settings` / `send-prompt` / `messages` / `screenshot` を必要な順で実行する
5. Playwright で到達不能な Electron 固有 UI に当たった場合だけ、WebdriverIO Electron Service の利用を検討する

### macOS / Linux

```bash
npm start -- --remote-debugging-port=9222
npm run live-ui:manual -- 9222 wait-app
npm run live-ui:manual -- 9222 status-text
npm run live-ui:manual -- 9222 open-settings
npm run live-ui:manual -- 9222 screenshot test/artifacts/live-ui-manual.png
```

### Windows

```powershell
npm.cmd start -- --remote-debugging-port=9222
npm.cmd run live-ui:manual -- 9222 wait-app
npm.cmd run live-ui:manual -- 9222 status-text
npm.cmd run live-ui:manual -- 9222 open-settings
npm.cmd run live-ui:manual -- 9222 screenshot test/artifacts/live-ui-manual.png
```

---

## 代表コマンド

```bash
npm run live-ui:manual -- 9222 title
npm run live-ui:manual -- 9222 status-text
npm run live-ui:manual -- 9222 open-settings
npm run live-ui:manual -- 9222 close-settings
npm run live-ui:manual -- 9222 send-prompt "Example Domain のタイトルを教えて"
npm run live-ui:manual -- 9222 messages
npm run live-ui:manual -- 9222 text status
npm run live-ui:manual -- 9222 click "input[value='custom-openai-completions']"
npm run live-ui:manual -- 9222 fill "#custom-base-url" "https://api.openai.com/v1"
npm run live-ui:manual -- 9222 wait-for-text status "待機中" 15000
npm run live-ui:manual -- 9222 screenshot test/artifacts/live-ui-manual.png
```

---

## 完了条件

- CDP 付きで起動した対象 Electron アプリへ Playwright helper で接続済み。
- 要求送信または対象 UI 操作を実行済み。
- 観測点で成功条件を確認済み。
- Electron 固有 UI が原因なら、それを Playwright ではなく Electron Service 側の課題として切り分け済み。

---

## 報告フォーマット

- 実行コマンド（主要のみ）
- 観測結果（成功/失敗、返り値）
- 最終判定（目的を満たしたか）
- 失敗時は次の一手

## 切り替え基準

- 画面内の通常ボタン、入力、メッセージ確認、設定保存は Playwright のまま進める
- `BrowserWindow` をまたぐ制御、ネイティブダイアログ、アプリメニュー、`webview` の特殊切り替えなどに当たったら WebdriverIO Electron Service を検討する
- 原因分析の初手としてはいきなり Electron Service に飛ばない
