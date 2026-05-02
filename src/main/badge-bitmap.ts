type BitmapColor = {
  r: number;
  g: number;
  b: number;
  a?: number;
};

export type BitmapImage = {
  bitmap: Buffer;
  width: number;
  height: number;
};

const DIGIT_GLYPHS: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["010", "010", "111", "010", "010"]
};

function setPixel(bitmap: Buffer, width: number, x: number, y: number, color: BitmapColor): void {
  if (x < 0 || y < 0 || x >= width) {
    return;
  }
  const offset = (y * width + x) * 4;
  if (offset < 0 || offset + 3 >= bitmap.length) {
    return;
  }
  bitmap[offset] = color.b;
  bitmap[offset + 1] = color.g;
  bitmap[offset + 2] = color.r;
  bitmap[offset + 3] = color.a ?? 255;
}

function fillRect(
  bitmap: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: BitmapColor
): void {
  for (let yy = y; yy < y + rectHeight; yy++) {
    if (yy < 0 || yy >= height) {
      continue;
    }
    for (let xx = x; xx < x + rectWidth; xx++) {
      setPixel(bitmap, width, xx, yy, color);
    }
  }
}

function fillCircle(bitmap: Buffer, width: number, height: number, cx: number, cy: number, radius: number, color: BitmapColor): void {
  const radiusSq = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    if (y < 0 || y >= height) {
      continue;
    }
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= radiusSq) {
        setPixel(bitmap, width, x, y, color);
      }
    }
  }
}

function drawGlyph(
  bitmap: Buffer,
  width: number,
  height: number,
  glyph: readonly string[],
  x: number,
  y: number,
  scale: number,
  color: BitmapColor
): void {
  for (let row = 0; row < glyph.length; row++) {
    for (let col = 0; col < glyph[row].length; col++) {
      if (glyph[row][col] !== "1") {
        continue;
      }
      fillRect(bitmap, width, height, x + col * scale, y + row * scale, scale, scale, color);
    }
  }
}

function formatBadgeCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "";
  }
  if (count > 99) {
    return "99+";
  }
  return String(Math.floor(count));
}

export function createCountBadgeBitmap(count: number, size: number): BitmapImage {
  const safeSize = Math.max(1, Math.floor(size));
  const bitmap = Buffer.alloc(safeSize * safeSize * 4, 0);
  const label = formatBadgeCount(count);
  if (!label) {
    return { bitmap, width: safeSize, height: safeSize };
  }

  const red = { r: 220, g: 20, b: 35, a: 255 };
  const white = { r: 255, g: 255, b: 255, a: 255 };
  fillCircle(bitmap, safeSize, safeSize, safeSize / 2, safeSize / 2, safeSize / 2 - 0.5, red);

  const scale = Math.max(1, Math.floor(safeSize / (label.length >= 3 ? 9 : label.length === 2 ? 8 : 6)));
  const glyphWidth = 3 * scale;
  const glyphHeight = 5 * scale;
  const gap = Math.max(1, Math.floor(scale / 2));
  const totalWidth = label.length * glyphWidth + (label.length - 1) * gap;
  const startX = Math.max(0, Math.floor((safeSize - totalWidth) / 2));
  const startY = Math.max(0, Math.floor((safeSize - glyphHeight) / 2));

  for (let i = 0; i < label.length; i++) {
    const glyph = DIGIT_GLYPHS[label[i]];
    if (!glyph) {
      continue;
    }
    drawGlyph(bitmap, safeSize, safeSize, glyph, startX + i * (glyphWidth + gap), startY, scale, white);
  }

  return { bitmap, width: safeSize, height: safeSize };
}
