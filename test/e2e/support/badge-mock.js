export async function installBadgeMock(page, { transport = "serial", fault = null } = {}) {
  await page.addInitScript(({ selectedTransport, selectedFault }) => {
    const BADGE_VENDOR_ID = 0x1d50;
    const BADGE_PRODUCT_ID = 0x6198;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const state = {
      transport: selectedTransport,
      requestPortOptions: null,
      requestDeviceOptions: null,
      openOptions: [],
      commands: [],
      imageFrames: [],
      bioFrames: [],
      staleAckInjected: false,
      fault: selectedFault,
      faultTriggered: false,
      openCount: 0,
      closeCount: 0,
      cancelCount: 0,
      claimedInterfaces: [],
      controlTransfers: [],
      transferInEndpoints: [],
      transferOutEndpoints: [],
      usbInterfaces: [],
      bioRunning: false,
    };
    globalThis.__badgeMock = state;

    const crcTable = new Uint32Array(256);
    for (let i = 0; i < crcTable.length; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[i] = value >>> 0;
    }

    function crc32(bytes) {
      let crc = 0xffffffff;
      for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    }

    function decodeFrame(payload) {
      try {
        const binary = atob(payload);
        if (binary.length !== 70) return null;
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const view = new DataView(bytes.buffer);
        if (view.getUint32(66, false) !== crc32(bytes.subarray(0, 66))) return null;
        return {
          index: view.getUint16(0, false),
          prefix: [...bytes.subarray(2, 8)],
          suffix: [...bytes.subarray(60, 66)],
        };
      } catch {
        return null;
      }
    }

    let nativeController;
    const usbPackets = [];
    const usbWaiters = [];

    function pushUsbPacket(bytes) {
      const waiter = usbWaiters.shift();
      if (waiter) waiter(bytes);
      else usbPackets.push(bytes);
    }

    function deliver(bytes) {
      if (selectedTransport === "serial") nativeController.enqueue(bytes);
      else pushUsbPacket(bytes);
    }

    function sendText(text, fragment = false) {
      const bytes = encoder.encode(text);
      if (!fragment || bytes.length < 8) {
        deliver(bytes);
        return;
      }
      const split = Math.min(7, bytes.length - 1);
      deliver(bytes.slice(0, split));
      deliver(bytes.slice(split));
    }

    function sendLines(lines) {
      for (const line of lines) sendText(`${line}\r\n`);
    }

    const imageSeen = new Set();
    const bioSeen = new Set();

    function reply(command) {
      state.commands.push(command);
      if (!state.staleAckInjected) {
        state.staleAckInjected = true;
        sendLines(["OK", "INFO:mock: stale acknowledgement before exact echo"]);
      }
      sendText(`[console] ${command}\r\n`, true);

      if (command === "ver xous") {
        sendLines(["DBG_Core0: mock boot chatter", "Xous version: mock-34b"]);
        return;
      }
      if (command === "image clear") {
        imageSeen.clear();
        sendLines(["INFO:mock: image staging cleared", "CLEAR"]);
        return;
      }
      if (command.startsWith("image ")) {
        const frame = decodeFrame(command.slice(6));
        if (!frame || frame.index > 31) {
          sendLines(["ERR bad image frame"]);
          return;
        }
        imageSeen.add(frame.index);
        state.imageFrames.push(frame);
        if (state.fault === "disconnect-on-first-image" && !state.faultTriggered && selectedTransport === "serial") {
          state.faultTriggered = true;
          state.fault = null;
          nativeController.error(new Error("Mock cable removed"));
          return;
        }
        if (frame.index % 8 === 0) sendLines([`INFO:mock: image frame ${frame.index}`]);
        sendLines([imageSeen.size === 32 ? "SUCCESS" : "OK"]);
        return;
      }
      if (command === "bio clear") {
        bioSeen.clear();
        state.bioRunning = false;
        sendLines(["INFO:mock: BIO state cleared", "CLEAR"]);
        return;
      }
      if (command === "bio ready" || /^bio pin (?:21|22|30|31)(?: (?:21|22|30|31))*$/.test(command) || /^bio clk \d+$/.test(command)) {
        sendLines(["OK"]);
        return;
      }
      if (command === "bio reload") {
        if (bioSeen.size !== 60) sendLines(["ERR incomplete BIO image"]);
        else {
          state.bioRunning = true;
          sendLines(["BIO load successful"]);
        }
        return;
      }
      if (command === "bio rx 1 1") {
        sendLines([
          "INFO:another::module: cafebabe",
          "INFO:dc34_console::cmds::bio: 12340001 (bio.rs:508)",
          "OK",
        ]);
        return;
      }
      if (/^bio tx 0x[0-9a-f]+$/i.test(command)) {
        sendLines(["OK"]);
        return;
      }
      if (command.startsWith("bio ")) {
        const frame = decodeFrame(command.slice(4));
        if (!frame || frame.index > 59) {
          sendLines(["ERR bad BIO frame"]);
          return;
        }
        bioSeen.add(frame.index);
        state.bioFrames.push(frame);
        if (frame.index % 15 === 0) sendLines([`DBG_Core2: BIO frame ${frame.index}`]);
        sendLines([bioSeen.size === 60 ? "SUCCESS" : "OK"]);
        return;
      }
      sendLines(["ERR command outside mock firmware"]);
    }

    let writeTail = "";
    function consumeWrite(chunk) {
      writeTail += decoder.decode(chunk, { stream: true });
      const lines = writeTail.split("\n");
      writeTail = lines.pop() || "";
      for (const line of lines) {
        const command = line.replace(/\r$/, "").trim();
        if (command) reply(command);
      }
    }

    class NativeMockPort {
      constructor() {
        this.readable = new ReadableStream({
          start(controller) { nativeController = controller; },
          cancel() { state.cancelCount += 1; },
        });
        this.writable = new WritableStream({ write: consumeWrite });
      }

      getInfo() {
        return { usbVendorId: BADGE_VENDOR_ID, usbProductId: BADGE_PRODUCT_ID };
      }

      async open(options) {
        state.openCount += 1;
        state.openOptions.push({ ...options });
      }

      async close() {
        state.closeCount += 1;
      }
    }

    const nativeSerial = {
      async requestPort(options) {
        state.requestPortOptions = JSON.parse(JSON.stringify(options));
        return new NativeMockPort();
      },
    };

    function interfaceDescriptor(interfaceNumber, interfaceClass, interfaceSubclass, interfaceProtocol, endpoints = []) {
      return {
        interfaceNumber,
        alternates: [{ alternateSetting: 0, interfaceClass, interfaceSubclass, interfaceProtocol, endpoints }],
      };
    }

    class WebUsbMockDevice {
      constructor() {
        this.vendorId = BADGE_VENDOR_ID;
        this.productId = BADGE_PRODUCT_ID;
        this.opened = false;
        this.configuration = null;
        this.configurations = [{
          configurationValue: 1,
          interfaces: [
            interfaceDescriptor(0, 3, 0, 0, [{ endpointNumber: 1, direction: "in", type: "interrupt", packetSize: 64 }]),
            interfaceDescriptor(1, 3, 0, 0, [{ endpointNumber: 2, direction: "in", type: "interrupt", packetSize: 64 }]),
            interfaceDescriptor(2, 2, 2, 1, [{ endpointNumber: 2, direction: "in", type: "interrupt", packetSize: 16 }]),
            interfaceDescriptor(3, 10, 0, 0, [
              { endpointNumber: 3, direction: "out", type: "bulk", packetSize: 512 },
              { endpointNumber: 3, direction: "in", type: "bulk", packetSize: 512 },
            ]),
          ],
        }];
        state.usbInterfaces = this.configurations[0].interfaces.map((item) => {
          const alternate = item.alternates[0];
          return {
            interfaceNumber: item.interfaceNumber,
            interfaceClass: alternate.interfaceClass,
            interfaceSubclass: alternate.interfaceSubclass,
            interfaceProtocol: alternate.interfaceProtocol,
          };
        });
      }

      async open() {
        this.opened = true;
        state.openCount += 1;
      }

      async selectConfiguration(value) {
        this.configuration = this.configurations.find((item) => item.configurationValue === value);
      }

      async claimInterface(interfaceNumber) {
        state.claimedInterfaces.push(interfaceNumber);
      }

      async controlTransferOut(setup, data) {
        let dataBytes = [];
        if (data) {
          const view = data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          dataBytes = [...view];
        }
        state.controlTransfers.push({ setup: { ...setup }, data: dataBytes });
        return { status: "ok", bytesWritten: data?.byteLength || 0 };
      }

      async transferOut(endpointNumber, data) {
        state.transferOutEndpoints.push(endpointNumber);
        const view = data instanceof Uint8Array
          ? data
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        consumeWrite(view);
        return { status: "ok", bytesWritten: view.byteLength };
      }

      async transferIn(endpointNumber) {
        state.transferInEndpoints.push(endpointNumber);
        const bytes = usbPackets.length > 0
          ? usbPackets.shift()
          : await new Promise((resolve) => usbWaiters.push(resolve));
        return { status: "ok", data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
      }

      async close() {
        this.opened = false;
        state.closeCount += 1;
        while (usbWaiters.length > 0) usbWaiters.shift()(new Uint8Array());
      }
    }

    const webUsb = {
      async requestDevice(options) {
        state.requestDeviceOptions = JSON.parse(JSON.stringify(options));
        return new WebUsbMockDevice();
      },
      async getDevices() { return []; },
    };

    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: selectedTransport === "serial" ? nativeSerial : undefined,
    });
    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: selectedTransport === "usb" ? webUsb : undefined,
    });
  }, { selectedTransport: transport, selectedFault: fault });
}
