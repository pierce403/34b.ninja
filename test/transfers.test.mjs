import assert from "node:assert/strict";
import test from "node:test";

import { uploadBio, uploadImage } from "../src/lib/transfers.js";

class FakeConnection {
  constructor(kind) {
    this.kind = kind;
    this.connected = true;
    this.commands = [];
    this.commandCalls = [];
    this.chunkCount = 0;
  }

  async command(command, options = {}) {
    this.commands.push(command);
    this.commandCalls.push({ command, options });
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

test("image transfer gives persistent storage its own final deadline", async () => {
  const connection = new FakeConnection("image");
  const progress = [];
  await uploadImage(connection, new Uint8Array(2048), {
    lineDelay: 0,
    onProgress: (detail) => progress.push(detail),
  });

  const chunks = connection.commandCalls.filter(({ command }) => command.startsWith("image ") && command !== "image clear");
  assert.deepEqual(chunks[0].options.expect, ["OK"]);
  assert.equal(chunks[0].options.timeout, 4_000);
  assert.deepEqual(chunks.at(-1).options.expect, ["SUCCESS", "OK"]);
  assert.equal(chunks.at(-1).options.timeout, 20_000);
  assert.equal(chunks.at(-1).options.echoTimeout, 4_000);
  assert.equal(chunks.at(-1).options.retries, 0);
  assert.deepEqual(progress.find(({ phase }) => phase === "commit"), {
    phase: "commit",
    current: 31,
    total: 32,
    message: "Saving image on the badge…",
  });
});

test("image transfer confirms a lost final acknowledgement without clearing", async () => {
  const connection = new FakeConnection("image");
  const progress = [];
  let initialFinalCommand;
  let recoveryWrites = 0;
  connection.command = async (command, options = {}) => {
    connection.commands.push(command);
    connection.commandCalls.push({ command, options });
    if (command === "image clear") return { response: "CLEAR", lines: ["CLEAR"] };
    if (!command.startsWith("image ")) throw new Error(`Unexpected command: ${command}`);

    connection.chunkCount += 1;
    if (connection.chunkCount < 32) return { response: "OK", lines: ["OK"] };
    if (connection.chunkCount === 32) {
      initialFinalCommand = command;
      throw Object.assign(new Error("Timed out waiting for image chunk 32."), { code: "timeout" });
    }
    if (connection.chunkCount === 33) return { response: "OK", lines: ["OK"] };
    recoveryWrites += 1;
    return {
      response: recoveryWrites === 31 ? "SUCCESS" : "OK",
      lines: [recoveryWrites === 31 ? "SUCCESS" : "OK"],
    };
  };

  await uploadImage(connection, new Uint8Array(2048), {
    lineDelay: 0,
    onProgress: (detail) => progress.push(detail),
  });

  const chunks = connection.commandCalls.filter(({ command }) => command.startsWith("image ") && command !== "image clear");
  assert.equal(connection.commands.filter((command) => command === "image clear").length, 1);
  assert.equal(chunks.length, 64);
  assert.equal(chunks[31].command, initialFinalCommand);
  assert.equal(chunks[32].command, chunks[0].command);
  assert.notEqual(chunks[32].command, initialFinalCommand);
  assert.deepEqual(chunks[32].options.expect, ["SUCCESS", "OK"]);
  assert.equal(chunks[32].options.timeout, 20_000);
  assert.equal(chunks[32].options.echoTimeout, 20_000);
  assert.equal(chunks[32].options.retries, 0);
  assert.deepEqual(progress.find(({ phase }) => phase === "verify"), {
    phase: "verify",
    current: 31,
    total: 32,
    message: "Confirming image storage…",
  });
  assert.equal(progress.at(-1).phase, "complete");
});

test("image transfer accepts SUCCESS during the confirmation sweep", async () => {
  const connection = new FakeConnection("image");
  let firstCommand;
  connection.command = async (command, options = {}) => {
    connection.commands.push(command);
    connection.commandCalls.push({ command, options });
    if (command === "image clear") return { response: "CLEAR", lines: ["CLEAR"] };
    connection.chunkCount += 1;
    if (connection.chunkCount === 1) firstCommand = command;
    if (connection.chunkCount < 32) return { response: "OK", lines: ["OK"] };
    if (connection.chunkCount === 32) {
      throw Object.assign(new Error("Timed out waiting for image chunk 32."), { code: "timeout" });
    }
    assert.equal(command, firstCommand);
    return { response: "SUCCESS", lines: ["SUCCESS"] };
  };

  await uploadImage(connection, new Uint8Array(2048), { lineDelay: 0 });
  const chunks = connection.commands.filter((command) => command.startsWith("image ") && command !== "image clear");
  assert.equal(connection.commands.filter((command) => command === "image clear").length, 1);
  assert.equal(chunks.length, 33);
  assert.equal(chunks.at(-1), chunks[0]);
});

test("an initial final OK starts confirmation without waiting for a timeout", async () => {
  const connection = new FakeConnection("image");
  const progress = [];
  let firstCommand;
  connection.command = async (command, options = {}) => {
    connection.commands.push(command);
    connection.commandCalls.push({ command, options });
    if (command === "image clear") return { response: "CLEAR", lines: ["CLEAR"] };
    connection.chunkCount += 1;
    if (connection.chunkCount === 1) firstCommand = command;
    if (connection.chunkCount < 32) return { response: "OK", lines: ["OK"] };
    if (connection.chunkCount === 32) return { response: "OK", lines: ["OK"] };
    assert.equal(command, firstCommand);
    return { response: "SUCCESS", lines: ["SUCCESS"] };
  };

  await uploadImage(connection, new Uint8Array(2048), {
    lineDelay: 0,
    onProgress: (detail) => progress.push(detail),
  });
  const chunks = connection.commandCalls.filter(({ command }) => command.startsWith("image ") && command !== "image clear");
  assert.equal(chunks.length, 33);
  assert.deepEqual(chunks[31].options.expect, ["SUCCESS", "OK"]);
  assert.equal(progress.some(({ phase }) => phase === "verify"), true);
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
  const chunkCalls = connection.commandCalls.filter(({ command }) => command.startsWith("bio ") && /^[A-Za-z0-9+/]{94}==$/.test(command.slice(4)));
  assert.deepEqual(chunkCalls[0].options.expect, ["OK"]);
  assert.deepEqual(chunkCalls.at(-1).options.expect, ["SUCCESS", "OK"]);
  assert.equal(chunkCalls.at(-1).options.timeout, 20_000);
  assert.equal(chunkCalls.at(-1).options.echoTimeout, 4_000);
  assert.equal(chunkCalls.at(-1).options.retries, 0);
});

test("failed image confirmation makes one clear-first restart", async () => {
  const connection = new FakeConnection("image");
  let clearCount = 0;
  let chunksThisAttempt = 0;
  let firstFinalCommand;
  let firstChunkCommand;
  connection.command = async (command, options = {}) => {
    connection.commands.push(command);
    connection.commandCalls.push({ command, options });
    if (command === "image clear") {
      clearCount += 1;
      chunksThisAttempt = 0;
      return { response: "CLEAR", lines: ["CLEAR"] };
    }
    if (command.startsWith("image ")) {
      chunksThisAttempt += 1;
      if (clearCount === 1 && chunksThisAttempt === 1) firstChunkCommand = command;
      if (clearCount === 1 && chunksThisAttempt === 32) {
        firstFinalCommand = command;
        throw Object.assign(new Error("Timed out waiting for final image chunk."), { code: "timeout" });
      }
      if (clearCount === 1 && chunksThisAttempt === 33) {
        assert.equal(command, firstChunkCommand);
        throw Object.assign(new Error("Timed out waiting for image confirmation."), { code: "timeout" });
      }
      if (clearCount === 2 && chunksThisAttempt === 32) {
        return { response: "SUCCESS", lines: ["SUCCESS"] };
      }
      return { response: "OK", lines: ["OK"] };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await uploadImage(connection, new Uint8Array(2048), { lineDelay: 0 });
  assert.equal(clearCount, 2);
  assert.equal(connection.commands.filter((command) => command === firstFinalCommand).length, 2);
  assert.equal(connection.commands.filter((command) => command.startsWith("image ") && command !== "image clear").length, 65);
  assert.equal(connection.commands.filter((command) => command.startsWith("image ")).length, 67);
});

test("BIO final acknowledgement recovery confirms and clears residual staging", async () => {
  const connection = new FakeConnection("bio");
  const progress = [];
  let recoveryWrites = 0;
  connection.command = async (command, options = {}) => {
    connection.commands.push(command);
    connection.commandCalls.push({ command, options });
    if (command === "bio clear") return { response: "CLEAR", lines: ["CLEAR"] };
    if (command === "bio ready" || command.startsWith("bio pin ") || command.startsWith("bio clk ")) {
      return { response: "OK", lines: ["OK"] };
    }
    if (command === "bio reload") return { response: "BIO load successful", lines: ["BIO load successful"] };
    if (!command.startsWith("bio ")) throw new Error(`Unexpected command: ${command}`);

    connection.chunkCount += 1;
    if (connection.chunkCount < 60) return { response: "OK", lines: ["OK"] };
    if (connection.chunkCount === 60) {
      throw Object.assign(new Error("Timed out waiting for BIO chunk 60."), { code: "timeout" });
    }
    if (connection.chunkCount === 61) return { response: "OK", lines: ["OK"] };
    recoveryWrites += 1;
    return {
      response: recoveryWrites === 59 ? "SUCCESS" : "OK",
      lines: [recoveryWrites === 59 ? "SUCCESS" : "OK"],
    };
  };

  await uploadBio(connection, Uint8Array.of(1, 2, 3, 4), {
    slots: [1, 3],
    clock: "1 MHz",
  }, {
    lineDelay: 0,
    onProgress: (detail) => progress.push(detail),
  });

  const chunks = connection.commandCalls.filter(({ command }) => command.startsWith("bio ") && /^[A-Za-z0-9+/]{94}==$/.test(command.slice(4)));
  assert.equal(connection.commands.filter((command) => command === "bio clear").length, 1);
  assert.equal(chunks.length, 120);
  assert.equal(chunks[60].command, chunks[0].command);
  assert.notEqual(chunks[59].command, chunks[60].command);
  assert.deepEqual(chunks[60].options.expect, ["SUCCESS", "OK"]);
  assert.equal(connection.commands.at(-1), "bio reload");
  assert.deepEqual(progress.find(({ phase }) => phase === "verify"), {
    phase: "verify",
    current: 59,
    total: 60,
    message: "Confirming BIO storage…",
  });
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
