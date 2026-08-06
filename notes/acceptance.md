# Acceptance evidence

This is the durable ledger behind checked criteria in `FEATURES.md`. Source inspection establishes what the current code says; it does not establish browser, OS, cable, or production-badge behavior.

## Automated gate

Most recent local run, 2026-08-06:

- `npm run check` passed: 19 Node tests and the Vite production build.
- `test/badge-connection.test.mjs` covers the runtime chooser filter, native transport preference, insecure-state detection, exact shell-echo response gate, and whole-operation serialization.
- `test/protocol.test.mjs` covers CRC32, canonical 70-byte chunk vectors, BIO zero-padding to 60 chunks, SAO mapping, clock bounds, representative allowlist acceptance/rejection, and constrained FIFO3 parsing.
- `test/image-pipeline.test.mjs` covers logical corner orientation, black/white polarity, pinned single-pixel Base64/CRC vectors, threshold conversion, and inversion.
- `test/transfers.test.mjs` covers image clear plus 32 chunks and BIO clear/configure plus 60 chunks/reload, including the absence of `bio pad`, a full clear-and-restart after ambiguous image completion, and no retry after explicit firmware rejection.
- `test/repository.test.mjs` covers the two tool surfaces, PWA/custom-domain assets, deployment gate, and recurse.bot document split.

The current automated suite does not emulate browser serial streams, Web Serial permission flow, WebUSB descriptors/control transfers, browser image decoding, service-worker lifecycle, touch gestures, or badge firmware.

## Source-inspection anchors

- Secure-context support detection, native-first selection, runtime VID/PID filter, experimental CDC fallback, 1,000,000-baud open options, one-command queue, exact response matching, and disconnect cleanup: `src/lib/badge-connection.js`.
- Exact command allowlist, payload constants, chunk constructor, clock/pin parsing, and FIFO3 log filter: `src/lib/protocol.js`.
- Timeouts, per-command retries, full restart policy, final-chunk handling, and 32/60-chunk flows: `src/lib/transfers.js`.
- 30 MiB/MIME gate, post-decode 80-megapixel rejection, and 4,096-pixel retained-source bound: `src/main.js` (`decodeImageFile`).
- Logical preview, dithering, pixel packing, and nametag rendering: `src/lib/image-pipeline.js`.

## Browser and hardware matrix

No production-badge result is recorded yet. Keep the corresponding `FEATURES.md` criteria unchecked.

| Check | Target | Status | Evidence |
| --- | --- | --- | --- |
| Native connection and image upload | Desktop Chromium + production badge | pending | — |
| Experimental CDC connection and image upload | Android Chromium + USB-C OTG + production badge | pending | — |
| Image orientation fixture | Six logical corner pixels on OLED | pending | — |
| Touch crop/pinch | Physical Android phone | pending | — |
| BIO install/reload | Known-safe binary built from pinned source + production badge | pending | — |
| FIFO3 telemetry | Pinned `biosao` source, recorded binary hash, and SAO touch fixture | pending | — |
| Responsive layout | 320, 390, 768, 1280 CSS pixels | pending | — |
| Zoom accessibility | Editor at 200% browser zoom | pending | — |
| Offline shell | Installed PWA after one online visit | pending | — |

For a completed manual row, record the date, browser and OS versions, viewport or device, badge Xous version, cable/adapter where relevant, expected versus observed result, and a repository-relative link to any screenshot or log artifact. Do not include secrets or raw BIO/image chunk payloads.
