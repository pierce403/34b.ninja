import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ditherImageData, makeNametagBitmap, packBitmap } from "../src/lib/image-pipeline.js";
import { bytesToBase64, makeChunk } from "../src/lib/protocol.js";

function bitmapWithPixel(x, y) {
  const bitmap = new Uint8Array(128 * 128);
  bitmap[y * 128 + x] = 1;
  return bitmap;
}

function bitmapHash(bitmap) {
  return createHash("sha256").update(bitmap).digest("hex");
}

function imageDataFromBitmap(bitmap) {
  const data = new Uint8ClampedArray(bitmap.length * 4);
  for (let index = 0; index < bitmap.length; index += 1) {
    const value = bitmap[index] ? 0 : 255;
    data.set([value, value, value, 255], index * 4);
  }
  return { width: 128, height: 128, data };
}

test("packs logical corner pixels in the badge wire orientation", () => {
  const fixtures = [
    { x: 0, y: 0, offset: 3, value: 0x01 },
    { x: 31, y: 0, offset: 0, value: 0x80 },
    { x: 32, y: 0, offset: 7, value: 0x01 },
    { x: 127, y: 0, offset: 12, value: 0x80 },
    { x: 0, y: 127, offset: 2035, value: 0x01 },
    { x: 127, y: 127, offset: 2044, value: 0x80 },
  ];

  for (const fixture of fixtures) {
    const payload = packBitmap(bitmapWithPixel(fixture.x, fixture.y));
    assert.equal(payload[fixture.offset], fixture.value, `pixel ${fixture.x},${fixture.y}`);
    assert.equal(payload.reduce((sum, byte) => sum + (byte !== 0), 0), 1);
  }
});

test("matches official single-pixel chunk vectors", () => {
  const topLeft = packBitmap(bitmapWithPixel(0, 0));
  assert.equal(
    bytesToBase64(makeChunk(0, topLeft.slice(0, 64))),
    "AAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYbOL2g==",
  );

  const bottomRight = packBitmap(bitmapWithPixel(127, 127));
  assert.equal(
    bytesToBase64(makeChunk(31, bottomRight.slice(31 * 64))),
    "AB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAer5BdQ==",
  );
});

test("uses black as one and white as zero", () => {
  assert.ok(packBitmap(new Uint8Array(128 * 128)).every((byte) => byte === 0));
  assert.ok(packBitmap(new Uint8Array(128 * 128).fill(1)).every((byte) => byte === 0xff));
});

test("threshold and inversion produce deterministic logical pixels", () => {
  const imageData = {
    width: 2,
    height: 1,
    data: Uint8ClampedArray.from([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]),
  };
  assert.deepEqual([...ditherImageData(imageData, { mode: "threshold", threshold: 128 })], [1, 0]);
  assert.deepEqual([...ditherImageData(imageData, { mode: "threshold", threshold: 128, invert: true })], [0, 1]);
});

test("uses deterministic integer-grid glyphs for nametags and the empty state", () => {
  const nametag = makeNametagBitmap({ handle: "NINJA CAT", subtitle: "DC34 HUMAN" });
  const inverse = makeNametagBitmap({ handle: "NINJA CAT", subtitle: "DC34 HUMAN", inverse: true });
  const empty = makeNametagBitmap({
    header: "BADGE ART",
    handle: "ADD IMAGE",
    subtitle: "OR MAKE A NAMETAG",
  });

  assert.equal(nametag.length, 128 * 128);
  assert.deepEqual([...new Set(nametag)], [0, 1]);
  assert.ok(nametag.every((bit, index) => inverse[index] === 1 - bit));
  assert.equal(bitmapHash(nametag), "a05c97aec8bb8dba65300b44fc07ecdec3922b5284a48098e2699d38fe6bfc2c");
  assert.equal(bitmapHash(empty), "49fd69563e685c905054972c766e257f5046d8f382fe9b715136a3a87b8d0e1a");

  const emptyImageData = imageDataFromBitmap(empty);
  for (const mode of ["threshold", "bayer", "floyd-steinberg"]) {
    assert.deepEqual(ditherImageData(emptyImageData, { mode, threshold: 128 }), empty);
  }
});

test("fits a 32-character handle inside the 128-pixel nametag", () => {
  const bitmap = makeNametagBitmap({ handle: "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" });
  assert.equal(bitmap.length, 128 * 128);
  assert.ok(bitmap.reduce((sum, bit) => sum + bit, 0) > 500);
});
