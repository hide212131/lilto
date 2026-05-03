const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage } = require("electron");

function cropTransparentBounds(image) {
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

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const bitmap = Buffer.alloc(width * height * 4, 0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcOffset = ((y + minY) * size.width + (x + minX)) * 4;
      const dstOffset = (y * width + x) * 4;
      bitmap[dstOffset] = source[srcOffset];
      bitmap[dstOffset + 1] = source[srcOffset + 1];
      bitmap[dstOffset + 2] = source[srcOffset + 2];
      bitmap[dstOffset + 3] = source[srcOffset + 3];
    }
  }

  return nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
}

function composeIcon(sourcePath, outputPath, size, options = {}) {
  const source = cropTransparentBounds(nativeImage.createFromPath(sourcePath));
  if (source.isEmpty()) {
    throw new Error(`Could not read source icon: ${sourcePath}`);
  }

  const canvas = Buffer.alloc(size * size * 4, 0);
  if (options.background === "white") {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4;
        canvas[offset] = 255;
        canvas[offset + 1] = 255;
        canvas[offset + 2] = 255;
        canvas[offset + 3] = 255;
      }
    }
  }

  const inset = Math.floor(size * 0.03);
  const innerSize = size - inset * 2;
  const sourceSize = source.getSize();
  const scale = innerSize / Math.max(sourceSize.width, sourceSize.height);
  const mascotWidth = Math.max(1, Math.round(sourceSize.width * scale));
  const mascotHeight = Math.max(1, Math.round(sourceSize.height * scale));
  const mascot = source.resize({ width: mascotWidth, height: mascotHeight, quality: "best" });
  const mascotBitmap = mascot.toBitmap();
  const left = inset + Math.floor((innerSize - mascotWidth) / 2);
  const top = inset + Math.floor((innerSize - mascotHeight) / 2);

  for (let y = 0; y < mascotHeight; y++) {
    for (let x = 0; x < mascotWidth; x++) {
      const srcOffset = (y * mascotWidth + x) * 4;
      const alpha = mascotBitmap[srcOffset + 3];
      if (alpha === 0) {
        continue;
      }
      const dstOffset = ((top + y) * size + (left + x)) * 4;
      canvas[dstOffset] = mascotBitmap[srcOffset];
      canvas[dstOffset + 1] = mascotBitmap[srcOffset + 1];
      canvas[dstOffset + 2] = mascotBitmap[srcOffset + 2];
      canvas[dstOffset + 3] = alpha;
    }
  }

  const icon = nativeImage.createFromBitmap(canvas, { width: size, height: size, scaleFactor: 1 });
  fs.writeFileSync(outputPath, icon.toPNG());
  return icon;
}

function createPngIco(images) {
  const headerSize = 6;
  const directorySize = 16 * images.length;
  let imageOffset = headerSize + directorySize;
  const buffers = [Buffer.alloc(headerSize), Buffer.alloc(directorySize)];

  buffers[0].writeUInt16LE(0, 0);
  buffers[0].writeUInt16LE(1, 2);
  buffers[0].writeUInt16LE(images.length, 4);

  images.forEach((image, index) => {
    const png = image.nativeImage.toPNG();
    const dirOffset = index * 16;
    buffers[1][dirOffset] = image.size >= 256 ? 0 : image.size;
    buffers[1][dirOffset + 1] = image.size >= 256 ? 0 : image.size;
    buffers[1][dirOffset + 2] = 0;
    buffers[1][dirOffset + 3] = 0;
    buffers[1].writeUInt16LE(1, dirOffset + 4);
    buffers[1].writeUInt16LE(32, dirOffset + 6);
    buffers[1].writeUInt32LE(png.length, dirOffset + 8);
    buffers[1].writeUInt32LE(imageOffset, dirOffset + 12);
    imageOffset += png.length;
    buffers.push(png);
  });

  return Buffer.concat(buffers);
}

app.whenReady()
  .then(() => {
    const rootDir = path.resolve(__dirname, "..");
    const sourcePath = path.join(rootDir, "src", "renderer", "public", "mascot.png");
    const pngPath = path.join(rootDir, "build", "icon.png");
    const icoPath = path.join(rootDir, "build", "icon.ico");
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    composeIcon(sourcePath, pngPath, 512, { background: "white" });

    const icoImages = [16, 24, 32, 48, 64, 128, 256].map((size) => ({
      size,
      nativeImage: composeIcon(sourcePath, path.join(rootDir, "build", `icon-${size}.png`), size)
    }));
    fs.writeFileSync(icoPath, createPngIco(icoImages));
  })
  .finally(() => app.quit());
