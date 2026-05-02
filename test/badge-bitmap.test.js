const test = require("node:test");
const assert = require("node:assert/strict");

const { createCountBadgeBitmap } = require("../dist/main/badge-bitmap.js");

function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return {
    b: image.bitmap[offset],
    g: image.bitmap[offset + 1],
    r: image.bitmap[offset + 2],
    a: image.bitmap[offset + 3]
  };
}

test("count badge draws a red circle with white numeric pixels", () => {
  const image = createCountBadgeBitmap(3, 16);
  const redPixels = [];
  const whitePixels = [];

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const pixel = pixelAt(image, x, y);
      if (pixel.a === 0) {
        continue;
      }
      if (pixel.r > 180 && pixel.g < 80 && pixel.b < 80) {
        redPixels.push(pixel);
      }
      if (pixel.r > 240 && pixel.g > 240 && pixel.b > 240) {
        whitePixels.push(pixel);
      }
    }
  }

  assert.equal(image.width, 16);
  assert.equal(image.height, 16);
  assert.ok(redPixels.length > 80);
  assert.ok(whitePixels.length > 0);
});

test("count badge is transparent when count is zero", () => {
  const image = createCountBadgeBitmap(0, 16);
  assert.ok(image.bitmap.every((value, index) => index % 4 !== 3 || value === 0));
});
