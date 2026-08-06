# Agent Guidelines for 34b.ninja

## Scope

These instructions apply to the entire repository.

## Responsibilities

- Maintain a polished, mobile-first browser workbench for the DEF CON 34 badge.
- Keep badge operations local, understandable, and narrowly allowlisted.
- Preserve exact compatibility with the pinned upstream image and BIO protocols.
- Keep `README.md`, `FEATURES.md`, `MEMORY.md`, and `SKILLS.md` aligned with behavior.
- Treat a real production badge as the final authority for USB behavior.

## Before changing behavior

- Read the affected entries in `FEATURES.md`; parse `Stability` before implementation.
- Inspect the current implementation and its tests before relying on prose: transport lives in `src/lib/badge-connection.js`, framing and validation in `src/lib/protocol.js`, transfer policy in `src/lib/transfers.js`, and image conversion in `src/lib/image-pipeline.js`.
- For image, serial, or BIO work, open `skills/maintain-badge-protocol/SKILL.md` and the relevant reference file.
- Check `MEMORY.md` for open hardware-validation questions.
- Do not generalize the serial console into an arbitrary command shell.

## Product constraints

- Mobile is a first-class target: verify 320, 390, 768, and 1280 CSS-pixel layouts.
- Use at least 44×44 CSS-pixel touch targets and safe-area padding for sticky controls.
- Image previews must remain logical and unmirrored; mirroring happens only in payload packing.
- Image input is capped at 30 MiB, rejected above 80 megapixels, and downscaled to a 4,096-pixel longest edge. Compressed size still does not bound the temporary memory used by the initial decode, so keep that limitation visible.
- Use runtime VID:PID `1d50:6198`; `1d50:6196` is bootloader mode and is out of scope.
- Never expose `test`, firmware-update, FIDO vendor, or unrestricted console commands.
- Image upload must clear incomplete state before sending 32 chunks.
- BIO replacement must clearly disclose that it stops and replaces persistent BIO code.
- BIO upload must clear first, locally pad to 3,840 bytes, and send all 60 chunks. Do not use `bio pad`.
- Do not describe Art or BIO transfer as installing main badge firmware or crossing developer mode.

## Code and tests

- Keep browser code dependency-light and framework-free unless a feature clearly justifies otherwise.
- Put pure transformations in `src/lib/` and cover them with Node tests.
- Run `npm run check` before publishing.
- Add or update protocol vectors whenever framing, packing, parsing, or command validation changes.
- Avoid swallowing transport failures; preserve actionable UI errors and technical logs.
- Never mark hardware behavior verified from source inspection alone.

## FEATURES.md workflow

- Use exactly `stable`, `in-progress`, or `planned` for `Stability`.
- Treat properties as the behavioral contract and test criteria as acceptance evidence.
- Check a criterion only after the stated verification succeeds.
- Record command output, source-inspection locations, browser matrices, and hardware runs in `notes/acceptance.md`; link any durable artifacts from there.
- Update the affected feature in the same contribution as its implementation.

## Recursive improvement

- Record durable protocol facts and open questions in `MEMORY.md` or `notes/`.
- Record reusable procedures in an existing skill before creating another one.
- Add concise positive and negative learnings here when they materially change future work.
- Keep instructions short enough to remain useful after context compaction.

## Current learnings

- Positive: the official console protocols are simple enough to reproduce exactly with pure browser APIs and deterministic test vectors.
- Positive: separating the logical OLED preview from payload packing prevents confusing mirrored editing UX.
- Positive: a single queued command parser can support desktop Web Serial and Android WebUSB CDC.
- Negative: do not copy the official uploader's stale 4,096-byte/64-chunk BIO comments; firmware capacity is `0xF00`, or 3,840 bytes and 60 chunks.
- Negative: do not retry `bio pad`; a lost success response can lead to an all-zero commit. Send all 60 chunks instead.
- Negative: do not treat arbitrary Xous log lines as acknowledgements.
- Negative: Android WebUSB CDC is an experimental compatibility path until its interface claims and CDC control transfers are verified on a production badge.
