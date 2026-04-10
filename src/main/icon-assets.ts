import fs from "node:fs";
import { nativeImage, type NativeImage } from "electron";
import { resolveMascotPngPath as resolveMascotPngPathFromApp } from "./app-paths";

let cachedMascotImage: NativeImage | null = null;

function resolveMascotPngPath(): string | null {
  const candidate = resolveMascotPngPathFromApp();
  return candidate && fs.existsSync(candidate) ? candidate : null;
}

function loadMascotImage(): NativeImage {
  if (cachedMascotImage) {
    return cachedMascotImage;
  }

  const mascotPath = resolveMascotPngPath();
  if (!mascotPath) {
    cachedMascotImage = nativeImage.createEmpty();
    return cachedMascotImage;
  }

  const image = nativeImage.createFromPath(mascotPath);
  cachedMascotImage = image.isEmpty() ? nativeImage.createEmpty() : image;
  return cachedMascotImage;
}

function resizeMascot(size: number): NativeImage {
  const source = loadMascotImage();
  if (source.isEmpty()) {
    return source;
  }
  return source.resize({ width: size, height: size, quality: "best" });
}

type RgbaColor = {
  r: number;
  g: number;
  b: number;
  a?: number;
};

function createRoundedMascot(size: number, insetRatio = 0, backgroundColor?: RgbaColor): NativeImage {
  const resized = resizeMascot(size);
  if (resized.isEmpty()) {
    return resized;
  }

  const source = resized.toBitmap();
  const bitmap = Buffer.alloc(source.length, 0);
  const inset = Math.max(0, Math.floor(size * insetRatio));
  const innerSize = Math.max(1, size - inset * 2);
  const scaled = resized.resize({ width: innerSize, height: innerSize, quality: "best" }).toBitmap();

  for (let y = 0; y < innerSize; y++) {
    for (let x = 0; x < innerSize; x++) {
      const srcOffset = (y * innerSize + x) * 4;
      const dstX = x + inset;
      const dstY = y + inset;
      const dstOffset = (dstY * size + dstX) * 4;
      bitmap[dstOffset] = scaled[srcOffset];
      bitmap[dstOffset + 1] = scaled[srcOffset + 1];
      bitmap[dstOffset + 2] = scaled[srcOffset + 2];
      bitmap[dstOffset + 3] = scaled[srcOffset + 3];
    }
  }

  const cornerRadius = Math.max(2, Math.floor(innerSize * 0.2));
  const innerLeft = inset;
  const innerTop = inset;
  const innerRight = inset + innerSize - 1;
  const innerBottom = inset + innerSize - 1;

  const isInsideRoundedRect = (x: number, y: number): boolean => {
    const left = innerLeft + cornerRadius;
    const right = innerRight - cornerRadius;
    const top = innerTop + cornerRadius;
    const bottom = innerBottom - cornerRadius;

    if ((x >= left && x <= right) || (y >= top && y <= bottom)) {
      return true;
    }

    const cx = x < left ? left : right;
    const cy = y < top ? top : bottom;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= cornerRadius * cornerRadius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x >= innerLeft && x <= innerRight && y >= innerTop && y <= innerBottom && isInsideRoundedRect(x, y)) {
        if (backgroundColor) {
          const offset = (y * size + x) * 4;
          bitmap[offset] = backgroundColor.b;
          bitmap[offset + 1] = backgroundColor.g;
          bitmap[offset + 2] = backgroundColor.r;
          bitmap[offset + 3] = backgroundColor.a ?? 255;
        }
        continue;
      }
      const offset = (y * size + x) * 4;
      bitmap[offset] = 0;
      bitmap[offset + 1] = 0;
      bitmap[offset + 2] = 0;
      bitmap[offset + 3] = 0;
    }
  }

  for (let y = 0; y < innerSize; y++) {
    for (let x = 0; x < innerSize; x++) {
      const srcOffset = (y * innerSize + x) * 4;
      const alpha = scaled[srcOffset + 3];
      if (alpha === 0) {
        continue;
      }
      const dstX = x + inset;
      const dstY = y + inset;
      const dstOffset = (dstY * size + dstX) * 4;
      bitmap[dstOffset] = scaled[srcOffset];
      bitmap[dstOffset + 1] = scaled[srcOffset + 1];
      bitmap[dstOffset + 2] = scaled[srcOffset + 2];
      bitmap[dstOffset + 3] = alpha;
    }
  }

  return nativeImage.createFromBitmap(bitmap, {
    width: size,
    height: size,
    scaleFactor: 1
  });
}

export function resolveWindowIcon(): NativeImage | undefined {
  if (process.platform === "win32" || process.platform === "linux") {
    const icon = resolveAppIcon(256);
    if (!icon.isEmpty()) {
      return icon;
    }
  }
  return undefined;
}

export function resolveAppIcon(size = 256): NativeImage {
  return createRoundedMascot(size, 0.08, { r: 255, g: 255, b: 255, a: 255 });
}

export function resolveTrayIcon(size: number): NativeImage {
  return createRoundedMascot(size, 0.05);
}

export function resolveBadgeIcon(size: number): NativeImage {
  return createRoundedMascot(size, 0.05);
}
