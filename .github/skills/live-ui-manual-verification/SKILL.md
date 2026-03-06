---
name: live-ui-manual-verification
description: アプリ起動→要求入力→AI回答確認に加え、設定画面など任意の画面操作を、E2Eスクリプトを作らずその場で試行錯誤しながら実行・検証するための手順。
license: MIT
compatibility: Requires npm start and npx agent-browser.
metadata:
  author: lilto
  version: "1.0"
---

Electron アプリを実際に起動し、`agent-browser` でライブ操作しながら「要求→回答→任意UI操作→検証」を完了させる。

この Skill は **専用 E2E プログラムを新規作成しない**。その場で状態を見ながら操作と検証を進める。

---

## 目的

次の流れを、ライブ環境で確実に完了する:

1. アプリ起動
2. 任意要求の入力
3. AI回答の確認
4. 任意 UI 操作（例: リンククリック / 設定画面の開閉 / 入力保存）
5. 期待結果の検証

---

## 実行ポリシー

- まず起動状態を確保し、CDP 接続可能にする。
- 1アクションごとに観測結果を返す（盲目的に連続実行しない）。
- 失敗時は原因を切り分けて、その場で次の最小手を試す。
- 既存のテストスクリプト編集は不要。ライブ操作で完結させる。

---

## 操作対象の決め方

実行前に、次の3点を固定する。

- 対象操作: 何を操作するか（例: 設定ボタンを押してモーダルを開く）
- 観測点: どこを見て成功判定するか（例: `.modal-backdrop.open`）
- 期待結果: 成功条件（例: `open=true`、保存後ステータス文言）

この3点が曖昧なまま実行しない。

---

## 標準フロー

### 1) アプリ起動（CDP有効）

```bash
npm start -- --remote-debugging-port=9222
```

- バックグラウンドで起動し、`DevTools listening on ws://127.0.0.1:9222/...` を確認する。

### 2) 接続確認

```bash
npx agent-browser connect 9222
npx agent-browser get title
```

- タイトルが `Lilt-o` なら接続OK。

### 3) 画面状態確認

```bash
npx agent-browser eval "(() => { const topBar = document.querySelector('lilt-app')?.shadowRoot?.querySelector('lilt-top-bar'); return topBar?.shadowRoot?.querySelector('.status')?.textContent?.trim() || topBar?.getAttribute('statustext') || ''; })()"
```

- `待機中` など送信可能状態を確認する。

### 4) 要求入力と送信

```bash
set +H
npx agent-browser eval '(() => {
  const app = document.querySelector("lilt-app");
  const composer = app?.shadowRoot?.querySelector("lilt-composer");
  const textarea = composer?.shadowRoot?.querySelector("textarea");
  const button = composer?.shadowRoot?.querySelector("button");
  if (!textarea || !button) return "composer-missing";
  textarea.value = "https://example.com を含む Markdownリンクを1つだけ返して";
  textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  button.click();
  return "sent";
})()'
```

- `zsh: event not found` 回避のため `set +H` を使う。

### 5) 回答観測（ポーリング）

```bash
set +H
for i in {1..40}; do
  out=$(npx agent-browser eval '(() => {
    const ml = document.querySelector("lilt-app")?.shadowRoot?.querySelector("lilt-message-list");
    const root = ml?.shadowRoot;
    const links = root ? Array.from(root.querySelectorAll(".markdown a")) : [];
    return JSON.stringify({ count: links.length, hrefs: links.map(a => a.getAttribute("href")) });
  })()')
  echo "$out"
  if [[ "$out" == *'"count":'* && "$out" != *'"count":0'* ]]; then
    break
  fi
  sleep 1
 done
```

- 回答内容に依存した検証の場合、ここで必要要素（リンク・特定文言など）を確認する。

### 6) 任意 UI 操作を実行して検証

ここは固定手順ではなく、対象操作に応じて差し替える。

