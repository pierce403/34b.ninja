import { IMAGE_BYTES, IMAGE_HEIGHT, IMAGE_WIDTH } from "./protocol.js";

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

function sourceDimensions(source) {
  const width = source.naturalWidth || source.videoWidth || source.width;
  const height = source.naturalHeight || source.videoHeight || source.height;
  if (!width || !height) throw new TypeError("Image dimensions are unavailable.");
  return { width, height };
}

export function createCropState() {
  return { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 };
}

export function clampCropState(source, state) {
  const { width, height } = sourceDimensions(source);
  const quarterTurns = ((state.rotation / 90) % 4 + 4) % 4;
  const rotatedWidth = quarterTurns % 2 === 0 ? width : height;
  const rotatedHeight = quarterTurns % 2 === 0 ? height : width;
  state.zoom = Math.max(1, Math.min(8, state.zoom));
  const baseScale = Math.max(IMAGE_WIDTH / rotatedWidth, IMAGE_HEIGHT / rotatedHeight);
  const scale = baseScale * state.zoom;
  const maxX = Math.max(0, (rotatedWidth * scale - IMAGE_WIDTH) / 2);
  const maxY = Math.max(0, (rotatedHeight * scale - IMAGE_HEIGHT) / 2);

  state.offsetX = Math.max(-maxX, Math.min(maxX, state.offsetX));
  state.offsetY = Math.max(-maxY, Math.min(maxY, state.offsetY));
  state.rotation = quarterTurns * 90;
  return state;
}

export function renderCrop(source, canvas, state, outputSize = IMAGE_WIDTH) {
  clampCropState(source, state);
  const { width, height } = sourceDimensions(source);
  const quarterTurns = ((state.rotation / 90) % 4 + 4) % 4;
  const rotatedWidth = quarterTurns % 2 === 0 ? width : height;
  const rotatedHeight = quarterTurns % 2 === 0 ? height : width;
  const scale = Math.max(outputSize / rotatedWidth, outputSize / rotatedHeight) * state.zoom;
  const unit = outputSize / IMAGE_WIDTH;

  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d", { alpha: false });
  context.save();
  context.fillStyle = "#fff";
  context.fillRect(0, 0, outputSize, outputSize);
  context.translate(outputSize / 2 + state.offsetX * unit, outputSize / 2 + state.offsetY * unit);
  context.scale(scale, scale);
  context.rotate((state.rotation * Math.PI) / 180);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, -width / 2, -height / 2, width, height);
  context.restore();
  return canvas;
}

function grayscalePixel(data, offset) {
  const alpha = data[offset + 3] / 255;
  const red = data[offset] * alpha + 255 * (1 - alpha);
  const green = data[offset + 1] * alpha + 255 * (1 - alpha);
  const blue = data[offset + 2] * alpha + 255 * (1 - alpha);
  return (299 * red + 587 * green + 114 * blue) / 1_000;
}

function applyContrast(value, contrast) {
  if (!contrast) return value;
  const bounded = Math.max(-100, Math.min(100, contrast));
  const factor = (259 * (bounded + 255)) / (255 * (259 - bounded));
  return Math.max(0, Math.min(255, factor * (value - 128) + 128));
}

export function ditherImageData(imageData, options = {}) {
  const {
    mode = "floyd-steinberg",
    threshold = 128,
    contrast = 0,
    invert = false,
  } = options;
  const { data, width, height } = imageData;
  const values = new Float32Array(width * height);
  const bits = new Uint8Array(width * height);

  for (let index = 0; index < values.length; index += 1) {
    let value = applyContrast(grayscalePixel(data, index * 4), contrast);
    if (invert) value = 255 - value;
    values[index] = value;
  }

  if (mode === "floyd-steinberg") {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const oldPixel = values[index];
        const newPixel = oldPixel < threshold ? 0 : 255;
        bits[index] = newPixel === 0 ? 1 : 0;
        const error = oldPixel - newPixel;
        if (x + 1 < width) values[index + 1] += (error * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) values[index + width - 1] += (error * 3) / 16;
          values[index + width] += (error * 5) / 16;
          if (x + 1 < width) values[index + width + 1] += error / 16;
        }
      }
    }
    return bits;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mode === "bayer") {
        const matrix = BAYER_4X4[(y % 4) * 4 + (x % 4)];
        const localThreshold = threshold + (matrix - 7.5) * 8;
        bits[index] = values[index] < localThreshold ? 1 : 0;
      } else {
        bits[index] = values[index] < threshold ? 1 : 0;
      }
    }
  }
  return bits;
}

