import { app, BrowserWindow, nativeImage, Notification, Tray } from "electron";
import { deflateSync } from "node:zlib";
import { createCountBadgeBitmap } from "./badge-bitmap";
import { resolveTrayIcon } from "./icon-assets";

/**
 * マスコット（緑の電球キャラクター）の顔を模した PNG を生成する。
 * 緑の円に白目・黒目・口を描画したトレイアイコン用。
 */
function createMascotFacePng(size: number, hasNotification = false): Buffer {
  const center = size / 2;
  const radius = size / 2 - 0.5;
  const rowStride = 1 + size * 4;
  const raw = Buffer.alloc(size * rowStride, 0);

  // 通知あり: 赤めの色、通常: マスコット緑
  const faceR = hasNotification ? 200 : 184;
  const faceG = hasNotification ? 80 : 230;
  const faceB = hasNotification ? 80 : 168;

  for (let y = 0; y < size; y++) {
    raw[y * rowStride] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const distSq = dx * dx + dy * dy;
      if (distSq > radius * radius) continue;

      const off = y * rowStride + 1 + x * 4;

      // 目の位置: 左目・右目（中心より上）
      const eyeRadius = Math.max(1.2, size * 0.12);
      const eyeOffsetX = size * 0.22;
      const eyeOffsetY = size * 0.08;
      const leftEyeDx = dx + eyeOffsetX;
      const leftEyeDy = dy + eyeOffsetY;
      const rightEyeDx = dx - eyeOffsetX;
      const rightEyeDy = dy + eyeOffsetY;
      const inLeftEye = leftEyeDx * leftEyeDx + leftEyeDy * leftEyeDy <= eyeRadius * eyeRadius;
      const inRightEye = rightEyeDx * rightEyeDx + rightEyeDy * rightEyeDy <= eyeRadius * eyeRadius;

      // 口の位置: 中心より下の弧（簡易: 横長の楕円）
      const mouthCy = center - size * 0.18;
      const mouthRx = size * 0.22;
      const mouthRy = size * 0.1;
      const mouthDx = (x + 0.5 - center) / mouthRx;
      const mouthDy = (y + 0.5 - mouthCy) / mouthRy;
      const inMouth = mouthDx * mouthDx + mouthDy * mouthDy <= 1
        && y + 0.5 > mouthCy;

      if (inLeftEye || inRightEye) {
        raw[off] = 26; raw[off + 1] = 26; raw[off + 2] = 26; raw[off + 3] = 255;
      } else if (inMouth) {
        raw[off] = 208; raw[off + 1] = 96; raw[off + 2] = 112; raw[off + 3] = 255;
      } else {
        raw[off] = faceR; raw[off + 1] = faceG; raw[off + 2] = faceB; raw[off + 3] = 255;
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
  private _badgeImages = new Map<number, ReturnType<typeof nativeImage.createFromBitmap>>();
  private _tray: Tray | null = null;
  private _trayNormalImage: ReturnType<typeof nativeImage.createFromBuffer> | null = null;
  private _trayBadgeImage: ReturnType<typeof nativeImage.createFromBuffer> | null = null;

  /**
   * システムトレイにアイコンを設定する。
   * クリックでウインドウを表示/非表示する。
   */
  setupTray(getWindow: () => BrowserWindow | null): void {
    const trayIconSize = process.platform === "darwin" ? 22 : 16;
    const normalFromAsset = resolveTrayIcon(trayIconSize);

    this._trayNormalImage = normalFromAsset.isEmpty()
      ? nativeImage.createFromBuffer(createMascotFacePng(trayIconSize, false))
      : normalFromAsset;

    this._trayBadgeImage = normalFromAsset.isEmpty()
      ? nativeImage.createFromBuffer(createMascotFacePng(trayIconSize, true))
      : normalFromAsset;

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

  private _getBadgeOverlayImage(count: number): ReturnType<typeof nativeImage.createFromBitmap> {
    const cached = this._badgeImages.get(count);
    if (cached) {
      return cached;
    }

    const badge = createCountBadgeBitmap(count, 16);
    const image = nativeImage.createFromBitmap(badge.bitmap, {
      width: badge.width,
      height: badge.height,
      scaleFactor: 1
    });
    this._badgeImages.set(count, image);
    return image;
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
        win.setOverlayIcon(count > 0 ? this._getBadgeOverlayImage(count) : null, description);
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
