import { BadgeConnection } from "./lib/badge-connection.js";
import {
  bitmapToPngBlob,
  createCropState,
  ditherImageData,
  packBitmap,
  renderBitmap,
  renderCrop,
  renderNametag,
} from "./lib/image-pipeline.js";
import {
  BIO_BYTES,
  BIO_CHUNKS,
  IMAGE_CHUNKS,
  extractXousVersion,
  formatFrequency,
  parseFrequency,
  validateBioBinary,
} from "./lib/protocol.js";
import {
  clearBio,
  clearImage,
  queryXousVersion,
  receiveBioWord,
  sendBioWord,
  uploadBio,
  uploadImage,
} from "./lib/transfers.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  routeLinks: $$('[data-route]'),
  routePanels: $$('[data-panel]'),
  connectionButton: $("#connection-button"),
  connectionLabel: $("#connection-label"),
  appStatus: $("#app-status"),
  transportLabel: $("#transport-label"),
  usbIdentity: $("#usb-identity"),
  xousVersion: $("#xous-version"),
  technicalLog: $("#technical-log"),
  copyLog: $("#copy-log"),
  clearLog: $("#clear-log"),

  photoMode: $("#photo-mode-button"),
  nametagMode: $("#nametag-mode-button"),
  photoSource: $("#photo-source"),
  nametagSource: $("#nametag-source"),
  imageInput: $("#image-file"),
  cameraInput: $("#camera-file"),
  imageDropzone: $("#image-dropzone"),
  cropCard: $("#crop-card"),
  cropCanvas: $("#crop-canvas"),
  sourceFilename: $("#source-filename"),
  zoomControl: $("#zoom-control"),
  zoomOutput: $("#zoom-output"),
  rotateImage: $("#rotate-image"),
  resetCrop: $("#reset-crop"),
  nametagHandle: $("#nametag-handle"),
  nametagSubtitle: $("#nametag-subtitle"),
  nametagInverse: $("#nametag-inverse"),
  ditherMode: $("#dither-mode"),
  thresholdControl: $("#threshold-control"),
  thresholdOutput: $("#threshold-output"),
  contrastControl: $("#contrast-control"),
  contrastOutput: $("#contrast-output"),
  invertImage: $("#invert-image"),
  artPreview: $("#art-preview"),
  downloadArt: $("#download-art"),
  clearArt: $("#clear-art"),
  uploadArt: $("#upload-art"),
  artProgress: $("#art-progress"),
  artProgressLabel: $("#art-progress-label"),
  artProgressCount: $("#art-progress-count"),
  artProgressBar: $("#art-progress-bar"),

  bioInput: $("#bio-file"),
  bioDropzone: $("#bio-dropzone"),
  bioFilename: $("#bio-filename"),
  bioFilemeta: $("#bio-filemeta"),
  biosaoPreset: $("#biosao-preset"),
  saoPins: $$('input[name="sao-pin"]'),
  bioClock: $("#bio-clock"),
  clockPresets: $$('[data-clock]'),
  clockValidation: $("#clock-validation"),
  bioConfirm: $("#bio-confirm"),
  uploadBio: $("#upload-bio"),
  clearBio: $("#clear-bio"),
  bioProgress: $("#bio-progress"),
  bioProgressLabel: $("#bio-progress-label"),
  bioProgressCount: $("#bio-progress-count"),
  bioProgressBar: $("#bio-progress-bar"),
  fifoTxValue: $("#fifo-tx-value"),
  fifoTxButton: $("#fifo-tx-button"),
  fifoRxButton: $("#fifo-rx-button"),
  fifoRxValue: $("#fifo-rx-value"),
  fifoRxDecoded: $("#fifo-rx-decoded"),
};

