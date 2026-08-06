import {
  BIO_BYTES,
  BIO_CHUNKS,
  CHUNK_DATA_BYTES,
  IMAGE_BYTES,
  IMAGE_CHUNKS,
  makeChunkCommand,
  mapSaoSlots,
  parseBioRxWord,
  parseFrequency,
  splitFixedChunks,
  validateBioBinary,
} from "./protocol.js";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException("Transfer cancelled.", "AbortError");
}

function report(callback, detail) {
  callback?.(detail);
}

function runExclusive(connection, operation) {
  return typeof connection.runExclusive === "function"
    ? connection.runExclusive(operation)
    : operation();
}

function isDeterministicFailure(error) {
  return error instanceof RangeError
    || error instanceof TypeError
    || ["blocked", "rejected", "disconnected", "cancelled"].includes(error?.code);
}

async function runRestartable(connection, operation, onProgress, maximumAttempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (
        !connection.connected
        || error?.name === "AbortError"
        || isDeterministicFailure(error)
        || attempt + 1 >= maximumAttempts
      ) break;
      report(onProgress, {
        phase: "restart",
        current: 0,
        total: 0,
        message: `Transfer interrupted (${error.message}). Clearing partial state and restarting safely…`,
      });
      await delay(500);
    }
  }
  throw lastError;
}

export async function queryXousVersion(connection) {
  return runExclusive(connection, async () => {
    const result = await connection.command("ver xous", {
      expect: (line) => /Xous version:/i.test(line),
      timeout: 3_000,
      retries: 1,
      label: "the Xous version",
    });
    return result.response;
  });
}

export async function uploadImage(connection, payload, options = {}) {
  const { onProgress, signal, lineDelay = 200 } = options;
  if (!(payload instanceof Uint8Array) || payload.length !== IMAGE_BYTES) {
    throw new RangeError(`Badge art payload must contain exactly ${IMAGE_BYTES} bytes.`);
  }
  const chunks = splitFixedChunks(payload, IMAGE_BYTES);

  return runExclusive(connection, () => runRestartable(connection, async () => {
    assertNotAborted(signal);
    report(onProgress, { phase: "clear", current: 0, total: IMAGE_CHUNKS, message: "Clearing an incomplete image transfer…" });
    await connection.command("image clear", {
      expect: ["CLEAR"],
      timeout: 4_000,
      retries: 2,
      label: "image clear",
    });

    for (let index = 0; index < chunks.length; index += 1) {
      assertNotAborted(signal);
      report(onProgress, {
        phase: "upload",
        current: index,
        total: IMAGE_CHUNKS,
        message: `Sending image chunk ${index + 1} of ${IMAGE_CHUNKS}…`,
      });
      const result = await connection.command(makeChunkCommand("image", index, chunks[index]), {
        expect: ["OK", "SUCCESS"],
        timeout: 4_000,
        retries: index === IMAGE_CHUNKS - 1 ? 0 : 4,
        label: `image chunk ${index + 1}`,
      });
      const final = index === IMAGE_CHUNKS - 1;
      if ((!final && result.response !== "OK") || (final && result.response !== "SUCCESS")) {
        throw new Error("Badge image state did not match this transfer.");
      }
      report(onProgress, {
        phase: "upload",
        current: index + 1,
        total: IMAGE_CHUNKS,
        message: final ? "Image stored on the badge." : `Sent image chunk ${index + 1} of ${IMAGE_CHUNKS}.`,
      });
      if (!final && lineDelay > 0) await delay(lineDelay);
    }
    report(onProgress, { phase: "complete", current: IMAGE_CHUNKS, total: IMAGE_CHUNKS, message: "Badge art uploaded." });
    return { chunks: IMAGE_CHUNKS, bytes: IMAGE_BYTES };
  }, onProgress));
}

export async function clearImage(connection) {
  return runExclusive(connection, () => connection.command("image clear", {
    expect: ["CLEAR"],
    timeout: 4_000,
    retries: 2,
    label: "image clear",
  }));
}

