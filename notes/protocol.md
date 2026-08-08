# Badge protocol notes

Pinned source snapshot inspected 2026-08-06. Full commit IDs are intentional: future reviews must not silently follow a moving default branch.

| Upstream | Pinned commit |
| --- | --- |
| `dc34-vault` | [`3d5cbf707a715fca508074e4a377f0d7497e0cba`](https://github.com/bunnie/dc34-vault/commit/3d5cbf707a715fca508074e4a377f0d7497e0cba) |
| `dc34-console` | [`bf64e03f019532cca5055fcdbe51977d572e3630`](https://github.com/bunnie/dc34-console/commit/bf64e03f019532cca5055fcdbe51977d572e3630) |
| `dc34-api` | [`617f0f3dff3cea1e9421d766b19664f5bec9a54b`](https://github.com/bunnie/dc34-api/commit/617f0f3dff3cea1e9421d766b19664f5bec9a54b) |
| `dc34-core-hw` | [`4cfabe5d43f458482b1f2cb75a5f1e259f86749f`](https://github.com/bunnie/dc34-core-hw/commit/4cfabe5d43f458482b1f2cb75a5f1e259f86749f) |
| `dc34-image` | [`b0ffa9a3e84e8a37d89c91dbac45bdf9ca62d948`](https://github.com/bunnie/dc34-image/commit/b0ffa9a3e84e8a37d89c91dbac45bdf9ca62d948) |
| `dc34-bio` | [`bc02395c1a149e2179d0a8900c1d9fe31afda575`](https://github.com/bunnie/dc34-bio/commit/bc02395c1a149e2179d0a8900c1d9fe31afda575) |
| `xous-core` dependency | [`616bf65f6e379165464f50b1e79ec42aff77a683`](https://github.com/betrusted-io/xous-core/commit/616bf65f6e379165464f50b1e79ec42aff77a683) |

The protocol conclusions below come from these pinned implementation files:

- image host: [`dc34_image/send_image.py`](https://github.com/bunnie/dc34-image/blob/b0ffa9a3e84e8a37d89c91dbac45bdf9ca62d948/dc34_image/send_image.py)
- image receiver: [`src/cmds/image.rs`](https://github.com/bunnie/dc34-console/blob/bf64e03f019532cca5055fcdbe51977d572e3630/src/cmds/image.rs)
- BIO host: [`dc34_bio/dc34_bio.py`](https://github.com/bunnie/dc34-bio/blob/bc02395c1a149e2179d0a8900c1d9fe31afda575/dc34_bio/dc34_bio.py)
- BIO receiver: [`src/cmds/bio.rs`](https://github.com/bunnie/dc34-console/blob/bf64e03f019532cca5055fcdbe51977d572e3630/src/cmds/bio.rs)
- `biosao` touch sample: [`src/bio/biosao`](https://github.com/bunnie/dc34-console/tree/bf64e03f019532cca5055fcdbe51977d572e3630/src/bio/biosao)
- runtime USB identity and composition: [`services/usb-bao1x/src/hw.rs`](https://github.com/betrusted-io/xous-core/blob/616bf65f6e379165464f50b1e79ec42aff77a683/services/usb-bao1x/src/hw.rs)
- dependency pin: [`dc34-console/Cargo.toml`](https://github.com/bunnie/dc34-console/blob/bf64e03f019532cca5055fcdbe51977d572e3630/Cargo.toml)

## Runtime USB

- VID:PID: `1d50:6198`
- Product: `Baochip / Baosec-lite`
- Composite functions: raw FIDO HID, NKRO keyboard HID, CDC-ACM serial.
- Serial configuration used by official uploaders: 1,000,000 baud, 8-N-1, no flow control.
- Bootloader VID:PID `1d50:6196` is deliberately outside current scope.

Native Web Serial is preferred. On a secure origin without `navigator.serial`, the current app uses a statically bundled `web-serial-polyfill` 1.0.15 backend over `navigator.usb`, keeping `requestDevice()` directly in the connection tap's transient user activation. That implementation adds CDC control class `0x02` to the chooser filter, selects configuration 1 when necessary, finds and claims the first CDC control (`0x02`) and data (`0x0a`) interfaces, sends `SET_LINE_CODING` (`0x20`) for 1,000,000-baud 8-N-1, asserts DTR with `SET_CONTROL_LINE_STATE` (`0x22`), and moves bytes through the data interface's bulk endpoints. It does not claim the badge's HID functions. This describes source behavior, not completed Android hardware validation.

## Image

- Logical bitmap: 128×128, black=`1`, white=`0`.
- Payload: 2,048 bytes; 32 chunks of 64 bytes.
- Packing: horizontal flip, 32 pixels MSB-first per word, reverse each row's four words, serialize words big-endian.
- Wire chunk: big-endian `u16 index`, 64 bytes, big-endian CRC32 over the first 66 bytes.
- Command: `image <base64>`, replies `OK`, `ERR`, or final `SUCCESS`; `image clear` replies `CLEAR`.
- Clear before every upload because interrupted volatile chunks cannot be queried.

## Browser image decode

- The current selector requires an `image/*` MIME type and rejects files larger than 30 MiB.
- The preferred path is `createImageBitmap(file, { imageOrientation: "from-image" })`; the fallback decodes an object URL with `HTMLImageElement.decode()`.
- The previous `ImageBitmap` is closed when possible, and fallback object URLs are revoked after decode.
- After decode, sources above 80 megapixels are rejected and sources longer than 4,096 pixels on either edge are downscaled before editing. The 30 MiB compressed-file cap still does not bound the temporary memory required for that initial decode.

## BIO

- Actual capacity: firmware `BIO_MEM_BYTES = 0xF00`, so `NUM_CHUNKS = 0xF00 / 64 = 60` and the maximum is 3,840 bytes.
- The Python uploader's module/help strings say 4,096 bytes and one inline comment says 64 chunks. Those comments are stale: the same uploader's executable `MAX_CODE_BYTES = 0xF00` and the firmware receiver both resolve to 3,840 bytes and 60 chunks. The browser follows firmware and sends all 60.
- Slots 1–4 map to pins 21, 22, 30, and 31.
- Valid clock range used by official tooling: 25,000–350,000,000 Hz.
- Replacement flow: `bio clear`, `bio ready`, optional `bio pin`, explicit `bio clk`, all 60 chunks, `bio reload`.
- Never use `bio pad`: retry after a lost success can commit an all-zero program.
- BIO code persists and can drive physical pins. The browser must not imply electrical safety.

## Browser command grammar

Every command is trimmed before validation and only one validated command is queued at a time. The allowlist in `src/lib/protocol.js` accepts these forms and no others:

| Form | Argument grammar |
| --- | --- |
| `ver xous` | exact literal |
| `image clear` | exact literal |
| `image <chunk>` | exactly one 96-character token matching 94 Base64-alphabet characters followed by `==` |
| `bio ready` / `bio clear` / `bio reload` | exact literals |
| `bio <chunk>` | same 96-character chunk token as image |
| `bio pin <pin> [<pin> ...]` | one to four distinct tokens, each of which JavaScript `Number()` maps to `21`, `22`, `30`, or `31`; UI-generated commands use canonical base-10 digits |
| `bio clk <hz>` | one token that JavaScript `Number()` parses as an integer from 25,000 through 350,000,000; UI-generated commands use canonical base-10 digits |
| `bio tx <word>` | one `0x`-prefixed hexadecimal token or one token JavaScript `Number()` parses as an integer from 0 through `0xffffffff`; UI-generated commands use lowercase hexadecimal |
| `bio rx 1 1` | exact literal: one FIFO3 read with a one-second firmware timeout |

Chunk commands generated by the app decode to 70 bytes: big-endian `u16` index, 64 data bytes, and big-endian CRC32. The syntactic allowlist does not itself decode the token or verify its CRC; the app's chunk constructor produces those fields and firmware validates them. `bio pad`, `test`, UF2/firmware commands, FIDO vendor commands, malformed chunks, repeated pins, and arbitrary shell input are blocked.

## Responses, timeouts, and retries

- On connection, the app waits for 500 ms of input silence, up to 2 seconds, before returning control to the caller.
- The shell's exact `[console] <command>` echo arms the pending response matcher and starts a fresh response deadline. Blank lines, mismatched echoes, and acknowledgement-looking lines received before that exact echo are ignored. Other Xous output after the echo is retained in the command log, but only an exact state-specific acknowledgement resolves the command. `ERR` or `ERR ...` rejects it.
- Whole operations and individual commands are serialized; there is at most one response matcher in flight.
- A retry waits 500 ms and resends the same command. Duplicate non-final indexed chunks are safe because firmware overwrites an already-filled index without incrementing the received count.
- The echo deadline is at most 4 seconds. Final image and BIO chunks get a separate 20-second response deadline after the echo because those paths persist the assembled payload before returning `SUCCESS`; ordinary chunks only update volatile staging memory.

| Operation | Response timeout after echo | Same-command retries |
| --- | ---: | ---: |
| Xous version query | 3 s | 1 |
| image clear | 4 s | 2 |
| image chunks 0–30 | 4 s | 4 |
| image final chunk 31 | 20 s | 0 |
| BIO clear, ready, pin, clock | 3 s | 2 |
| BIO chunks 0–58 | 3 s | 3 |
| BIO final chunk 59 | 20 s | 0 |
| BIO reload | 5 s | 1 |
| FIFO3 TX | 6 s | 0 |
| FIFO3 RX | 3 s | 0 |

Image and BIO uploads allow at most two full transaction passes. A connected, non-aborted, non-deterministic failure in the first pass waits 500 ms, clears staging state, and restarts from chunk zero. Validation/type errors, allowlist blocks, explicit firmware rejection, cancellation, and disconnect do not restart. Final chunks are deliberately not retried in place: if firmware committed but `SUCCESS` was lost, the staging buffer has already been cleared and the outcome is ambiguous. Non-final chunks accept only `OK`; final chunks accept only `SUCCESS`, preventing a late completion token from advancing a restarted non-final command. A transport disconnect fails the transaction and is never silently resumed.

## Hardware validation still needed

- Verify native Web Serial interface selection on Linux, macOS, and Windows.
- Verify WebUSB CDC claiming on Android Chrome with a retail badge and USB-C OTG cable.
- Compare uploaded corner/orientation fixture to the logical preview.
- Build the pinned `src/bio/biosao` sample, record the resulting binary hash, and verify FIFO3 touch telemetry. The upstream snapshot does not commit a ready-to-upload binary.
- Confirm production firmware responses match the inspected source commits.
