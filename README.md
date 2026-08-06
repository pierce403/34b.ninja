# 34b.ninja

A private-by-design, mobile-first browser workbench for the DEF CON 34 Baochip badge.

The site currently provides:

- **Badge Art** — crop, pan, zoom, dither, preview, download, and send an exact 128×128 one-bit image to the badge;
- **Nametag maker** — generate badge-sized handle cards without another graphics app;
- **BIO / SAO Lab** — safely configure SAO pins and clock, upload a BIO binary, and use constrained FIFO controls; and
- **Web Serial + WebUSB transport** — native Web Serial on desktop Chromium and an experimental WebUSB CDC fallback on Android.

All image processing and USB traffic stay in the browser. There is no backend, analytics, account, or cloud upload.

The original command-line image workflow is the Python [`dc34-image`](https://github.com/bunnie/dc34-image) uploader. 34b.ninja reproduces its bitmap packing and chunk framing in the browser, while adding crop, scale, dithering, and nametag tools.

Android WebUSB CDC is implemented but not yet verified on a production badge. Treat it as experimental until the open hardware checks in [`notes/acceptance.md`](notes/acceptance.md) are complete.

## Develop

Requires Node.js 22.12 or newer.

```sh
npm install
npx playwright install chromium
npm run dev
```

Open `http://127.0.0.1:4173/`. Localhost is a secure context for browser hardware APIs.

## Verify

```sh
npm run check
```

The unit tests contain protocol vectors reproduced from the official Python uploaders. Playwright then runs the production build against stateful Web Serial and WebUSB CDC badge emulators, including real browser image decoding, crop/download behavior, 32- and 60-chunk transfers, FIFO3, and the mobile routes. Hardware-dependent behavior still requires a production badge. Current automated, browser, and hardware evidence is recorded in [`notes/acceptance.md`](notes/acceptance.md).

Image files must report an `image/*` media type, be no larger than 30 MiB, and decode below 80 megapixels. Sources longer than 4,096 pixels on either edge are downscaled before editing. The browser still has to decode once to inspect dimensions, so a maliciously compressed image can cause a temporary memory spike.

## Project map

- `src/lib/image-pipeline.js` — crop rendering, monochrome conversion, packing, and PNG preview.
- `src/lib/protocol.js` — CRC32, chunks, command validation, and BIO configuration.
- `src/lib/badge-connection.js` — native Web Serial and WebUSB CDC transport.
- `src/lib/transfers.js` — guarded image and BIO transfer state machines.
- `test/e2e/` — Playwright flows and the stateful serial/WebUSB badge emulator.
- `playwright.config.js` — phone/desktop browser test configuration.
- `FEATURES.md` — living behavior and acceptance specification.
- `AGENTS.md` — contributor and coding-agent guidance.
- `SKILLS.md` and `skills/` — reusable project procedures.
- `MEMORY.md` and `notes/` — durable protocol decisions and research pointers.

## Primary references

- [DEF CON 34 badge help](https://defcon.org/34b/)
- [Vault application](https://github.com/bunnie/dc34-vault)
- [Badge console](https://github.com/bunnie/dc34-console)
- [Official image uploader](https://github.com/bunnie/dc34-image)
- [Official BIO uploader](https://github.com/bunnie/dc34-bio)
- [Baochip-1x documentation](https://github.com/baochip/baochip-1x)

Exact inspected commits and canonical source links are pinned in [`notes/protocol.md`](notes/protocol.md).

## License

MIT. This is an unofficial community project and is not affiliated with DEF CON or Baochip.
