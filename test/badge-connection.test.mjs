import assert from "node:assert/strict";
import test from "node:test";

import { BadgeConnection, badgeUsbFilters, detectBadgeSupport } from "../src/lib/badge-connection.js";

function makeConnection() {
  const connection = new BadgeConnection({ navigatorLike: {}, secureContext: true });
  connection.emit = () => {};
  return connection;
}

test("filters the chooser to the runtime badge and prefers Web Serial", () => {
  assert.deepEqual(badgeUsbFilters, [{ usbVendorId: 0x1d50, usbProductId: 0x6198 }]);
  assert.equal(detectBadgeSupport({ serial: {}, usb: {} }).kind, "native");
  assert.equal(detectBadgeSupport({ usb: {} }).kind, "polyfill");
  assert.equal(detectBadgeSupport({}, false).kind, "insecure");
});

test("does not accept an acknowledgement before the exact shell echo", async () => {
  const connection = makeConnection();
  const response = connection.waitForResponse("image clear", ["CLEAR"], 200, "image clear");
  let settled = false;
  response.finally(() => { settled = true; });

  connection.consumeLine("CLEAR");
  connection.consumeLine("[console] bio clear");
  connection.consumeLine("CLEAR");
  await Promise.resolve();
  assert.equal(settled, false);

  connection.consumeLine("[console] image clear");
  connection.consumeLine("INFO:unrelated log line");
  connection.consumeLine("CLEAR");
  const result = await response;
  assert.equal(result.response, "CLEAR");
  assert.deepEqual(result.lines, ["INFO:unrelated log line", "CLEAR"]);
});

test("the exact shell echo starts a fresh response deadline", async () => {
  const connection = makeConnection();
  const response = connection.waitForResponse("image clear", ["CLEAR"], 1_000, "image clear", 1_000);
  const echoTimer = connection.pending.timer;

  connection.consumeLine("[console] image clear");
  assert.notEqual(connection.pending.timer, echoTimer);
  connection.consumeLine("CLEAR");

  assert.equal((await response).response, "CLEAR");
});

test("does not accept a late final token for a non-final chunk", async () => {
  const command = `image ${"A".repeat(94)}==`;
  const connection = makeConnection();
  const response = connection.waitForResponse(command, ["OK"], 1_000, "image chunk 1");
  let settled = false;
  response.finally(() => { settled = true; });

  connection.consumeLine(`[console] ${command}`);
  connection.consumeLine("SUCCESS");
  await Promise.resolve();
  assert.equal(settled, false);

  connection.consumeLine("OK");
  assert.equal((await response).response, "OK");
});

test("serializes whole badge operations", async () => {
  const connection = makeConnection();
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = connection.runExclusive(async () => {
    order.push("first:start");
    await firstGate;
    order.push("first:end");
  });
  const second = connection.runExclusive(async () => {
    order.push("second:start");
    order.push("second:end");
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
});