export function processCropCanvas(canvas, options) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  return ditherImageData(imageData, options);
}

export function packBitmap(bits) {
  if (!(bits instanceof Uint8Array) || bits.length !== IMAGE_WIDTH * IMAGE_HEIGHT) {
    throw new RangeError("Bitmap must contain exactly 16,384 logical pixels.");
  }
  const payload = new Uint8Array(IMAGE_BYTES);
  for (let y = 0; y < IMAGE_HEIGHT; y += 1) {
    for (let x = 0; x < IMAGE_WIDTH; x += 1) {
      if (bits[y * IMAGE_WIDTH + x] === 0) continue;
      const byteOffset = y * 16 + Math.floor(x / 32) * 4 + 3 - Math.floor((x % 32) / 8);
      payload[byteOffset] |= 1 << (x % 8);
    }
  }
  return payload;
}

export function bitmapToImageData(bits) {
  if (!(bits instanceof Uint8Array) || bits.length !== IMAGE_WIDTH * IMAGE_HEIGHT) {
    throw new RangeError("Bitmap must contain exactly 16,384 logical pixels.");
  }
  const data = new Uint8ClampedArray(IMAGE_WIDTH * IMAGE_HEIGHT * 4);
  for (let index = 0; index < bits.length; index += 1) {
    const value = bits[index] ? 0 : 255;
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return new ImageData(data, IMAGE_WIDTH, IMAGE_HEIGHT);
}

export function renderBitmap(canvas, bits) {
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  context.putImageData(bitmapToImageData(bits), 0, 0);
  return canvas;
}

const PIXEL_FONT = Object.freeze({
  " ": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0f, 0x10, 0x10, 0x10, 0x10, 0x10, 0x0f],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0f, 0x10, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1f],
  J: [0x01, 0x01, 0x01, 0x01, 0x11, 0x11, 0x0e],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  3: [0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  5: [0x1f, 0x10, 0x10, 0x1e, 0x01, 0x01, 0x1e],
  6: [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  ",": [0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c, 0x08],
  ":": [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  _: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f],
  "/": [0x01, 0x02, 0x04, 0x08, 0x10, 0x00, 0x00],
  "+": [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  "#": [0x0a, 0x1f, 0x0a, 0x0a, 0x1f, 0x0a, 0x00],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
  "@": [0x0e, 0x11, 0x17, 0x15, 0x17, 0x10, 0x0f],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  "'": [0x04, 0x04, 0x02, 0x00, 0x00, 0x00, 0x00],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  "=": [0x00, 0x1f, 0x00, 0x1f, 0x00, 0x00, 0x00],
});

function normalizePixelText(value, fallback, maximumLength) {
  const normalized = String(value || fallback)
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  return [...(normalized || fallback)]
    .slice(0, maximumLength)
    .map((character) => (PIXEL_FONT[character] ? character : "?"))
    .join("");
}

function pixelTextWidth(text, scale) {
  return text.length === 0 ? 0 : (text.length * 6 - 1) * scale;
}

function splitAtWordBoundary(text, maximumCharacters) {
  let best = null;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== " ") continue;
    const first = text.slice(0, index).trim();
    const second = text.slice(index + 1).trim();
    if (!first || !second || first.length > maximumCharacters || second.length > maximumCharacters) continue;
    const score = Math.abs(first.length - second.length);
    if (!best || score < best.score) best = { lines: [first, second], score };
  }
  return best?.lines || null;
}

