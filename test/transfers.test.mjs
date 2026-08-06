import assert from "node:assert/strict";
import test from "node:test";

import { uploadBio, uploadImage } from "../src/lib/transfers.js";

class FakeConnection {
  constructor(kind) {
    this.kind = kind;
    this.connected = true;
    this.commands = [];
    this.chunkCount = 0;
  }

  async command(command) {
    this.commands.push(command);
    if (command.endsWith(" clear")) return { response: "CLEAR", lines: ["CLEAR"] };
    if (command === "bio ready" || command.startsWith("bio pin ") || command.startsWith("bio clk ")) {
      return { response: "OK", lines: ["OK"] };
    }
    if (command === "bio reload") return { response: "BIO load successful", lines: ["BIO load successful"] };
    if (command.startsWith(`${this.kind} `)) {
      this.chunkCount += 1;
      const finalCount = this.kind === "image" ? 32 : 60;
      return { response: this.chunkCount === finalCount ? "SUCCESS" : "OK", lines: [] };
    }
    throw new Error(`Unexpected command: ${command}`);
  }
}

test("image transfer clears and sends exactly 32 chunks", async () => {
  const connection = new FakeConnection("image");
  const progress = [];
  await uploadImage(connection, new Uint8Array(2048), {
    lineDelay: 0,
    onProgress: (detail) => progress.push(detail),
  });
  assert.equal(connection.commands[0], "image clear");
  assert.equal(connection.chunkCount, 32);
  assert.equal(connection.commands.length, 33);
  assert.equal(progress.at(-1).phase, "complete");
});

test("BIO transfer clears, configures, sends all 60 chunks, and never pads", async () => {
  const connection = new FakeConnection("bio");
  await uploadBio(connection, Uint8Array.of(1, 2, 3, 4), {
    slots: [1, 3],
    clock: "1 MHz",
  }, { lineDelay: 0 });
  assert.deepEqual(connection.commands.slice(0, 4), [
    "bio clear",
    "bio ready",
    "bio pin 21 30",
    "bio clk 1000000",
  ]);
  assert.equal(connection.chunkCount, 60);
  assert.equal(connection.commands.at(-1), "bio reload");
  assert.equal(connection.commands.includes("bio pad"), false);
});

test("ambiguous image completion clears and restarts the whole transfer", async () => {
  const connection = new FakeConnection("image");
  let clearCount = 0;
  let chunksThisAttempt = 0;
  let finalChunkWrites = 0;
  connection.command = async (command) => {
    connection.commands.push(command);
    if (command === "image clear") {
      clearCount += 1;
      chunksThisAttempt = 0;
      return { response: "CLEAR", lines: ["CLEAR"] };
    }
    if (command.startsWith("image ")) {
      chunksThisAttempt += 1;
      if (chunksThisAttempt === 32) {
        finalChunkWrites += 1;
        if (clearCount === 1) throw Object.assign(new Error("Timed out waiting for final image chunk."), { code: "timeout" });
        return { response: "SUCCESS", lines: ["SUCCESS"] };
      }
      return { response: "OK", lines: ["OK"] };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await uploadImage(connection, new Uint8Array(2048), { lineDelay: 0 });
  assert.equal(clearCount, 2);
  assert.equal(finalChunkWrites, 2);
  assert.equal(connection.commands.filter((command) => command.startsWith("image ")).length, 66);
});

test("an explicit badge rejection is not repeated", async () => {
  const connection = new FakeConnection("image");
  let clearCount = 0;
  connection.command = async (command) => {
    connection.commands.push(command);
    if (command === "image clear") {
      clearCount += 1;
      return { response: "CLEAR", lines: ["CLEAR"] };
    }
    throw Object.assign(new Error("Badge rejected image chunk 1."), { code: "rejected" });
  };

  await assert.rejects(
    uploadImage(connection, new Uint8Array(2048), { lineDelay: 0 }),
    /Badge rejected image chunk 1/,
  );
  assert.equal(clearCount, 1);
});
