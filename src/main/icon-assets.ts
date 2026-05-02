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

function cropTransparentBounds(image: NativeImage): NativeImage {
  const size = image.getSize();
  const source = image.toBitmap();
  let minX = size.width;
  let minY = size.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const alpha = source[(y * size.width + x) * 4 + 3];
      if (alpha === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return image;
  }

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const bitmap = Buffer.alloc(cropWidth * cropHeight * 4, 0);

  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const srcOffset = ((y + minY) * size.width + (x + minX)) * 4;
      const dstOffset = (y * cropWidth + x) * 4;
      bitmap[dstOffset] = source[srcOffset];
      bitmap[dstOffset + 1] = source[srcOffset + 1];
      bitmap[dstOffset + 2] = source[srcOffset + 2];
      bitmap[dstOffset + 3] = source[srcOffset + 3];
    }
  }

  return nativeImage.createFromBitmap(bitmap, {
    width: cropWidth,
    height: cropHeight,
    scaleFactor: 1
  });
}

function resizeMascot(size: number): NativeImage {
  const source = loadMascotImage();
  if (source.isEmpty()) {
    return source;
  }
  const cropped = cropTransparentBounds(source);
  const croppedSize = cropped.getSize();
  const scale = size / Math.max(croppedSize.width, croppedSize.height);
  return cropped.resize({
    width: Math.max(1, Math.round(croppedSize.width * scale)),
    height: Math.max(1, Math.round(croppedSize.height * scale)),
    quality: "best"
  });
}

type RgbaColor = {
  r: number;
  g: number;
  b: number;
  a?: number;
};

function paintPixel(bitmap: Buffer, width: number, x: number, y: number, color: RgbaColor): void {
  const offset = (y * width + x) * 4;
  bitmap[offset] = color.b;
  bitmap[offset + 1] = color.g;
  bitmap[offset + 2] = color.r;
  bitmap[offset + 3] = color.a ?? 255;
}

function copyImageOnto(
  bitmap: Buffer,
  bitmapSize: number,
  image: NativeImage,
  left: number,
  top: number
): void {
  const imageSize = image.getSize();
  const source = image.toBitmap();

  for (let y = 0; y < imageSize.height; y++) {
    for (let x = 0; x < imageSize.width; x++) {
      const srcOffset = (y * imageSize.width + x) * 4;
      const alpha = source[srcOffset + 3];
      if (alpha === 0) {
        continue;
      }
      const dstX = x + left;
      const dstY = y + top;
      if (dstX < 0 || dstY < 0 || dstX >= bitmapSize || dstY >= bitmapSize) {
        continue;
      }
      const dstOffset = (dstY * bitmapSize + dstX) * 4;
      bitmap[dstOffset] = source[srcOffset];
      bitmap[dstOffset + 1] = source[srcOffset + 1];
      bitmap[dstOffset + 2] = source[srcOffset + 2];
      bitmap[dstOffset + 3] = alpha;
    }
  }
}

