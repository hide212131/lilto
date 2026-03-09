---
name: live-ui-manual-verification
description: ElectronアプリのライブUI検証を、まずelectronスキルの接続フローで起動・接続してから実施する手順。
license: MIT
compatibility: Requires npm.cmd start and npx.cmd agent-browser on Windows.
metadata:
  author: lilto
  version: "1.3"
---

この Skill は、`electron` Skill（`.github/skills/electron/SKILL.md`）の手順を前提として、
対象アプリで「要求→回答→任意UI操作→検証」をライブ実行する。

この Skill は **専用 E2E プログラムを新規作成しない**。その場で状態を見ながら操作と検証を進める。

---

## 目的

次をライブ環境で確実に完了する:

1. アプリ起動
2. `agent-browser` 接続
3. 任意要求の入力
4. AI回答の確認
5. 任意 UI 操作（例: リンククリック / 設定画面の開閉 / 入力保存）
6. 期待結果の検証

---

## 必須方針（electron Skill を使う）

この Skill を呼ばれたら、最初に `electron` Skill の「Core Workflow」を実行する。

1. CDP 付き起動（`--remote-debugging-port`）
2. `agent-browser connect`
3. `tab list` と `tab <index>` で対象タブ選択
4. `snapshot` または `eval` で状態観測

`electron` Skill で接続が安定するまで、UI 検証手順に進まない。

---

## Windows 実行ルール

- PowerShell 実行ポリシー回避のため、`npm.cmd` / `npx.cmd` を使う。
- 例:

```powershell
npm.cmd start -- --remote-debugging-port=9222
npx.cmd agent-browser connect 9222
npx.cmd agent-browser tab list
npx.cmd agent-browser tab 0
```

- 既にアプリが起動中なら一度終了してから、CDP フラグ付きで再起動する。

---

## ライブUI検証フロー（接続後）

1. 検証対象を固定する（対象操作 / 観測点 / 成功条件）。
2. `agent-browser eval` で初期状態を取得する。
3. 要求送信または UI 操作を 1 手ずつ実行する。
4. 各手の直後に観測結果を返し、次手に進む。
5. 最終的に成功条件を満たしたことを確認する。

---

## 代表コマンド（Windows）

```powershell
npx.cmd agent-browser get title
npx.cmd agent-browser eval "(() => !!document.querySelector('lilt-app'))()"
npx.cmd agent-browser screenshot test/artifacts/live-ui-manual.png
```

---

## 完了条件

- `electron` Skill の接続手順で対象 Electron アプリへ接続済み。
- 要求送信または対象 UI 操作を実行済み。
- 観測点で成功条件を確認済み。

---

## 報告フォーマット

- 実行コマンド（主要のみ）
- 観測結果（成功/失敗、返り値）
- 最終判定（目的を満たしたか）
- 失敗時は次の一手
