# 34b.ninja Memory

Keep this index compact. Durable details live in `notes/`; session chatter does not.

## Notes

- [`notes/protocol.md`](notes/protocol.md) — pinned upstream behavior, wire formats, USB identifiers, and hardware-validation gaps.
- [`notes/acceptance.md`](notes/acceptance.md) — current automated evidence and the browser/hardware verification ledger.

## Current decisions

- Badge Art is the primary mobile flow; BIO / SAO Lab is explicitly advanced.
- The hero uses a rotated, minimally cropped, metadata-stripped derivative of the contributor's real badge photo. Do not replace it with reconstructed hardware imagery.
- The visual palette follows that photo: warm near-black surfaces, cyan LED accents, burnt-orange badge-edge accents, and warm ivory text.
- Display headings use solid type. OLED labels use a deterministic 5×7 bitmap font; do not dither platform-font glyphs.
- Social cards use the real badge photo and a versioned image URL to avoid stale preview caches.
- “Upload” means writing app data through the stock console, not flashing main firmware.
- Desktop uses Web Serial. Android uses WebUSB as the CDC serial transport even when Chrome 148+ also exposes native Web Serial; the native Android chooser excluded this composite badge in a field report.
- Android WebUSB CDC remains experimental until it is exercised with a production badge; source compatibility is not hardware evidence.
- Production badge testing is required before USB features are called stable.
- Playwright's serial and WebUSB firmware doubles are release gates for browser logic, framing, and UI state; they are not evidence about Chrome choosers, OS drivers, cables, or production hardware.
- Command echo detection has a short deadline; final image and BIO persistence get a separate 20-second response deadline after the exact echo. Do not infer final-write latency from ordinary chunk RTTs.
- A connected final timeout or final `OK` is reconciled without clearing: replay chunks zero through final until firmware returns `SUCCESS`. Do not treat `OK` alone as proof of commit, and stop immediately after `SUCCESS` because firmware clears staging.
- Image files are capped at 30 MiB and rejected above 80 megapixels; retained editor sources are downscaled to a 4,096-pixel longest edge. The initial browser decode still occurs before the dimension check, so compressed size alone is not a memory bound.
- No backend, accounts, telemetry, arbitrary terminal, firmware updater, or FIDO vendor commands.
