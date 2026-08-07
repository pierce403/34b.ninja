# Acceptance evidence

This is the durable ledger behind checked criteria in `FEATURES.md`. Source inspection establishes what the current code says; it does not establish browser, OS, cable, or production-badge behavior.

## Automated gate

Most recent local run, 2026-08-07:

- `npm run check` passed: 21 Node tests, the Vite production build, and 7 Playwright tests in Chromium.
- The run used system Google Chrome through the repository's `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` override because the lockfile-pinned Playwright browser was not installed locally.
- `test/badge-connection.test.mjs` covers the runtime chooser filter, native transport preference, insecure-state detection, exact shell-echo response gate, and whole-operation serialization.
- `test/protocol.test.mjs` covers CRC32, canonical 70-byte chunk vectors, BIO zero-padding to 60 chunks, SAO mapping, clock bounds, representative allowlist acceptance/rejection, and constrained FIFO3 parsing.
- `test/image-pipeline.test.mjs` covers logical corner orientation, black/white polarity, pinned single-pixel Base64/CRC vectors, threshold conversion, inversion, deterministic 5×7 nametag glyphs, and the empty OLED state.
- `test/transfers.test.mjs` covers image clear plus 32 chunks and BIO clear/configure plus 60 chunks/reload, including the absence of `bio pad`, a full clear-and-restart after ambiguous image completion, and no retry after explicit firmware rejection.
- `test/repository.test.mjs` covers the two tool surfaces, PWA/custom-domain assets, deployment gate, and recurse.bot document split.
- `test/repository.test.mjs` also locks the static `web-serial-polyfill` import and rejects restoring the dynamic import inside the connection path.
- `test/e2e/art.spec.js` decodes the faithful badge JPEG, changes crop/zoom/rotation/dither state, validates a downloaded 128×128 PNG, uploads 32 CRC-valid frames, verifies chooser/open options, and confirms chunk payloads are redacted from the UI log. It also covers the no-file nametag flow, keyboard tab behavior, and a virtual cable loss followed by a fresh clear-first reconnect transfer.
- `test/e2e/bio.spec.js` uploads 65 bytes padded to 3,840, validates the clear/ready/pin/clock/60-frame/reload sequence, proves `bio pad` is absent, parses FIFO3 touch telemetry, and confirms disconnect disables FIFO controls.
- `test/e2e/navigation.spec.js` checks Art/BIO/About at 320, 390, 768, and 1280 CSS pixels, the photo-derived theme tokens and v2 hero asset, minimum mobile targets, concise headings, complete social metadata, the 1200×630 Open Graph PNG, and a WebUSB CDC device with polyfill-relevant descriptors, class requests, and bulk endpoints.
- `test/e2e/support/badge-mock.js` acts as the virtual stock console. It validates CRC32 and frame indices, emits CRLF, fragments exact shell echoes, injects stale acknowledgements and Xous logs, and models both native streams and WebUSB CDC.

The current automated suite does not validate the real Chrome chooser, OS serial/USB drivers, service-worker lifecycle, touch gestures, cables, electrical behavior, or production badge firmware. Those remain manual hardware checks below.

## Responsive browser pass

Headless Chromium 138.0.7204.0 rendered the current Vite app on 2026-08-06 at 320, 390, 640, 768, and 1280 CSS pixels. Both Art and BIO routes had matching viewport/scroll widths, no page or console errors, and no visible interactive target with an effective hit area below 44×44 CSS pixels. The pass also inspected the loaded crop state, BIO pin collapse, fixed mobile navigation, and the sticky/static action tray at the bottom of the document. The 640-pixel run is a reflow proxy for a 1280-pixel window at 200% zoom; it is not recorded as an actual browser-zoom result.

Visual evidence: [`notes/qa/mobile-layout-2026-08-06.png`](qa/mobile-layout-2026-08-06.png). The reusable state harness is `test/responsive-harness.html`.