function fitPixelText(text, maximumWidth) {
  for (let scale = 3; scale >= 1; scale -= 1) {
    const maximumCharacters = Math.floor((maximumWidth / scale + 1) / 6);
    if (text.length <= maximumCharacters) return { lines: [text], scale };
    const wordLines = splitAtWordBoundary(text, maximumCharacters);
    if (wordLines) return { lines: wordLines, scale };
    if (!text.includes(" ") && text.length <= maximumCharacters * 2) {
      return { lines: [text.slice(0, maximumCharacters), text.slice(maximumCharacters)], scale };
    }
  }
  return { lines: [text.slice(0, 18), text.slice(18, 36)], scale: 1 };
}

function fillBitmapRect(bitmap, x, y, width, height, bit) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(IMAGE_WIDTH, Math.ceil(x + width));
  const bottom = Math.min(IMAGE_HEIGHT, Math.ceil(y + height));
  for (let row = top; row < bottom; row += 1) {
    bitmap.fill(bit, row * IMAGE_WIDTH + left, row * IMAGE_WIDTH + right);
  }
}

function drawPixelText(bitmap, text, centerX, top, scale, bit) {
  let x = Math.floor(centerX - pixelTextWidth(text, scale) / 2);
  for (const character of text) {
    const rows = PIXEL_FONT[character] || PIXEL_FONT["?"];
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if ((rows[row] & (1 << (4 - column))) === 0) continue;
        fillBitmapRect(bitmap, x + column * scale, top + row * scale, scale, scale, bit);
      }
    }
    x += 6 * scale;
  }
}

function drawCenteredLines(bitmap, lines, scale, regionTop, regionHeight, bit) {
  const lineGap = 2 * scale;
  const totalHeight = lines.length * 7 * scale + Math.max(0, lines.length - 1) * lineGap;
  let y = regionTop + Math.floor((regionHeight - totalHeight) / 2);
  for (const line of lines) {
    drawPixelText(bitmap, line, IMAGE_WIDTH / 2, y, scale, bit);
    y += 7 * scale + lineGap;
  }
}

export function makeNametagBitmap(options = {}) {
  const {
    header = "HELLO, MY HANDLE IS",
    handle = "YOUR HANDLE",
    subtitle = "DEF CON 34",
    inverse = false,
  } = options;
  const backgroundBit = inverse ? 1 : 0;
  const foregroundBit = inverse ? 0 : 1;
  const bitmap = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT).fill(backgroundBit);

  fillBitmapRect(bitmap, 4, 4, 120, 2, foregroundBit);
  fillBitmapRect(bitmap, 4, 122, 120, 2, foregroundBit);
  fillBitmapRect(bitmap, 4, 4, 2, 120, foregroundBit);
  fillBitmapRect(bitmap, 122, 4, 2, 120, foregroundBit);

  const headerText = normalizePixelText(header, "BADGE ART", 19);
  drawPixelText(bitmap, headerText, IMAGE_WIDTH / 2, 13, 1, foregroundBit);
  fillBitmapRect(bitmap, 10, 27, 108, 2, foregroundBit);

  const handleText = normalizePixelText(handle, "YOUR HANDLE", 32);
  const handleLayout = fitPixelText(handleText, 108);
  drawCenteredLines(bitmap, handleLayout.lines, handleLayout.scale, 35, 52, foregroundBit);

  const subtitleText = normalizePixelText(subtitle, "DEF CON 34", 28);
  const subtitleLines = subtitleText.length <= 18
    ? [subtitleText]
    : splitAtWordBoundary(subtitleText, 18) || [subtitleText.slice(0, 18), subtitleText.slice(18, 36)];
  drawCenteredLines(bitmap, subtitleLines, 1, 94, 17, foregroundBit);
  return bitmap;
}

export function renderNametag(canvas, options = {}) {
  return renderBitmap(canvas, makeNametagBitmap(options));
}

export async function bitmapToPngBlob(bits) {
  const canvas = document.createElement("canvas");
  renderBitmap(canvas, bits);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode PNG."))), "image/png");
  });
}
