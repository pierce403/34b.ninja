import { serial as webUsbSerial } from "web-serial-polyfill";

import {
  BADGE_PRODUCT_ID,
  BADGE_VENDOR_ID,
  BAUD_RATE,
  formatUsbId,
  isAllowedCommand,
} from "./protocol.js";

const BADGE_FILTERS = [{ usbVendorId: BADGE_VENDOR_ID, usbProductId: BADGE_PRODUCT_ID }];

export class BadgeCommandError extends Error {
  constructor(message, { code = "command", command = "", lines = [] } = {}) {
    super(message);
    this.name = "BadgeCommandError";
    this.code = code;
    this.command = command;
    this.lines = lines;
  }
}

export function detectBadgeSupport(navigatorLike, secureContext = true) {
  if (!secureContext) {
    return { supported: false, kind: "insecure", label: "HTTPS required" };
  }
  if (navigatorLike?.serial) {
    return { supported: true, kind: "native", label: "Web Serial" };
  }
  if (navigatorLike?.usb) {
    return { supported: true, kind: "polyfill", label: "WebUSB CDC" };
  }
  return { supported: false, kind: "unsupported", label: "Browser unsupported" };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class BadgeConnection extends EventTarget {
  constructor({ navigatorLike = navigator, secureContext = window.isSecureContext } = {}) {
    super();
    this.navigator = navigatorLike;
    this.secureContext = secureContext;
    this.support = detectBadgeSupport(navigatorLike, secureContext);
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readTask = null;
    this.backend = null;
    this.info = null;
    this.pending = null;
    this.queue = Promise.resolve();
    this.operationQueue = Promise.resolve();
    this.decoder = new TextDecoder();
    this.lineTail = "";
    this.lastInputAt = 0;
    this.closing = false;
  }

  get connected() {
    return Boolean(this.port && this.writer && this.reader);
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async connect({ showAll = false } = {}) {
    if (this.connected) return this.info;
    if (!this.support.supported) {
      throw new BadgeCommandError(
        this.support.kind === "insecure"
          ? "Open 34b.ninja over HTTPS before connecting a badge."
          : "Use Chrome or Edge on desktop, or Chrome on Android.",
        { code: this.support.kind },
      );
    }

    this.emit("state", { state: "permission", label: "Choose your badge" });
    try {
      if (this.support.kind === "native") {
        this.backend = this.navigator.serial;
      } else {
        this.backend = webUsbSerial;
      }

      const options = showAll ? {} : { filters: BADGE_FILTERS };
      this.port = await this.backend.requestPort(options);
      const usb = this.port.getInfo?.() || {};
      await this.port.open({
        baudRate: BAUD_RATE,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });

      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.closing = false;
      this.lineTail = "";
      this.lastInputAt = Date.now();
      this.info = {
        backend: this.support.label,
        vendorId: usb.usbVendorId,
        productId: usb.usbProductId,
        vendorLabel: formatUsbId(usb.usbVendorId),
        productLabel: formatUsbId(usb.usbProductId),
      };
      this.readTask = this.readLoop();
      this.emit("state", { state: "connected", label: "Badge connected", info: this.info });
      await this.drainUntilQuiet();
      return this.info;
    } catch (error) {
      await this.disconnect({ quiet: true });
      if (error?.name === "NotFoundError") {
        throw new BadgeCommandError("No badge was selected.", { code: "cancelled" });
      }
      throw new BadgeCommandError(error?.message || "Could not open the badge.", { code: "connect" });
    }
  }

  async readLoop() {
    try {
      while (!this.closing && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        this.consumeText(this.decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (!this.closing) {
        this.failPending(new BadgeCommandError("The badge stopped responding.", { code: "disconnected" }));
        this.emit("state", { state: "error", label: "Badge disconnected", error });
      }
    } finally {
      try {
        this.reader?.releaseLock();
      } catch {
        // The stream may already have released its lock after a USB disconnect.
      }
      this.reader = null;
      if (!this.closing && this.port) {
        this.failPending(new BadgeCommandError("Badge disconnected.", { code: "disconnected" }));
        try {
          this.writer?.releaseLock();
        } catch {
          // The USB stack may already have torn down the writer.
        }
        this.writer = null;
        this.port = null;
        this.info = null;
        this.emit("state", { state: "disconnected", label: "No badge" });
      }
    }
  }

  consumeText(text) {
    this.lineTail += text;
    const lines = this.lineTail.split("\n");
    this.lineTail = lines.pop() || "";
    for (const rawLine of lines) {
      this.consumeLine(rawLine.replace(/\r$/, ""));
    }
  }

  consumeLine(rawLine) {
    const line = rawLine.trim();
    this.lastInputAt = Date.now();
    this.emit("line", { line: rawLine, normalized: line });
    if (!line) return;
    if (line.startsWith("[console]")) {
      if (this.pending && line === `[console] ${this.pending.command}`) {
        this.pending.echoSeen = true;
        this.pending.lines = [];
      }
      return;
    }
    if (!this.pending) return;
    // The stock shell echoes each command. Requiring that exact echo makes
    // buffered logs and stale one-word acknowledgements ineligible.
    if (!this.pending.echoSeen) return;

    this.pending.lines.push(line);
    if (line === "ERR" || line.startsWith("ERR ")) {
      const error = new BadgeCommandError(`Badge rejected ${this.pending.label}.`, {
        code: "rejected",
        command: this.pending.command,
        lines: [...this.pending.lines],
      });
      this.finishPending("reject", error);
      return;
    }

    const accepted = typeof this.pending.expect === "function"
      ? this.pending.expect(line, this.pending.lines)
      : this.pending.expect.includes(line);
    if (accepted) {
      this.finishPending("resolve", {
        response: line,
        lines: [...this.pending.lines],
      });
    }
  }

  finishPending(outcome, value) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending[outcome](value);
  }

  failPending(error) {
    if (this.pending) this.finishPending("reject", error);
  }

  waitForResponse(command, expect, timeout, label) {
    if (this.pending) throw new BadgeCommandError("Another badge command is already active.", { code: "busy" });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending) return;
        const lines = [...this.pending.lines];
        this.pending = null;
        reject(new BadgeCommandError(`Timed out waiting for ${label}.`, {
          code: "timeout",
          command,
          lines,
        }));
      }, timeout);
      this.pending = {
        command,
        expect: Array.isArray(expect) ? expect : expect,
        label,
        lines: [],
        echoSeen: false,
        timer,
        resolve,
        reject,
      };
    });
  }

  command(command, options = {}) {
    if (!isAllowedCommand(command)) {
      return Promise.reject(new BadgeCommandError("That command is outside the 34b.ninja safety allowlist.", {
        code: "blocked",
        command,
      }));
    }
    const operation = this.queue.catch(() => undefined).then(() => this.executeCommand(command, options));
    this.queue = operation;
    return operation;
  }

  runExclusive(operation) {
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("A badge operation must be a function."));
    }
    const task = this.operationQueue.catch(() => undefined).then(operation);
    this.operationQueue = task;
    return task;
  }

  async drainUntilQuiet({ quietMs = 500, maxWaitMs = 2_000 } = {}) {
    const startedAt = Date.now();
    while (this.connected && Date.now() - startedAt < maxWaitMs) {
      const quietFor = Date.now() - this.lastInputAt;
      if (quietFor >= quietMs) return;
      await wait(Math.min(50, quietMs - quietFor));
    }
  }

  async executeCommand(command, options) {
    const {
      expect = ["OK"],
      timeout = 4_000,
      retries = 0,
      retryDelay = 500,
      label = command.split(" ", 2).join(" "),
    } = options;
    if (!this.connected) throw new BadgeCommandError("Connect the badge first.", { code: "disconnected" });

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const response = this.waitForResponse(command, expect, timeout, label);
      try {
        await this.writer.write(new TextEncoder().encode(`${command}\n`));
        const result = await response;
        return { ...result, attempt };
      } catch (error) {
        this.failPending(error);
        await response.catch(() => undefined);
        lastError = error;
        if (error.code === "disconnected" || attempt >= retries) break;
        this.emit("retry", { command, label, attempt: attempt + 1, error });
        await wait(retryDelay);
      }
    }
    throw lastError;
  }

  async disconnect({ quiet = false } = {}) {
    if (!this.port && !this.reader && !this.writer) return;
    this.closing = true;
    this.failPending(new BadgeCommandError("Badge disconnected.", { code: "disconnected" }));
    try {
      await this.reader?.cancel();
      await this.readTask;
    } catch {
      // Physical disconnects commonly reject stream cancellation.
    }
    try {
      this.writer?.releaseLock();
    } catch {
      // Ignore already-released writer locks.
    }
    try {
      await this.port?.close();
    } catch {
      // The OS may already have closed the device.
    }
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readTask = null;
    this.info = null;
    this.pending = null;
    this.lineTail = "";
    this.closing = false;
    this.queue = Promise.resolve();
    if (!quiet) this.emit("state", { state: "disconnected", label: "No badge" });
  }
}

export const badgeUsbFilters = BADGE_FILTERS;
