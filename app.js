const BAUD_RATE = 1_000_000;
const VERSION_COMMAND = "ver xous\n";

export function formatUsbId(value) {
  return Number.isInteger(value)
    ? `0x${value.toString(16).toUpperCase().padStart(4, "0")}`
    : "Not reported";
}

export function extractXousVersion(text) {
  const match = text.match(/Xous version:\s*([^\r\n]+)/i);
  return match ? match[1].trim() : null;
}

export function browserCanUseBadge(serialApi, secureContext) {
  return Boolean(serialApi && secureContext);
}

function init() {
  const elements = {
    connect: document.querySelector("#connect-button"),
    disconnect: document.querySelector("#disconnect-button"),
    query: document.querySelector("#query-button"),
    browserNote: document.querySelector("#browser-note"),
    connectionState: document.querySelector("#connection-state"),
    connectionLabel: document.querySelector("#connection-label"),
    vendorId: document.querySelector("#vendor-id"),
    productId: document.querySelector("#product-id"),
    xousVersion: document.querySelector("#xous-version"),
    terminal: document.querySelector("#terminal"),
  };

  let port = null;
  let reader = null;
  let readTask = null;
  let receivedText = "";
  let disconnecting = false;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const supported = browserCanUseBadge(navigator.serial, window.isSecureContext);
  if (!supported) {
    elements.connect.disabled = true;
    elements.browserNote.classList.add("is-error");
    elements.browserNote.textContent = window.isSecureContext
      ? "Web Serial is unavailable here. Open this page in desktop Chrome, Edge, or another Chromium browser."
      : "A secure HTTPS connection is required before the browser can access USB serial devices.";
    setState("UNSUPPORTED", "error");
    appendTerminal("[34b] Web Serial is not available in this browser.\n", "muted");
  }

  elements.connect.addEventListener("click", connect);
  elements.disconnect.addEventListener("click", () => disconnect("Disconnected by operator."));
  elements.query.addEventListener("click", queryVersion);

  navigator.serial?.addEventListener("disconnect", (event) => {
    if (port && event.target === port) {
      disconnect("Badge unplugged.", { alreadyClosed: true });
    }
  });

  function setState(label, kind = "idle") {
    elements.connectionLabel.textContent = label;
    elements.connectionState.classList.toggle("is-connected", kind === "connected");
    elements.connectionState.classList.toggle("is-error", kind === "error");
  }

  function appendTerminal(text, kind = "output") {
    if (elements.terminal.querySelector(".terminal-muted")) {
      elements.terminal.textContent = "";
    }

    const span = document.createElement("span");
    if (kind === "command") span.className = "terminal-command";
    if (kind === "muted") span.className = "terminal-muted";
    span.textContent = text;
    elements.terminal.append(span);
    elements.terminal.scrollTop = elements.terminal.scrollHeight;
  }

  async function connect() {
    elements.connect.disabled = true;
    setState("AWAITING PERMISSION");
    appendTerminal("[34b] Choose the DEF CON badge serial port in the browser prompt.\n", "muted");

    try {
      port = await navigator.serial.requestPort();
      const info = port.getInfo();
      elements.vendorId.textContent = formatUsbId(info.usbVendorId);
      elements.productId.textContent = formatUsbId(info.usbProductId);

      await port.open({ baudRate: BAUD_RATE });
      disconnecting = false;
      elements.disconnect.disabled = false;
      elements.query.disabled = false;
      setState("BADGE ONLINE", "connected");
      appendTerminal(`[34b] Port opened at ${BAUD_RATE.toLocaleString()} baud.\n`);

      reader = port.readable.getReader();
      readTask = readLoop();
      await queryVersion();
    } catch (error) {
      port = null;
      elements.connect.disabled = false;
      elements.disconnect.disabled = true;
      elements.query.disabled = true;

      if (error.name === "NotFoundError") {
        setState("STANDING BY");
        appendTerminal("[34b] No port selected. Nothing changed.\n", "muted");
      } else {
        setState("LINK ERROR", "error");
        appendTerminal(`[34b] Could not open the badge: ${error.message}\n`, "muted");
      }
    }
  }

  async function readLoop() {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        const text = decoder.decode(value, { stream: true });
        receivedText += text;
        appendTerminal(text);

        const version = extractXousVersion(receivedText);
        if (version) elements.xousVersion.textContent = version;

        if (receivedText.length > 24_000) {
          receivedText = receivedText.slice(-12_000);
        }
      }
    } catch (error) {
      if (!disconnecting) {
        setState("READ ERROR", "error");
        appendTerminal(`[34b] Serial read stopped: ${error.message}\n`, "muted");
      }
    } finally {
      reader?.releaseLock();
      reader = null;
    }
  }

  async function queryVersion() {
    if (!port?.writable) return;

    const writer = port.writable.getWriter();
    try {
      appendTerminal(`> ${VERSION_COMMAND}`, "command");
      await writer.write(encoder.encode(VERSION_COMMAND));
    } catch (error) {
      setState("WRITE ERROR", "error");
      appendTerminal(`[34b] Version query failed: ${error.message}\n`, "muted");
    } finally {
      writer.releaseLock();
    }
  }

  async function disconnect(message, options = {}) {
    if (!port || disconnecting) return;

    disconnecting = true;
    elements.disconnect.disabled = true;
    elements.query.disabled = true;

    try {
      if (reader) await reader.cancel();
      if (readTask) await readTask;
      if (!options.alreadyClosed) await port.close();
    } catch (error) {
      appendTerminal(`[34b] Close notice: ${error.message}\n`, "muted");
    } finally {
      port = null;
      readTask = null;
      disconnecting = false;
      receivedText = "";
      elements.connect.disabled = !supported;
      elements.vendorId.textContent = "—";
      elements.productId.textContent = "—";
      elements.xousVersion.textContent = "Connect to query";
      setState("STANDING BY");
      appendTerminal(`[34b] ${message}\n`, "muted");
    }
  }
}

if (typeof document !== "undefined") init();
