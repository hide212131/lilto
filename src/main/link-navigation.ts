import { BrowserWindow, WebContentsView } from "electron";

const toolbarHeight = 52;
const toolbarHtml = `<!doctype html><html lang="ja"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
body{margin:0;padding:8px 12px;display:flex;gap:12px;align-items:center;font:14px system-ui;background:#f5f5f5;color:#222}
a{display:inline-block;padding:7px 14px;border:1px solid #aaa;border-radius:6px;background:white;color:#222;text-decoration:none}
a:focus-visible{outline:3px solid #4169e1}span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style><a href="https://lilto.invalid/back" role="button">← 戻る</a>
<a href="https://lilto.invalid/close" role="button">チャットに戻る</a><span>リンク先を表示中</span></html>`;

function isWebUrl(url: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Keep the chat alive and its privileged preload away from linked websites. */
export function installLinkNavigation(window: BrowserWindow): void {
  let content: WebContentsView | null = null;
  let toolbar: WebContentsView | null = null;

  const close = () => {
    for (const view of [content, toolbar]) {
      if (!view) continue;
      if (!window.isDestroyed()) window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    content = null;
    toolbar = null;
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.focus();
  };

  const layout = () => {
    const [width, height] = window.getContentSize();
    toolbar?.setBounds({ x: 0, y: 0, width, height: toolbarHeight });
    content?.setBounds({ x: 0, y: toolbarHeight, width, height: Math.max(0, height - toolbarHeight) });
  };

  const open = (url: string) => {
    if (!isWebUrl(url)) return;
    if (!content) {
      content = new WebContentsView({
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: "lilto-links" }
      });
      toolbar = new WebContentsView({
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      window.contentView.addChildView(content);
      window.contentView.addChildView(toolbar);
      content.webContents.on("will-navigate", (event, target) => {
        if (!isWebUrl(target)) event.preventDefault();
      });
      content.webContents.on("will-redirect", (event, target) => {
        if (!isWebUrl(target)) event.preventDefault();
      });
      content.webContents.setWindowOpenHandler(({ url: target }) => {
        open(target);
        return { action: "deny" };
      });
      toolbar.webContents.on("will-navigate", (event, target) => {
        event.preventDefault();
        if (target === "https://lilto.invalid/back" && content?.webContents.navigationHistory.canGoBack()) {
          content.webContents.navigationHistory.goBack();
        } else {
          close();
        }
      });
      toolbar.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      void toolbar.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toolbarHtml)}`);
      layout();
    }
    // A failed/offline page must still leave the toolbar available to return.
    void content.webContents.loadURL(url).catch(() => {});
  };

  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    open(url);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    open(url);
    return { action: "deny" };
  });
  window.on("resize", layout);
  window.on("closed", close);
}