The responsive hero replacement was rechecked after the faithful v2 photo and cyan/orange theme integration at 320, 390, 768, and 1280 CSS pixels. Each viewport loaded a decoded v2 image source, matched its viewport and scroll width, and produced no console or page errors. The 4:3 badge remained fully visible with the mobile navigation present. Visual evidence: [`notes/qa/hero-layout-2026-08-06.png`](qa/hero-layout-2026-08-06.png). A cross-route theme pass covering desktop Art, phone Art/BIO, and tablet About is in [`notes/qa/photo-theme-2026-08-06.png`](qa/photo-theme-2026-08-06.png).

The copy and typography pass removed outlined headings, replaced platform-font OLED text with deterministic 5×7 glyphs, made mobile actions non-sticky through 940 pixels, and added the versioned Open Graph card. Chromium screenshots cover 320-pixel Art, 390-pixel OLED and BIO views, 768-pixel About, and the 1200×630 social card: [`notes/qa/type-copy-og-2026-08-06.png`](qa/type-copy-og-2026-08-06.png).

## Source-inspection anchors

- Secure-context support detection, native-first selection, static activation-preserving WebUSB polyfill import, runtime VID/PID filter, experimental CDC fallback, 1,000,000-baud open options, one-command queue, exact response matching, and disconnect cleanup: `src/lib/badge-connection.js`.
- Exact command allowlist, payload constants, chunk constructor, clock/pin parsing, and FIFO3 log filter: `src/lib/protocol.js`.
- Timeouts, per-command retries, full restart policy, final-chunk handling, and 32/60-chunk flows: `src/lib/transfers.js`.
- 30 MiB/MIME gate, post-decode 80-megapixel rejection, and 4,096-pixel retained-source bound: `src/main.js` (`decodeImageFile`).
- Logical preview, dithering, pixel packing, and nametag rendering: `src/lib/image-pipeline.js`.

## Browser and hardware matrix

No production-badge result is recorded yet. Keep the corresponding `FEATURES.md` criteria unchecked.

| Check | Target | Status | Evidence |
| --- | --- | --- | --- |
| Native connection and image upload | Desktop Chromium + production badge | pending | — |
| Experimental CDC connection and image upload | Android Chromium + USB-C OTG + production badge | pending | Not run 2026-08-07: no physical Android phone, production badge, or cable was exposed to this execution environment, so phone model, Chrome/Android versions, cable, observed VID/PID, chooser contents, and connection result remain unavailable. |
| Image orientation fixture | Six logical corner pixels on OLED | pending | — |
| Touch crop/pinch | Physical Android phone | pending | — |
| BIO install/reload | Known-safe binary built from pinned source + production badge | pending | — |
| FIFO3 telemetry | Pinned `biosao` source, recorded binary hash, and SAO touch fixture | pending | — |
| Responsive layout | 320, 390, 768, 1280 CSS pixels | passed 2026-08-06 | [contact sheet](qa/mobile-layout-2026-08-06.png); Chromium measurements above |
| Responsive hero photo and theme | 320, 390, 768, 1280 CSS pixels | passed 2026-08-06 | [hero contact sheet](qa/hero-layout-2026-08-06.png), [cross-route theme](qa/photo-theme-2026-08-06.png); decoded v2 source, zero overflow/errors |
| Typography, concise copy, and social card | 320, 390, 768 CSS pixels; 1200×630 PNG | passed 2026-08-06 | [type/copy/OG contact sheet](qa/type-copy-og-2026-08-06.png); deterministic bitmap hashes and Playwright metadata checks |
| Zoom accessibility | Editor at 200% browser zoom | pending | — |
| Offline shell | Installed PWA after one online visit | pending | — |

For a completed manual row, record the date, browser and OS versions, viewport or device, badge Xous version, cable/adapter where relevant, expected versus observed result, and a repository-relative link to any screenshot or log artifact. Do not include secrets or raw BIO/image chunk payloads.
