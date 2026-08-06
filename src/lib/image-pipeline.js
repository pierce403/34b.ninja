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

function fitText(context, text, maximumWidth, maximumSize, minimumSize = 8) {
  let size = maximumSize;
  do {
    context.font = `900 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    if (context.measureText(text).width <= maximumWidth) return size;
    size -= 1;
  } while (size >= minimumSize);
  return minimumSize;
}

export function renderNametag(canvas, options = {}) {
  const {
    handle = "YOUR HANDLE",
    subtitle = "DEF CON 34",
    inverse = false,
  } = options;
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  const background = inverse ? "#000" : "#fff";
  const foreground = inverse ? "#fff" : "#000";
  context.fillStyle = background;
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  context.strokeStyle = foreground;
  context.lineWidth = 3;
  context.strokeRect(4.5, 4.5, 119, 119);

  context.fillStyle = foreground;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "700 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  context.fillText("HELLO, MY HANDLE IS", 64, 18);
  context.fillRect(10, 27, 108, 2);

  const label = String(handle || "YOUR HANDLE").trim().toUpperCase().slice(0, 32);
  const words = label.split(/\s+/);
  context.font = "900 27px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  if (words.length > 1 && context.measureText(label).width > 108) {
    const midpoint = Math.ceil(words.length / 2);
    const first = words.slice(0, midpoint).join(" ");
    const second = words.slice(midpoint).join(" ");
    fitText(context, first.length > second.length ? first : second, 108, 23, 9);
    context.fillText(first, 64, 57);
    context.fillText(second, 64, 82);
  } else {
    fitText(context, label, 108, 27, 10);
    context.fillText(label, 64, 69);
  }

  context.font = "700 8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  context.fillText(String(subtitle || "DEF CON 34").trim().toUpperCase().slice(0, 28), 64, 108);
  return canvas;
}

export async function bitmapToPngBlob(bits) {
  const canvas = document.createElement("canvas");
  renderBitmap(canvas, bits);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode PNG."))), "image/png");
  });
}
