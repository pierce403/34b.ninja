import assert from "node:assert/strict";
import test from "node:test";

import {
  BIO_BYTES,
  BIO_CHUNKS,
  bytesToBase64,
  crc32,
  isAllowedCommand,
  makeChunk,
  makeChunkCommand,
  mapSaoSlots,
  parseBioRxWord,
  parseFrequency,
  splitFixedChunks,
  validateBioBinary,
} from "../src/lib/protocol.js";

test("matches the standard CRC32 check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("matches official chunk framing vectors", () => {
  const zeros = new Uint8Array(64);
  const black = new Uint8Array(64).fill(0xff);
  const ascending = Uint8Array.from({ length: 64 }, (_, index) => index);

  assert.equal(
    bytesToBase64(makeChunk(0, zeros)),
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHH7G5Q==",
  );
  assert.equal(
    bytesToBase64(makeChunk(0, black)),
    "AAD/////////////////////////////////////////////////////////////////////////////////////ZpIiaQ==",
  );
  assert.equal(
    bytesToBase64(makeChunk(0, ascending)),
    "AAAAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/ef1rXw==",
  );
  assert.equal(
    bytesToBase64(makeChunk(59, zeros)),
    "ADsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPu2wTw==",
  );
});

test("pads BIO programs to exactly 60 chunks", () => {
  const binary = Uint8Array.of(1, 2, 3, 4);
  const chunks = splitFixedChunks(binary, BIO_BYTES);
  assert.equal(chunks.length, BIO_CHUNKS);
  assert.deepEqual([...chunks[0].slice(0, 6)], [1, 2, 3, 4, 0, 0]);
  assert.ok(chunks[59].every((byte) => byte === 0));
  assert.match(validateBioBinary(new Uint8Array(0)), /cannot be empty/);
  assert.equal(validateBioBinary(new Uint8Array(1)), null);
  assert.equal(validateBioBinary(new Uint8Array(BIO_BYTES - 1)), null);
  assert.equal(validateBioBinary(new Uint8Array(BIO_BYTES)), null);
  assert.match(validateBioBinary(new Uint8Array(BIO_BYTES + 1)), /limit is 3,840/);
});

test("maps SAO slots and validates official frequency syntax", () => {
  assert.deepEqual(mapSaoSlots([4, 1, 1, 3]), [21, 30, 31]);
  assert.equal(parseFrequency("1 MHz"), 1_000_000);
  assert.equal(parseFrequency("48khz"), 48_000);
  assert.equal(parseFrequency("350000000"), 350_000_000);
  assert.throws(() => parseFrequency("24 kHz"), /between 25 kHz/);
  assert.throws(() => parseFrequency("351 MHz"), /between 25 kHz/);
});

test("allows only the narrow browser command surface", () => {
  const chunk = makeChunkCommand("image", 0, new Uint8Array(64));
  assert.equal(isAllowedCommand(chunk), true);
  assert.equal(isAllowedCommand("ver xous"), true);
  assert.equal(isAllowedCommand("image clear"), true);
  assert.equal(isAllowedCommand("bio pin 21 30"), true);
  assert.equal(isAllowedCommand("bio clk 1000000"), true);
  assert.equal(isAllowedCommand("bio tx 0xdeadbeef"), true);
  assert.equal(isAllowedCommand("bio rx 1 1"), true);
  assert.equal(isAllowedCommand("bio pad"), false);
  assert.equal(isAllowedCommand("test k0 AAAAAA=="), false);
  assert.equal(isAllowedCommand("test jig"), false);
  assert.equal(isAllowedCommand("uf2 AAAA"), false);
  assert.equal(isAllowedCommand("bio tx 0x100000000"), false);
});

test("extracts a FIFO3 value only from BIO log lines", () => {
  const lines = [
    "DBG_Core2: deadbeef",
    "INFO:dc34_console::cmds::bio: 12340001 (bio.rs:508)",
    "OK",
  ];
  assert.equal(parseBioRxWord(lines), 0x12340001);
  assert.equal(parseBioRxWord(["INFO:another::module: 12340001", "OK"]), null);
});
