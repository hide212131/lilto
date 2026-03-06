import { app, BrowserWindow, nativeImage, Notification, Tray } from "electron";
import { deflateSync } from "node:zlib";

/**
 * 16x16 の赤い円 PNG をプログラムで生成する。
 * アイコンファイルが存在しない環境でも動作するよう zlib で圧縮した生 PNG バイト列を返す。
 */
function createRedDotPng(size = 16): Buffer {
  const center = size / 2;
  const radius = size / 2 - 0.5;
  const rowStride = 1 + size * 4; // filter byte + RGBA * width
  const raw = Buffer.alloc(size * rowStride, 0);

  for (let y = 0; y < size; y++) {
    raw[y * rowStride] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      if (dx * dx + dy * dy <= radius * radius) {
        const off = y * rowStride + 1 + x * 4;
        raw[off] = 229; // R
        raw[off + 1] = 62; // G
        raw[off + 2] = 62; // B  => #e53e3e (red)
        raw[off + 3] = 255; // A
      }
    }
  }

  const compressed = deflateSync(raw);

  function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (const b of buf) {
      crc ^= b;
      for (let i = 0; i < 8; i++) {
        crc = (crc & 1) !== 0 ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
    return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  // compression(0), filter(0), interlace(0) already 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    chunk("IHDR", ihdrData),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/**
 * シンプルな単色塗りつぶし PNG を生成する。
 * トレイアイコン用（グレー系）。
 */
function createSolidCirclePng(size: number, r: number, g: number, b: number): Buffer {
  const center = size / 2;
  const radius = size / 2 - 0.5;
  const rowStride = 1 + size * 4;
  const raw = Buffer.alloc(size * rowStride, 0);

  for (let y = 0; y < size; y++) {
    raw[y * rowStride] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      if (dx * dx + dy * dy <= radius * radius) {
        const off = y * rowStride + 1 + x * 4;
        raw[off] = r;
        raw[off + 1] = g;
        raw[off + 2] = b;
        raw[off + 3] = 255;
      }
    }
  }

  const compressed = deflateSync(raw);

  function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buf) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        crc = (crc & 1) !== 0 ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
    return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdrData),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

export class NotificationService {
  private _unreadCount = 0;
  private _badgeImage: ReturnType<typeof nativeImage.createFromBuffer> | null = null;
  private _tray: Tray | null = null;
  private _trayNormalImage: ReturnType<typeof nativeImage.createFromBuffer> | null = null;
  private _trayBadgeImage: ReturnType<typeof nativeImage.createFromBuffer> | null = null;

  /**
   * システムトレイにアイコンを設定する。
   * クリックでウインドウを表示/非表示する。
   */
  setupTray(getWindow: () => BrowserWindow | null): void {
    const trayIconSize = process.platform === "darwin" ? 22 : 16;
    // 通常アイコン: 薄いグレーの円
    this._trayNormalImage = nativeImage.createFromBuffer(
      createSolidCirclePng(trayIconSize, 160, 160, 168)
    );
    // バッジありアイコン: 赤い円
    this._trayBadgeImage = nativeImage.createFromBuffer(createRedDotPng(trayIconSize));

    this._tray = new Tray(this._trayNormalImage);
    this._tray.setToolTip("lilto");

    this._tray.on("click", () => {
      const win = getWindow();
      if (!win) return;
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
        win.focus();
      }
    });
  }

  /**
   * AIの返答が届いたことをデスクトップ通知で知らせる。
   */
  notify(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    new Notification({ title, body }).show();
  }

  /**
   * 未読バッジを +1 してアイコンに反映する。
   */
  incrementBadge(): void {
    this._unreadCount++;
    this._applyBadge();
  }

  /**
   * 未読バッジをクリアする（ウインドウがフォーカスされたときに呼ぶ）。
   */
  clearBadge(): void {
    if (this._unreadCount === 0) return;
    this._unreadCount = 0;
    this._applyBadge();
  }

  private _getBadgeOverlayImage(): ReturnType<typeof nativeImage.createFromBuffer> {
    if (!this._badgeImage) {
      this._badgeImage = nativeImage.createFromBuffer(createRedDotPng(16));
    }
    return this._badgeImage;
  }

  private _applyBadge(): void {
    const count = this._unreadCount;

    // macOS: Dock バッジ
    if (process.platform === "darwin") {
      app.dock.setBadge(count > 0 ? String(count) : "");
    }

    // Windows: タスクバーオーバーレイ
    if (process.platform === "win32") {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        const description = count > 0 ? `${count} 件の未読メッセージ` : "";
        win.setOverlayIcon(count > 0 ? this._getBadgeOverlayImage() : null, description);
      }
    }

    // Linux: Unity Launcher バッジカウント
    if (process.platform === "linux" && typeof app.setBadgeCount === "function") {
      app.setBadgeCount(count);
    }

    // トレイアイコンをバッジあり/なしで切り替え
    if (this._tray && this._trayNormalImage && this._trayBadgeImage) {
      this._tray.setImage(count > 0 ? this._trayBadgeImage : this._trayNormalImage);
    }
  }
}
