---
name: maintain-badge-protocol
description: Safely implement or review 34b.ninja badge transport, image packing and upload, BIO/SAO configuration, FIFO controls, or hardware-facing browser behavior. Use for any change that sends bytes or commands to the DEF CON 34 badge.
---

# Maintain badge protocol

1. Read `notes/protocol.md`, `notes/acceptance.md`, and the affected `FEATURES.md` entry.
2. Inspect the current implementation and tests before proposing a change:
   - transport and line parser: `src/lib/badge-connection.js`
   - command grammar and framing: `src/lib/protocol.js`
   - retry and transaction policy: `src/lib/transfers.js`
   - image conversion and packing: `src/lib/image-pipeline.js`
   - executable evidence: `test/*.test.mjs`
3. Check the pinned upstream implementation, not only README, docstring, or help text. Use the full-SHA links in `notes/protocol.md`:
   - image: `dc34-image/dc34_image/send_image.py` and `dc34-console/src/cmds/image.rs`
   - BIO: `dc34-bio/dc34_bio/dc34_bio.py` and `dc34-console/src/cmds/bio.rs`
   - USB identity/composition: Xous `services/usb-bao1x/src/hw.rs`
4. Preserve runtime VID:PID `1d50:6198` and one queued command at a time. Native Web Serial is preferred. The experimental WebUSB path uses `web-serial-polyfill` 1.0.15 to select CDC class `0x02`, claim control `0x02` and data `0x0a` interfaces, set 1,000,000-baud 8-N-1 line coding, assert DTR, and use the CDC data endpoints. Do not claim HID interfaces.
5. Keep the command surface exactly as narrow as the grammar table in `notes/protocol.md`: version query; image clear/chunks; BIO ready, clear, reload, pin, clock, chunks, one-word FIFO3 TX, and one-sample FIFO3 RX. Reject `bio pad`, `test`, UF2/firmware, FIDO vendor, malformed chunk arguments, and arbitrary console input.
6. Parse exact, state-specific acknowledgements. The exact `[console] <command>` echo arms the response matcher; ignore blank lines, mismatched echoes, and acknowledgements that arrive before that echo. Retain unrelated Xous lines only as telemetry. `ERR` and `ERR ...` reject the pending command.
7. Preserve the timeout and retry matrix in `notes/protocol.md`. The short echo deadline ends when the exact shell echo arrives; response timing starts fresh from that echo. Retrying a non-final indexed chunk is safe because firmware overwrites duplicate indices. Never retry a final chunk in place: a lost `SUCCESS` is ambiguous because firmware commits and clears its staging buffer. A connected, non-aborted, non-deterministic failure may make one full clear-and-restart attempt; validation, allowlist, explicit firmware rejection, cancellation, and disconnect failures must not restart.
8. For images, keep the user preview logical and unmirrored. Test payload orientation and pinned CRC/Base64 vectors. Inputs are MIME-gated, capped at 30 MiB, rejected above 80 megapixels, and retained at a 4,096-pixel longest edge. The initial decode still happens before the dimension check; do not describe the compressed-file cap as a decoded-memory bound.
9. Clear before image transfer and send exactly 32 chunks. Require `OK` for chunks 0–30 and `SUCCESS` for chunk 31.
10. For BIO, disclose replacement, clear first, validate pins and clock locally, zero-pad to `0xF00` (3,840) bytes, send all 60 chunks, and reload. Firmware's `BIO_MEM_BYTES` and `NUM_CHUNKS` supersede the uploader's stale 4,096-byte/64-chunk prose. Never send `bio pad`.
11. Run `npm run check`. Record automated output, source-inspection anchors, browser results, and production-badge runs in `notes/acceptance.md`; leave claims unchecked when that evidence does not exist.