const connection = new BadgeConnection();
const cropWorkCanvas = document.createElement("canvas");
const nametagCanvas = document.createElement("canvas");
const MAX_SOURCE_PIXELS = 80_000_000;
const MAX_SOURCE_EDGE = 4_096;
let artMode = "photo";
let imageSource = null;
let cropState = createCropState();
let currentBitmap = null;
let bioBinary = null;
let bioBusy = false;
let artBusy = false;
let badgeBusy = false;
let bioRunning = false;
let biosaoRecipe = false;
let statusTimer = null;
let renderQueued = false;
let lastArtProgress = { phase: "idle", current: 0, total: IMAGE_CHUNKS };
let lastBioProgress = { phase: "idle", current: 0, total: BIO_CHUNKS };

function setRoute(rawRoute) {
  const route = ["art", "bio", "about"].includes(rawRoute) ? rawRoute : "art";
  for (const panel of elements.routePanels) panel.hidden = panel.dataset.panel !== route;
  for (const link of elements.routeLinks) {
    if (link.dataset.route === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title = route === "bio"
    ? "BIO / SAO — 34B.NINJA"
    : route === "about"
      ? "About — 34B.NINJA"
      : "Hack Your DEF CON 34 Badge From Your Phone — 34B.NINJA";
}

function routeFromHash() {
  setRoute(location.hash.slice(1));
}

function showStatus(message, kind = "info", duration = 4_200) {
  clearTimeout(statusTimer);
  elements.appStatus.textContent = message;
  elements.appStatus.dataset.kind = kind;
  if (duration > 0) {
    statusTimer = setTimeout(() => {
      elements.appStatus.textContent = "";
      delete elements.appStatus.dataset.kind;
    }, duration);
  }
}

function humanError(error) {
  if (error?.name === "AbortError") return "Transfer cancelled.";
  if (error?.code === "cancelled") return "No device selected. Nothing changed.";
  if (error?.code === "timeout" && error.timeoutPhase === "response") {
    return `${error.message} The badge echoed the command but did not confirm it. Try again; copy the Technical Log if it repeats.`;
  }
  if (error?.code === "timeout" && error.timeoutPhase === "echo") {
    return `${error.message} The badge did not echo the command. Check USB data and runtime mode.`;
  }
  if (error?.code === "timeout") return `${error.message} Check USB data and runtime mode, then try again.`;
  return error?.message || "Badge communication failed.";
}

function redactLogLine(line) {
  return line
    .replace(/(\[console\]\s+)?image\s+[A-Za-z0-9+/=]{80,}/, "$1image <bitmap chunk>")
    .replace(/(\[console\]\s+)?bio\s+[A-Za-z0-9+/=]{80,}/, "$1bio <program chunk>");
}

function appendLog(line) {
  if (elements.technicalLog.textContent === "[34b] No badge traffic yet.") elements.technicalLog.textContent = "";
  elements.technicalLog.textContent += `${redactLogLine(line)}\n`;
  if (elements.technicalLog.textContent.length > 40_000) {
    elements.technicalLog.textContent = elements.technicalLog.textContent.slice(-24_000);
  }
  elements.technicalLog.scrollTop = elements.technicalLog.scrollHeight;
}

function updateConnectionUi(state = connection.connected ? "connected" : "disconnected", label) {
  elements.connectionButton.dataset.state = state;
  elements.connectionLabel.textContent = label || (connection.connected ? "Badge connected" : "Connect badge");
  elements.connectionButton.disabled = !connection.support.supported || badgeBusy;
  elements.transportLabel.textContent = connection.support.label;
  updateActionAvailability();
}

async function ensureConnected() {
  if (connection.connected) return connection.info;
  updateConnectionUi("busy", "Choose badge…");
  const info = await connection.connect();
  elements.usbIdentity.textContent = `${info.vendorLabel}:${info.productLabel} via ${info.backend}`;
  appendLog(`[34b] Connected ${info.vendorLabel}:${info.productLabel} using ${info.backend}.`);
  updateConnectionUi("connected", "Badge connected");
  try {
    const response = await queryXousVersion(connection);
    const version = extractXousVersion(response);
    if (version) elements.xousVersion.textContent = version;
  } catch (error) {
    appendLog(`[34b] Version query: ${humanError(error)}`);
  }
  return info;
}

async function toggleConnection() {
  if (badgeBusy) return;
  badgeBusy = true;
  updateConnectionUi("busy", connection.connected ? "Disconnecting…" : "Choose badge…");
  try {
    if (connection.connected) {
      await connection.disconnect();
      elements.usbIdentity.textContent = "Not connected";
      elements.xousVersion.textContent = "Not queried";
      showStatus("Badge disconnected.");
    } else {
      await ensureConnected();
      showStatus("Badge connected and ready.", "success");
    }
  } catch (error) {
    updateConnectionUi("disconnected", "Connect badge");
    showStatus(humanError(error), "error", 6_000);
  } finally {
    badgeBusy = false;
    updateConnectionUi(connection.connected ? "connected" : "disconnected");
  }
}

function artOptions() {
  return {
    mode: elements.ditherMode.value,
    threshold: Number(elements.thresholdControl.value),
    contrast: Number(elements.contrastControl.value),
    invert: elements.invertImage.checked,
  };
}

function artIsReady() {
  return artMode === "nametag" || Boolean(imageSource);
}

function renderArtNow() {
  renderQueued = false;
  if (artMode === "photo" && imageSource) {
    renderCrop(imageSource, cropWorkCanvas, cropState, 128);
    renderCrop(imageSource, elements.cropCanvas, cropState, 512);
  } else if (artMode === "nametag") {
    renderNametag(nametagCanvas, {
      handle: elements.nametagHandle.value,
      subtitle: elements.nametagSubtitle.value,
      inverse: elements.nametagInverse.checked,
    });
    cropWorkCanvas.width = 128;
    cropWorkCanvas.height = 128;
    cropWorkCanvas.getContext("2d", { alpha: false }).drawImage(nametagCanvas, 0, 0);
  } else {
    renderNametag(cropWorkCanvas, {
      header: "BADGE ART",
      handle: "ADD IMAGE",
      subtitle: "OR MAKE A NAMETAG",
    });
  }

  const imageData = cropWorkCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, 128, 128);
  currentBitmap = ditherImageData(imageData, artOptions());
  renderBitmap(elements.artPreview, currentBitmap);
  elements.zoomOutput.value = `${Math.round(cropState.zoom * 100)}%`;
  elements.zoomControl.value = String(Math.round(cropState.zoom * 100));
  elements.thresholdOutput.value = elements.thresholdControl.value;
  elements.contrastOutput.value = Number(elements.contrastControl.value) > 0
    ? `+${elements.contrastControl.value}`
    : elements.contrastControl.value;
  updateActionAvailability();
}

function scheduleArtRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(renderArtNow);
}

