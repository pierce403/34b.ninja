export const BADGE_VENDOR_ID = 0x1d50;
export const BADGE_PRODUCT_ID = 0x6198;
export const BAUD_RATE = 1_000_000;

export const IMAGE_WIDTH = 128;
export const IMAGE_HEIGHT = 128;
export const IMAGE_BYTES = 2_048;
export const IMAGE_CHUNKS = 32;

export const CHUNK_DATA_BYTES = 64;
export const CHUNK_WIRE_BYTES = 70;
export const BIO_BYTES = 0xf00;
export const BIO_CHUNKS = BIO_BYTES / CHUNK_DATA_BYTES;
export const BIO_MIN_CLOCK = 25_000;
export const BIO_MAX_CLOCK = 350_000_000;

export const SAO_PIN_MAP = Object.freeze({
  1: 21,
  2: 22,
  3: 30,
  4: 31,
});

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC_TABLE.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[i] = value >>> 0;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const batch = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += batch) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + batch));
  }
  return btoa(binary);
}

export function makeChunk(index, data) {
  if (!Number.isInteger(index) || index < 0 || index > 0xffff) {
    throw new RangeError("Chunk index must fit in an unsigned 16-bit integer.");
  }
  if (!(data instanceof Uint8Array) || data.length !== CHUNK_DATA_BYTES) {
    throw new RangeError(`Chunk data must contain ${CHUNK_DATA_BYTES} bytes.`);
  }

  const wire = new Uint8Array(CHUNK_WIRE_BYTES);
  const view = new DataView(wire.buffer);
  view.setUint16(0, index, false);
  wire.set(data, 2);
  view.setUint32(66, crc32(wire.subarray(0, 66)), false);
  return wire;
}

export function makeChunkCommand(prefix, index, data) {
  if (prefix !== "image" && prefix !== "bio") {
    throw new TypeError("Only image and bio chunk commands are supported.");
  }
  return `${prefix} ${bytesToBase64(makeChunk(index, data))}`;
}

export function splitFixedChunks(bytes, totalBytes = bytes.length) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected a Uint8Array.");
  if (!Number.isInteger(totalBytes) || totalBytes <= 0 || totalBytes % CHUNK_DATA_BYTES !== 0) {
    throw new RangeError("Total bytes must be a positive multiple of 64.");
  }
  if (bytes.length > totalBytes) throw new RangeError("Input is larger than the target payload.");

  const padded = new Uint8Array(totalBytes);
  padded.set(bytes);
  const chunks = [];
  for (let offset = 0; offset < padded.length; offset += CHUNK_DATA_BYTES) {
    chunks.push(padded.slice(offset, offset + CHUNK_DATA_BYTES));
  }
  return chunks;
}

export function validateBioBinary(bytes) {
  if (!(bytes instanceof Uint8Array)) return "Choose a BIO .bin file first.";
  if (bytes.length === 0) return "BIO programs cannot be empty.";
  if (bytes.length > BIO_BYTES) {
    return `This binary is ${bytes.length.toLocaleString()} bytes; the badge limit is ${BIO_BYTES.toLocaleString()} bytes.`;
  }
  return null;
}

export function mapSaoSlots(slots) {
  const mapped = [...new Set(slots.map((slot) => Number(slot)))]
    .sort((a, b) => a - b)
    .map((slot) => {
      const pin = SAO_PIN_MAP[slot];
      if (!pin) throw new RangeError(`Unknown SAO slot ${slot}.`);
      return pin;
    });
  return mapped;
}

export function parseFrequency(raw) {
  const match = String(raw)
    .trim()
    .match(/^([0-9]+(?:\.[0-9]+)?)\s*(mhz|khz|hz)?$/i);
  if (!match) throw new RangeError("Use a frequency such as 1 MHz, 48 kHz, or 1000000 Hz.");

  const multipliers = { mhz: 1_000_000, khz: 1_000, hz: 1 };
  const multiplier = multipliers[(match[2] || "hz").toLowerCase()];
  const hz = Math.round(Number(match[1]) * multiplier);
  if (!Number.isSafeInteger(hz) || hz < BIO_MIN_CLOCK || hz > BIO_MAX_CLOCK) {
    throw new RangeError("BIO clock must be between 25 kHz and 350 MHz.");
  }
  return hz;
}

export function formatFrequency(hz) {
  if (hz >= 1_000_000 && hz % 1_000_000 === 0) return `${hz / 1_000_000} MHz`;
  if (hz >= 1_000 && hz % 1_000 === 0) return `${hz / 1_000} kHz`;
  return `${hz.toLocaleString()} Hz`;
}

export function formatUsbId(value) {
  return Number.isInteger(value)
    ? `0x${value.toString(16).toUpperCase().padStart(4, "0")}`
    : "Not reported";
}

export function extractXousVersion(text) {
  const match = String(text).match(/Xous version:\s*([^\r\n]+)/i);
  return match ? match[1].trim() : null;
}

function isChunkArgument(value) {
  return value.length === 96 && /^[A-Za-z0-9+/]{94}==$/.test(value);
}

export function isAllowedCommand(command) {
  const trimmed = String(command).trim();
  if (trimmed === "ver xous" || trimmed === "image clear") return true;
  if (trimmed === "bio ready" || trimmed === "bio clear" || trimmed === "bio reload") return true;
  if (trimmed === "bio rx 1 1") return true;

  const [verb, ...parts] = trimmed.split(/\s+/);
  if ((verb === "image" || verb === "bio") && parts.length === 1 && isChunkArgument(parts[0])) {
    return true;
  }
  if (verb === "bio" && parts[0] === "pin" && parts.length >= 2 && parts.length <= 5) {
    const pins = parts.slice(1).map(Number);
    return pins.every((pin) => [21, 22, 30, 31].includes(pin)) && new Set(pins).size === pins.length;
  }
  if (verb === "bio" && parts[0] === "clk" && parts.length === 2) {
    const hz = Number(parts[1]);
    return Number.isInteger(hz) && hz >= BIO_MIN_CLOCK && hz <= BIO_MAX_CLOCK;
  }
  if (verb === "bio" && parts[0] === "tx" && parts.length === 2) {
    const value = /^0x[0-9a-f]+$/i.test(parts[1]) ? Number.parseInt(parts[1].slice(2), 16) : Number(parts[1]);
    return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
  }
  return false;
}

export function parseBioRxWord(lines) {
  for (const line of [...lines].reverse()) {
    if (!/dc34_console::cmds::bio/i.test(line)) continue;
    const match = line.match(/:\s*([0-9a-f]{1,8})(?:\s|\()/i);
    if (match) return Number.parseInt(match[1], 16) >>> 0;
  }
  return null;
}
