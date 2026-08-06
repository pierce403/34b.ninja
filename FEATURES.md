# 34b.ninja — Features

This living specification follows [features.md](https://features.md/). Agents must read affected entries before changing behavior and update acceptance evidence in the same contribution. Evidence for checked criteria and the outstanding browser/hardware matrix lives in [`notes/acceptance.md`](notes/acceptance.md).

## Badge connection

- **Stability**: in-progress
- **Description**: Connect a production DEF CON 34 badge from a secure Chromium browser without a local helper application.
- **Properties**:
  - Native Web Serial is preferred when available.
  - Android Chromium can fall back to an experimental, unverified WebUSB-backed CDC serial implementation.
  - The device chooser is filtered to runtime VID:PID `1d50:6198`.
  - The port opens at 1,000,000 baud, 8-N-1, without flow control.
  - The WebUSB fallback filters for the CDC control class, claims the CDC control and data interfaces, applies line coding, and asserts DTR through class control transfers before using bulk endpoints.
  - Whole badge operations and their commands are serialized. A command response is eligible only after the shell emits its exact `[console] <command>` echo; unrelated Xous logs are not acknowledgements.
  - Disconnects cancel transfers and never silently resume partial state.
- **Dependencies**: `src/lib/badge-connection.js`, `src/lib/protocol.js`
- **Test Criteria**:
  - [x] Source inspection confirms the secure-context gate, desktop-first selection, runtime VID/PID filter, and CDC fallback construction.
  - [x] Unit tests verify the runtime filter, native preference, command/operation serialization, exact-echo response gate, and representative allowed and blocked command forms.
  - [x] Playwright emulates native Web Serial and the polyfill-relevant WebUSB CDC descriptors, including chooser filters, 1 Mbps 8-N-1 open options, claimed interfaces, line coding, DTR, bulk endpoints, fragmented echoes, and interleaved logs.
  - [x] Playwright removes the virtual cable during an image frame, verifies the interrupted transfer stops, reconnects with a fresh port, and requires a new clear-first transfer from chunk zero.
  - [ ] Automated tests exhaustively cover the support matrix, USB filter, and every allowlist boundary.
  - [ ] Native Web Serial connects to a production badge on desktop Chromium.
  - [ ] WebUSB CDC connects to a production badge on Android Chromium.

## Badge Art editor and uploader

- **Stability**: in-progress
- **Description**: Turn a local image or generated nametag into the badge's exact OLED bitmap and transfer it safely.
- **Properties**:
  - Users can choose, drop, paste, or photograph an image.
  - Inputs must have an `image/*` media type, be at most 30 MiB, and decode below 80 megapixels. Sources are retained at no more than a 4,096-pixel longest edge; the initial decode can still cause a temporary memory spike.
  - The square editor supports cover scaling, pan, touch pinch zoom, reset, and 90-degree rotation.
  - Conversion supports threshold, Floyd–Steinberg, and Bayer dithering plus contrast and inversion.
  - The preview is an unmirrored 128×128 one-bit representation of the displayed result.
  - Packing matches the official uploader's horizontal flip, word order, bit polarity, and big-endian serialization.
  - Upload begins with `image clear`, then sends 32 indexed, CRC-protected chunks with retry and progress.
  - A generated nametag can be edited and sent without an external image tool.
- **Dependencies**: `src/lib/image-pipeline.js`, `src/lib/transfers.js`, `src/main.js`
- **Test Criteria**:
  - [x] Orientation and packing assertions cover all four image corners.
  - [x] CRC and Base64 output match official all-white, all-black, and single-pixel vectors.
  - [x] The preview can be downloaded locally as a 128×128 PNG.
  - [x] Playwright decodes the faithful hero JPEG as a user upload, exercises keyboard crop/zoom/rotate and dithering controls, downloads the result, and sends 32 valid ordered frames through the serial emulator.
  - [ ] A production badge accepts an uploaded image and displays the same orientation as the preview.
  - [ ] Touch crop and pinch zoom are verified on a physical Android phone.

## BIO / SAO Lab

- **Stability**: in-progress
- **Description**: Configure and upload BIO coprocessor programs without exposing the badge's unrestricted debug shell.
- **Properties**:
  - Accept only non-empty binaries up to 3,840 bytes.
  - Map SAO slots 1–4 to physical pins 21, 22, 30, and 31.
  - Enforce clock values from 25 kHz through 350 MHz.
  - Disclose that replacement stops, clears, persists, and runs BIO code.
  - Clear prior code and partial state, send all 60 locally padded chunks, then reload.
  - Firmware's `0xF00` receiver buffer is authoritative: 3,840 bytes and 60 chunks supersede stale 4,096-byte/64-chunk prose in the Python uploader.
  - Never send `bio pad` and never expose arbitrary console commands.
  - Provide constrained single-value FIFO3 TX and single-sample RX controls.
- **Dependencies**: `src/lib/protocol.js`, `src/lib/transfers.js`, `src/main.js`
- **Test Criteria**:
  - [x] Unit tests cover pin mapping, frequency parsing, 3,840-byte limit, and BIO chunk vectors.
  - [x] The command allowlist rejects factory, firmware, and arbitrary shell commands.
  - [x] The upload state machine sends 60 chunks and does not contain `bio pad`.
  - [x] Playwright sends a locally padded binary through 60 CRC-valid frames, reloads it, and verifies constrained FIFO3 TX/RX against interleaved log traffic.
  - [ ] A production badge accepts, reloads, and runs a known-safe BIO binary.
  - [ ] FIFO telemetry is verified against the `biosao` touch sample.

## Mobile, privacy, and offline shell

- **Stability**: in-progress
- **Description**: Keep both tools fast, legible, and private on phones as well as desktops.
- **Properties**:
  - The complete image pipeline runs locally with no backend or analytics.
  - Navigation and transfer actions remain reachable with one hand and respect device safe areas.
  - Controls meet minimum touch-target and contrast requirements.
  - Empty-state and nametag OLED copy uses deterministic integer-grid glyphs rather than platform fonts.
  - Social metadata uses a versioned 1200×630 PNG rendered from the real badge photo.
  - A service worker caches the app shell after the first successful load.
  - Reduced-motion users receive no decorative animation.
- **Dependencies**: `src/styles.css`, `public/manifest.webmanifest`, `public/sw.js`
- **Test Criteria**:
  - [x] Production build contains the manifest, service worker, CNAME, and icon.
  - [x] Screenshots at 320, 390, 768, and 1280 CSS pixels have no horizontal overflow or obscured controls.
  - [x] Playwright exercises Art, BIO, and About routing plus mobile navigation and 44-pixel targets at 320, 390, 768, and 1280 CSS pixels.
  - [x] Unit tests lock the empty-state and nametag bitmaps; Playwright verifies concise page copy and complete Open Graph metadata.
  - [ ] Core editor UI remains usable at 200% browser zoom.
  - [ ] Installed PWA loads the editor offline after one online visit.

## Deployment and project guidance

- **Stability**: stable
- **Description**: Keep the repository understandable, testable, and automatically deployable.
- **Properties**:
  - `AGENTS.md`, `FEATURES.md`, `MEMORY.md`, `SKILLS.md`, and project skills use the recurse.bot pattern without copying its persona.
  - GitHub Pages deployment builds only after tests pass.
  - The custom domain remains `34b.ninja`.
- **Dependencies**: repository documentation, `.github/workflows/deploy.yml`
- **Test Criteria**:
  - [x] Project guidance has distinct overview, instructions, feature-specification, memory, and procedure roles.
  - [x] `npm run check` is the documented local release gate.
  - [x] The release gate runs Node protocol tests, a Vite production build, and Playwright browser/transport emulation before Pages deployment.
  - [x] Deployment is configured for GitHub Pages and preserves `CNAME`.