function setArtMode(mode) {
  artMode = mode;
  const photo = mode === "photo";
  elements.photoMode.setAttribute("aria-selected", String(photo));
  elements.nametagMode.setAttribute("aria-selected", String(!photo));
  elements.photoMode.tabIndex = photo ? 0 : -1;
  elements.nametagMode.tabIndex = photo ? -1 : 0;
  elements.photoSource.hidden = !photo;
  elements.nametagSource.hidden = photo;
  elements.ditherMode.value = photo ? "floyd-steinberg" : "threshold";
  scheduleArtRender();
}

async function decodeImageFile(file) {
  if (!file?.type?.startsWith("image/")) throw new TypeError("Choose a PNG, JPEG, GIF, WebP, or other browser-readable image.");
  if (file.size > 30 * 1024 * 1024) throw new RangeError("Choose an image smaller than 30 MB.");
  if (imageSource?.close) imageSource.close();

  let decoded;
  try {
    decoded = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      decoded = image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const width = decoded.width || decoded.naturalWidth;
  const height = decoded.height || decoded.naturalHeight;
  if (!width || !height || width * height > MAX_SOURCE_PIXELS) {
    decoded.close?.();
    throw new RangeError("That image is too large to process safely. Use an image under 80 megapixels.");
  }
  if (Math.max(width, height) > MAX_SOURCE_EDGE) {
    const scale = MAX_SOURCE_EDGE / Math.max(width, height);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    try {
      if (typeof createImageBitmap === "function") {
        imageSource = await createImageBitmap(decoded, {
          resizeWidth: targetWidth,
          resizeHeight: targetHeight,
          resizeQuality: "high",
        });
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        canvas.getContext("2d", { alpha: false }).drawImage(decoded, 0, 0, targetWidth, targetHeight);
        imageSource = canvas;
      }
    } finally {
      decoded.close?.();
    }
  } else {
    imageSource = decoded;
  }
  cropState = createCropState();
  elements.sourceFilename.textContent = file.name || "CAMERA IMAGE";
  elements.imageDropzone.hidden = true;
  elements.cropCard.hidden = false;
  setArtMode("photo");
  showStatus("Image loaded. Drag or pinch to frame it.", "success");
}

async function handleImageFile(file) {
  if (!file) return;
  try {
    await decodeImageFile(file);
  } catch (error) {
    showStatus(humanError(error), "error", 6_000);
  } finally {
    elements.imageInput.value = "";
    elements.cameraInput.value = "";
  }
}

function updateArtProgress(detail) {
  lastArtProgress = detail;
  elements.artProgress.hidden = false;
  elements.artProgress.dataset.phase = detail.phase;
  elements.artProgressLabel.textContent = detail.message;
  const confirmation = ["commit", "verify", "error"].includes(detail.phase) ? " confirmed" : "";
  elements.artProgressCount.textContent = `${detail.current} / ${detail.total || IMAGE_CHUNKS}${confirmation}`;
  elements.artProgressBar.max = detail.total || IMAGE_CHUNKS;
  elements.artProgressBar.value = detail.current;
}

async function handleArtUpload() {
  if (!artIsReady() || !currentBitmap || artBusy || badgeBusy) return;
  let transferStarted = false;
  badgeBusy = true;
  artBusy = true;
  updateConnectionUi("busy", connection.connected ? "Sending art…" : "Choose badge…");
  updateActionAvailability();
  try {
    await ensureConnected();
    const payload = packBitmap(currentBitmap);
    transferStarted = true;
    await uploadImage(connection, payload, { onProgress: updateArtProgress });
    showStatus("Image sent.", "success", 6_000);
  } catch (error) {
    if (transferStarted) {
      updateArtProgress({
        phase: "error",
        current: lastArtProgress.current,
        total: lastArtProgress.total || IMAGE_CHUNKS,
        message: ["commit", "verify"].includes(lastArtProgress.phase) && error?.code === "timeout"
          ? "Badge did not confirm image storage."
          : "Image transfer stopped.",
      });
    }
    showStatus(humanError(error), "error", 7_000);
  } finally {
    artBusy = false;
    badgeBusy = false;
    updateConnectionUi(connection.connected ? "connected" : "disconnected");
    updateActionAvailability();
  }
}

async function handleArtClear() {
  if (!connection.connected || artBusy || badgeBusy) return;
  badgeBusy = true;
  artBusy = true;
  updateConnectionUi("busy", "Clearing art…");
  try {
    await clearImage(connection);
    showStatus("Badge art cleared.", "success");
  } catch (error) {
    showStatus(humanError(error), "error", 6_000);
  } finally {
    artBusy = false;
    badgeBusy = false;
    updateConnectionUi(connection.connected ? "connected" : "disconnected");
  }
}

async function downloadArt() {
  if (!currentBitmap || !artIsReady()) return;
  const blob = await bitmapToPngBlob(currentBitmap);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artMode === "nametag" ? "34b-nametag.png" : "34b-badge-art.png";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function selectedSaoSlots() {
  return elements.saoPins.filter((input) => input.checked).map((input) => Number(input.value));
}

function validateBioUi() {
  let clockValid = true;
  try {
    const hz = parseFrequency(elements.bioClock.value);
    elements.clockValidation.textContent = `${formatFrequency(hz)} · within 25 kHz–350 MHz`;
    elements.clockValidation.classList.remove("is-error");
  } catch (error) {
    clockValid = false;
    elements.clockValidation.textContent = error.message;
    elements.clockValidation.classList.add("is-error");
  }
  const binaryError = validateBioBinary(bioBinary);
  elements.uploadBio.disabled = Boolean(binaryError)
    || !clockValid
    || !elements.bioConfirm.checked
    || bioBusy
    || badgeBusy
    || !connection.support.supported;
  return { clockValid, binaryError };
}

async function loadBioFile(file) {
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const error = validateBioBinary(bytes);
    if (error) throw new RangeError(error);
    bioBinary = bytes;
    elements.bioFilename.textContent = file.name;
    elements.bioFilemeta.textContent = `${bytes.length.toLocaleString()} bytes · ${Math.ceil(bytes.length / 64)} data chunks · padded to ${BIO_CHUNKS}`;
    showStatus("BIO binary loaded. Review pins and clock before running it.", "success");
  } catch (error) {
    bioBinary = null;
    elements.bioFilename.textContent = "Choose BIO binary";
    elements.bioFilemeta.textContent = humanError(error);
    showStatus(humanError(error), "error", 6_000);
  } finally {
    elements.bioInput.value = "";
    validateBioUi();
  }
}

function updateBioProgress(detail) {
  lastBioProgress = detail;
  elements.bioProgress.hidden = false;
  elements.bioProgress.dataset.phase = detail.phase;
  elements.bioProgressLabel.textContent = detail.message;
  const confirmation = ["commit", "verify", "error"].includes(detail.phase) ? " confirmed" : "";
  elements.bioProgressCount.textContent = `${detail.current} / ${detail.total || BIO_CHUNKS}${confirmation}`;
  elements.bioProgressBar.max = detail.total || BIO_CHUNKS;
  elements.bioProgressBar.value = detail.current;
}

async function handleBioUpload() {
  if (badgeBusy) return;
  const validity = validateBioUi();
  if (validity.binaryError || !validity.clockValid || bioBusy) return;
  let transferStarted = false;
  badgeBusy = true;
  bioBusy = true;
  updateConnectionUi("busy", connection.connected ? "Sending BIO…" : "Choose badge…");
  updateActionAvailability();
  try {
    await ensureConnected();
    const result = await uploadBio(connection, bioBinary, {
      slots: selectedSaoSlots(),
      clock: elements.bioClock.value,
    }, {
      onProgress: (detail) => {
        transferStarted = true;
        updateBioProgress(detail);
      },
    });
    bioRunning = true;
    appendLog(`[34b] BIO active: ${result.bytes}/${BIO_BYTES} bytes, pins ${result.pins.join(", ") || "none"}, ${result.clock} Hz.`);
    showStatus("BIO program running.", "success", 6_000);
  } catch (error) {
    bioRunning = false;
    if (transferStarted) {
      updateBioProgress({
        phase: "error",
        current: lastBioProgress.current,
        total: lastBioProgress.total || BIO_CHUNKS,
        message: ["commit", "verify"].includes(lastBioProgress.phase) && error?.code === "timeout"
          ? "Badge did not confirm BIO storage."
          : "BIO transfer stopped.",
      });
    }
    showStatus(humanError(error), "error", 8_000);
  } finally {
    bioBusy = false;
    badgeBusy = false;
    updateConnectionUi(connection.connected ? "connected" : "disconnected");
    updateActionAvailability();
  }
}

async function handleBioClear() {
  if (!connection.connected || bioBusy || badgeBusy) return;
  if (!window.confirm("Stop the BIO core and erase its stored program, pins, and clock configuration?")) return;
  badgeBusy = true;
  bioBusy = true;
  updateConnectionUi("busy", "Clearing BIO…");
  try {
    await clearBio(connection);
    bioRunning = false;
    elements.bioProgress.hidden = true;
    showStatus("BIO stopped and cleared.", "success");
  } catch (error) {
    showStatus(humanError(error), "error", 6_000);
  } finally {
    bioBusy = false;
    badgeBusy = false;
    updateConnectionUi(connection.connected ? "connected" : "disconnected");
  }
}

async function handleFifoTx() {
  if (!connection.connected || !bioRunning || bioBusy || badgeBusy) return;
  badgeBusy = true;
  updateConnectionUi("busy", "Sending FIFO word…");
  try {
    await sendBioWord(connection, elements.fifoTxValue.value);
    showStatus("FIFO3 word sent.", "success");
  } catch (error) {
    showStatus(humanError(error), "error", 6_000);
  } finally {
    badgeBusy = false;
    updateConnectionUi(connection.connected ? "connected" : "disconnected");
  }
}

async function handleFifoRx() {
  if (!connection.connected || !bioRunning || bioBusy || badgeBusy) return;
  badgeBusy = true;
  updateConnectionUi("busy", "Reading FIFO word…");
  try {
    const result = await receiveBioWord(connection);
    if (result.value === null) {
      elements.fifoRxValue.textContent = "NO DATA";
      elements.fifoRxDecoded.textContent = "No parseable FIFO3 sample was logged.";
      return;
    }
    elements.fifoRxValue.textContent = `0x${result.value.toString(16).toUpperCase().padStart(8, "0")}`;
    if (biosaoRecipe) {
      const touched = Boolean(result.value & 1);
      const average = (result.value >>> 16) & 0xffff;
      elements.fifoRxDecoded.textContent = `${touched ? "TOUCHED" : "idle"} · rise average ${average}`;
    } else {
      elements.fifoRxDecoded.textContent = `${result.value.toLocaleString()} unsigned`;
    }
  } catch (error) {
    showStatus(humanError(error), "error", 6_000);
  } finally {
    badgeBusy = false;
    updateConnectionUi(connection.connected ? "connected" : "disconnected");
  }
}

function updateActionAvailability() {
  const ready = artIsReady();
  elements.downloadArt.disabled = !ready || artBusy;
  elements.uploadArt.disabled = !ready || artBusy || badgeBusy || !connection.support.supported;
  elements.clearArt.disabled = !connection.connected || artBusy || badgeBusy;
  elements.uploadArt.querySelector("span:first-child").textContent = connection.connected ? "SEND TO BADGE" : "CONNECT + SEND";
  validateBioUi();
  elements.clearBio.disabled = !connection.connected || bioBusy || badgeBusy;
  elements.fifoTxButton.disabled = !connection.connected || !bioRunning || bioBusy || badgeBusy;
  elements.fifoRxButton.disabled = !connection.connected || !bioRunning || bioBusy || badgeBusy;
}

function installCropGestures() {
  const pointers = new Map();
  let gesture = null;

  function point(event) {
    const rect = elements.cropCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function resetGesture() {
    const values = [...pointers.values()];
    if (values.length === 1) {
      gesture = { kind: "pan", point: values[0], offsetX: cropState.offsetX, offsetY: cropState.offsetY };
    } else if (values.length >= 2) {
      const [a, b] = values;
      gesture = {
        kind: "pinch",
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        zoom: cropState.zoom,
        offsetX: cropState.offsetX,
        offsetY: cropState.offsetY,
      };
    } else {
      gesture = null;
    }
  }

  elements.cropCanvas.addEventListener("pointerdown", (event) => {
    elements.cropCanvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point(event));
    resetGesture();
  });

  elements.cropCanvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, point(event));
    const values = [...pointers.values()];
    const logicalScale = 128 / elements.cropCanvas.clientWidth;
    if (gesture.kind === "pan" && values.length === 1) {
      cropState.offsetX = gesture.offsetX + (values[0].x - gesture.point.x) * logicalScale;
      cropState.offsetY = gesture.offsetY + (values[0].y - gesture.point.y) * logicalScale;
    } else if (gesture.kind === "pinch" && values.length >= 2) {
      const [a, b] = values;
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      cropState.zoom = Math.max(1, Math.min(8, gesture.zoom * (distance / Math.max(1, gesture.distance))));
      cropState.offsetX = gesture.offsetX + (center.x - gesture.center.x) * logicalScale;
      cropState.offsetY = gesture.offsetY + (center.y - gesture.center.y) * logicalScale;
    }
    scheduleArtRender();
  });

  function release(event) {
    pointers.delete(event.pointerId);
    resetGesture();
  }
  elements.cropCanvas.addEventListener("pointerup", release);
  elements.cropCanvas.addEventListener("pointercancel", release);
  elements.cropCanvas.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 8 : 2;
    const movement = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (movement) {
      event.preventDefault();
      cropState.offsetX += movement[0];
      cropState.offsetY += movement[1];
      scheduleArtRender();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      cropState.zoom = Math.min(8, cropState.zoom + 0.1);
      scheduleArtRender();
    } else if (event.key === "-") {
      event.preventDefault();
      cropState.zoom = Math.max(1, cropState.zoom - 0.1);
      scheduleArtRender();
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      cropState.rotation = (cropState.rotation + 90) % 360;
      cropState.offsetX = 0;
      cropState.offsetY = 0;
      scheduleArtRender();
    }
  });
}