#### 6-A. 例: リンククリックと画面遷移防止確認

```bash
set +H
npx agent-browser eval '(() => {
  const root = document.querySelector("lilt-app")?.shadowRoot?.querySelector("lilt-message-list")?.shadowRoot;
  const link = root?.querySelector(".markdown a[href]");
  if (!link) return "link-missing";
  link.click();
  return "clicked:" + link.getAttribute("href");
})()'

npx agent-browser get title
npx agent-browser eval '(() => !!document.querySelector("lilt-app"))()'
```

- タイトルが `Lilt-o` のまま、`lilt-app` が `true` なら「アプリ内遷移していない」と判断する。

#### 6-B. 例: 設定画面の開閉確認

```bash
set +H
npx agent-browser eval '(() => {
  const app = document.querySelector("lilt-app");
  const topBar = app?.shadowRoot?.querySelector("lilt-top-bar");
  const settingsButton = topBar?.shadowRoot?.querySelector("button[title=\"Settings\"]");
  settingsButton?.click();
  const modal = app?.shadowRoot?.querySelector("lilt-settings-modal");
  const open = modal?.shadowRoot?.querySelector(".modal-backdrop")?.classList?.contains("open") ?? false;
  return JSON.stringify({ opened: open });
})()'

npx agent-browser eval '(() => {
  const modal = document.querySelector("lilt-app")?.shadowRoot?.querySelector("lilt-settings-modal");
  const closeButton = modal?.shadowRoot?.querySelector("button[title=\"Close\"]");
  closeButton?.click();
  const open = modal?.shadowRoot?.querySelector(".modal-backdrop")?.classList?.contains("open") ?? false;
  return JSON.stringify({ openedAfterClose: open });
})()'
```

- `opened: true` かつ `openedAfterClose: false` を成功条件にする。

#### 6-C. 例: 設定入力→保存確認

```bash
set +H
npx agent-browser eval '(() => {
  const modal = document.querySelector("lilt-app")?.shadowRoot?.querySelector("lilt-settings-modal");
  const root = modal?.shadowRoot;
  const input = root?.querySelector("#custom-provider-name");
  const save = root?.querySelector(".provider-actions button");
  if (!input || !save) return "missing";
  input.value = "Manual Verification Provider";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  save.click();
  const status = root?.querySelector(".provider-actions .status")?.textContent?.trim() ?? "";
  return JSON.stringify({ status });
})()'
```

- 保存系は成功メッセージ文言や disable 状態変化で判定する。

---

## トラブルシュート

### CDP に接続できない

- 既存プロセスを確認し、必要なら再起動する。
- `--remote-debugging-port=9222` 付きで起動できているかログを確認。

### 送信できない / composer が見つからない

- 画面読み込み待ちを追加して再実行。
- `lilt-app` と `lilt-composer` の存在を先に `eval` で確認。

### 設定モーダル操作が効かない

- `lilt-settings-modal` の存在確認を先に行う。
- Shadow DOM の階層（`lilt-app` → `lilt-settings-modal` → `shadowRoot`）を都度確認する。
- ボタン押下後は 200-500ms の短い待機を挟み、開閉状態を再読する。

### 回答が遅い / リンクが出ない

- ポーリング回数または待機時間を増やす。
- プロンプトを「Markdownリンクを1つ返して」のように明示する。

### zsh の `event not found`

- コマンド先頭で `set +H` を入れる。
- `!` を含む JS をシングルクォートで囲む。

---

## 完了条件

- 要求送信が成功している。
- AI回答に期待要素（必要な場合）が含まれている。
- 対象 UI 操作（リンククリック / 設定画面操作 / 設定保存など）が実行済み。
- 対象操作に対応する観測点で期待結果を確認済み。

---

## 期待する報告フォーマット

- 実行コマンド（主要のみ）
- 観測結果（成功/失敗、返り値）
- 最終判定（目的を満たしたか）
- 失敗時は次の一手