export async function uploadBio(connection, binary, configuration, options = {}) {
  const { onProgress, signal, lineDelay = 200 } = options;
  const validationError = validateBioBinary(binary);
  if (validationError) throw new RangeError(validationError);
  const pins = mapSaoSlots(configuration.slots || []);
  const clock = parseFrequency(configuration.clock);
  const chunks = splitFixedChunks(binary, BIO_BYTES);
  if (chunks.length !== BIO_CHUNKS || chunks.some((chunk) => chunk.length !== CHUNK_DATA_BYTES)) {
    throw new Error("BIO padding invariant failed.");
  }

  return runExclusive(connection, () => runRestartable(connection, async () => {
    assertNotAborted(signal);
    report(onProgress, { phase: "clear", current: 0, total: BIO_CHUNKS, message: "Stopping and clearing the previous BIO program…" });
    await connection.command("bio clear", {
      expect: ["CLEAR"],
      timeout: 3_000,
      retries: 2,
      label: "BIO clear",
    });
    await connection.command("bio ready", {
      expect: ["OK"],
      timeout: 3_000,
      retries: 2,
      label: "BIO ready",
    });

    if (pins.length > 0) {
      await connection.command(`bio pin ${pins.join(" ")}`, {
        expect: ["OK"],
        timeout: 3_000,
        retries: 2,
        label: "BIO pin configuration",
      });
    }
    await connection.command(`bio clk ${clock}`, {
      expect: ["OK"],
      timeout: 3_000,
      retries: 2,
      label: "BIO clock configuration",
    });

    for (let index = 0; index < chunks.length; index += 1) {
      assertNotAborted(signal);
      report(onProgress, {
        phase: "upload",
        current: index,
        total: BIO_CHUNKS,
        message: `Sending BIO chunk ${index + 1} of ${BIO_CHUNKS}…`,
      });
      const result = await connection.command(makeChunkCommand("bio", index, chunks[index]), {
        expect: ["OK", "SUCCESS"],
        timeout: 3_000,
        retries: index === BIO_CHUNKS - 1 ? 0 : 3,
        label: `BIO chunk ${index + 1}`,
      });
      const final = index === BIO_CHUNKS - 1;
      if ((!final && result.response !== "OK") || (final && result.response !== "SUCCESS")) {
        throw new Error("Badge BIO state did not match this transfer.");
      }
      report(onProgress, {
        phase: "upload",
        current: index + 1,
        total: BIO_CHUNKS,
        message: final ? "BIO program stored." : `Sent BIO chunk ${index + 1} of ${BIO_CHUNKS}.`,
      });
      if (!final && lineDelay > 0) await delay(lineDelay);
    }

    report(onProgress, { phase: "reload", current: BIO_CHUNKS, total: BIO_CHUNKS, message: "Starting the BIO program…" });
    await connection.command("bio reload", {
      expect: ["BIO load successful"],
      timeout: 5_000,
      retries: 1,
      label: "BIO reload",
    });
    report(onProgress, { phase: "complete", current: BIO_CHUNKS, total: BIO_CHUNKS, message: "BIO program is running." });
    return { chunks: BIO_CHUNKS, bytes: binary.length, paddedBytes: BIO_BYTES, pins, clock };
  }, onProgress));
}

export async function clearBio(connection) {
  return runExclusive(connection, () => connection.command("bio clear", {
    expect: ["CLEAR"],
    timeout: 3_000,
    retries: 2,
    label: "BIO clear",
  }));
}

export async function sendBioWord(connection, rawValue) {
  const value = /^0x[0-9a-f]+$/i.test(String(rawValue).trim())
    ? Number.parseInt(String(rawValue).trim().slice(2), 16)
    : Number(String(rawValue).trim());
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError("FIFO value must be an unsigned 32-bit decimal or hexadecimal number.");
  }
  return runExclusive(connection, () => connection.command(`bio tx 0x${value.toString(16)}`, {
    expect: ["OK"],
    timeout: 6_000,
    retries: 0,
    label: "FIFO transmit",
  }));
}

export async function receiveBioWord(connection) {
  return runExclusive(connection, async () => {
    const result = await connection.command("bio rx 1 1", {
      expect: ["OK"],
      timeout: 3_000,
      retries: 0,
      label: "FIFO receive",
    });
    const value = parseBioRxWord(result.lines);
    return { ...result, value };
  });
}