function installDropTargets() {
  for (const eventName of ["dragenter", "dragover"]) {
    elements.imageDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.imageDropzone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    elements.imageDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.imageDropzone.classList.remove("is-dragging");
    });
  }
  elements.imageDropzone.addEventListener("drop", (event) => handleImageFile(event.dataTransfer.files[0]));
  elements.bioDropzone.addEventListener("dragover", (event) => event.preventDefault());
  elements.bioDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    if (event.dataTransfer.files[0]) loadBioFile(event.dataTransfer.files[0]);
  });
  document.addEventListener("paste", (event) => {
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));
    if (file) handleImageFile(file);
  });
}

function installEvents() {
  window.addEventListener("hashchange", routeFromHash);
  elements.connectionButton.addEventListener("click", toggleConnection);
  elements.photoMode.addEventListener("click", () => setArtMode("photo"));
  elements.nametagMode.addEventListener("click", () => setArtMode("nametag"));
  for (const tab of [elements.photoMode, elements.nametagMode]) {
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const mode = event.key === "ArrowLeft" || event.key === "Home" ? "photo" : "nametag";
      setArtMode(mode);
      (mode === "photo" ? elements.photoMode : elements.nametagMode).focus();
    });
  }
  for (const label of $$('label[role="button"][for]')) {
    label.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      document.getElementById(label.htmlFor)?.click();
    });
  }
  elements.imageInput.addEventListener("change", () => handleImageFile(elements.imageInput.files[0]));
  elements.cameraInput.addEventListener("change", () => handleImageFile(elements.cameraInput.files[0]));
  elements.zoomControl.addEventListener("input", () => {
    cropState.zoom = Number(elements.zoomControl.value) / 100;
    scheduleArtRender();
  });
  elements.rotateImage.addEventListener("click", () => {
    cropState.rotation = (cropState.rotation + 90) % 360;
    cropState.offsetX = 0;
    cropState.offsetY = 0;
    scheduleArtRender();
  });
  elements.resetCrop.addEventListener("click", () => {
    cropState = createCropState();
    scheduleArtRender();
  });
  for (const input of [
    elements.nametagHandle,
    elements.nametagSubtitle,
    elements.nametagInverse,
    elements.ditherMode,
    elements.thresholdControl,
    elements.contrastControl,
    elements.invertImage,
  ]) {
    input.addEventListener("input", scheduleArtRender);
    input.addEventListener("change", scheduleArtRender);
  }
  elements.downloadArt.addEventListener("click", downloadArt);
  elements.uploadArt.addEventListener("click", handleArtUpload);
  elements.clearArt.addEventListener("click", handleArtClear);

  elements.bioInput.addEventListener("change", () => elements.bioInput.files[0] && loadBioFile(elements.bioInput.files[0]));
  elements.biosaoPreset.addEventListener("click", () => {
    elements.saoPins.forEach((input) => { input.checked = input.value === "1" || input.value === "3"; });
    elements.bioClock.value = "1 MHz";
    biosaoRecipe = true;
    validateBioUi();
    showStatus("Touch settings applied. Choose a compiled biosao.bin.");
  });
  elements.saoPins.forEach((input) => input.addEventListener("change", () => { biosaoRecipe = false; validateBioUi(); }));
  elements.bioClock.addEventListener("input", () => { biosaoRecipe = false; validateBioUi(); });
  elements.clockPresets.forEach((button) => button.addEventListener("click", () => {
    elements.bioClock.value = button.dataset.clock;
    biosaoRecipe = button.dataset.clock === "1 MHz" && elements.saoPins[0].checked && elements.saoPins[2].checked;
    validateBioUi();
  }));
  elements.bioConfirm.addEventListener("change", validateBioUi);
  elements.uploadBio.addEventListener("click", handleBioUpload);
  elements.clearBio.addEventListener("click", handleBioClear);
  elements.fifoTxButton.addEventListener("click", handleFifoTx);
  elements.fifoRxButton.addEventListener("click", handleFifoRx);

  elements.copyLog.addEventListener("click", async () => {
    await navigator.clipboard.writeText(elements.technicalLog.textContent);
    showStatus("Technical log copied.", "success");
  });
  elements.clearLog.addEventListener("click", () => { elements.technicalLog.textContent = "[34b] Log cleared.\n"; });

  connection.addEventListener("line", (event) => appendLog(event.detail.line));
  connection.addEventListener("retry", (event) => appendLog(`[34b] Retrying ${event.detail.label}, attempt ${event.detail.attempt}.`));
  connection.addEventListener("timeout", (event) => {
    const { label, timeoutPhase, elapsedMs } = event.detail;
    appendLog(`[34b] ${label} timed out during ${timeoutPhase} wait after ${elapsedMs} ms.`);
  });
  connection.addEventListener("state", (event) => {
    const { state, label } = event.detail;
    if (state === "connected") updateConnectionUi("connected", label);
    else if (state === "permission") updateConnectionUi("busy", label);
    else if (state === "error" || state === "disconnected") {
      bioRunning = false;
      updateConnectionUi("disconnected", "Connect badge");
      updateActionAvailability();
    }
  });

  installCropGestures();
  installDropTargets();
}

function initialize() {
  routeFromHash();
  elements.transportLabel.textContent = connection.support.label;
  if (!connection.support.supported) {
    elements.connectionButton.disabled = true;
    elements.connectionButton.dataset.state = "unsupported";
    elements.connectionLabel.textContent = connection.support.kind === "insecure" ? "HTTPS required" : "Unsupported browser";
  }
  installEvents();
  renderArtNow();
  validateBioUi();
  updateConnectionUi();
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        const urls = [
          "/",
          "/index.html",
          ...performance.getEntriesByType("resource").map((entry) => entry.name),
        ];
        registration.active?.postMessage({ type: "CACHE_URLS", urls });
      })
      .catch((error) => appendLog(`[34b] Offline cache unavailable: ${error.message}`));
  }
}

initialize();