function createRoundedMascot(
  size: number,
  insetRatio = 0,
  backgroundColor?: RgbaColor,
  backgroundFillsCanvas = false
): NativeImage {
  const resized = resizeMascot(size);
  if (resized.isEmpty()) {
    return resized;
  }

  const bitmap = Buffer.alloc(size * size * 4, 0);
  const inset = Math.max(0, Math.floor(size * insetRatio));
  const innerSize = Math.max(1, size - inset * 2);
  const resizedSize = resized.getSize();
  const fitScale = innerSize / Math.max(resizedSize.width, resizedSize.height);
  const fittedWidth = Math.max(1, Math.round(resizedSize.width * fitScale));
  const fittedHeight = Math.max(1, Math.round(resizedSize.height * fitScale));
  const fittedImage = resized.resize({ width: fittedWidth, height: fittedHeight, quality: "best" });
  const scaled = fittedImage.toBitmap();
  const imageLeft = inset + Math.floor((innerSize - fittedWidth) / 2);
  const imageTop = inset + Math.floor((innerSize - fittedHeight) / 2);

  for (let y = 0; y < fittedHeight; y++) {
    for (let x = 0; x < fittedWidth; x++) {
      const srcOffset = (y * fittedWidth + x) * 4;
      const dstX = x + imageLeft;
      const dstY = y + imageTop;
      const dstOffset = (dstY * size + dstX) * 4;
      bitmap[dstOffset] = scaled[srcOffset];
      bitmap[dstOffset + 1] = scaled[srcOffset + 1];
      bitmap[dstOffset + 2] = scaled[srcOffset + 2];
      bitmap[dstOffset + 3] = scaled[srcOffset + 3];
    }
  }

  const backgroundLeft = backgroundFillsCanvas ? 0 : inset;
  const backgroundTop = backgroundFillsCanvas ? 0 : inset;
  const backgroundRight = backgroundFillsCanvas ? size - 1 : inset + innerSize - 1;
  const backgroundBottom = backgroundFillsCanvas ? size - 1 : inset + innerSize - 1;
  const backgroundRadius = Math.max(2, Math.floor((backgroundFillsCanvas ? size : innerSize) * 0.2));

  const isInsideRoundedRect = (x: number, y: number): boolean => {
    const left = backgroundLeft + backgroundRadius;
    const right = backgroundRight - backgroundRadius;
    const top = backgroundTop + backgroundRadius;
    const bottom = backgroundBottom - backgroundRadius;

    if ((x >= left && x <= right) || (y >= top && y <= bottom)) {
      return true;
    }

    const cx = x < left ? left : right;
    const cy = y < top ? top : bottom;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= backgroundRadius * backgroundRadius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (
        x >= backgroundLeft &&
        x <= backgroundRight &&
        y >= backgroundTop &&
        y <= backgroundBottom &&
        isInsideRoundedRect(x, y)
      ) {
        if (backgroundColor) {
          paintPixel(bitmap, size, x, y, backgroundColor);
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

  for (let y = 0; y < fittedHeight; y++) {
    for (let x = 0; x < fittedWidth; x++) {
      const srcOffset = (y * fittedWidth + x) * 4;
      const alpha = scaled[srcOffset + 3];
      if (alpha === 0) {
        continue;
      }
      const dstX = x + imageLeft;
      const dstY = y + imageTop;
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

function createWindowsTaskbarIcon(size: number): NativeImage {
  const source = loadMascotImage();
  if (source.isEmpty()) {
    return source;
  }

  const safeSize = Math.max(16, Math.floor(size));
  const bitmap = Buffer.alloc(safeSize * safeSize * 4, 0);
  const white = { r: 255, g: 255, b: 255, a: 255 };

  for (let y = 0; y < safeSize; y++) {
    for (let x = 0; x < safeSize; x++) {
      paintPixel(bitmap, safeSize, x, y, white);
    }
  }

  const cropped = cropTransparentBounds(source);
  const croppedSize = cropped.getSize();
  const inset = Math.max(1, Math.floor(safeSize * 0.03));
  const mascotArea = Math.max(1, safeSize - inset * 2);
  const scale = mascotArea / Math.max(croppedSize.width, croppedSize.height);
  const mascot = cropped.resize({
    width: Math.max(1, Math.round(croppedSize.width * scale)),
    height: Math.max(1, Math.round(croppedSize.height * scale)),
    quality: "best"
  });
  const mascotSize = mascot.getSize();

  copyImageOnto(
    bitmap,
    safeSize,
    mascot,
    Math.floor((safeSize - mascotSize.width) / 2),
    Math.floor((safeSize - mascotSize.height) / 2)
  );

  return nativeImage.createFromBitmap(bitmap, {
    width: safeSize,
    height: safeSize,
    scaleFactor: 1
  });
}

export function resolveWindowIcon(): NativeImage | undefined {
  if (process.platform === "win32") {
    const icon = createWindowsTaskbarIcon(256);
    if (!icon.isEmpty()) {
      return icon;
    }
  }
  if (process.platform === "linux") {
    const icon = resolveAppIcon(256);
    if (!icon.isEmpty()) {
      return icon;
    }
  }
  return undefined;
}

export function resolveAppIcon(size = 256): NativeImage {
  if (process.platform === "win32") {
    return createWindowsTaskbarIcon(size);
  }
  return createRoundedMascot(size, 0.08, { r: 255, g: 255, b: 255, a: 255 }, true);
}

export function resolveTrayIcon(size: number): NativeImage {
  return createRoundedMascot(size, 0.05);
}

