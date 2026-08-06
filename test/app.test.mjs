import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { browserCanUseBadge, extractXousVersion, formatUsbId } from "../app.js";

test("formats USB identifiers as four-digit hexadecimal", () => {
  assert.equal(formatUsbId(0x1209), "0x1209");
  assert.equal(formatUsbId(0x4d), "0x004D");
  assert.equal(formatUsbId(undefined), "Not reported");
});

test("extracts the read-only Xous version response", () => {
  assert.equal(extractXousVersion("[console] ver xous\r\nXous version: v0.10.2-34\r\n"), "v0.10.2-34");
  assert.equal(extractXousVersion("still waiting"), null);
});

test("requires Web Serial and a secure context", () => {
  assert.equal(browserCanUseBadge({}, true), true);
  assert.equal(browserCanUseBadge(undefined, true), false);
  assert.equal(browserCanUseBadge({}, false), false);
});

test("ships apex-domain and Web Serial wiring", async () => {
  const [html, cname, app] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../CNAME", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
  ]);

  assert.equal(cname.trim(), "34b.ninja");
  assert.match(html, /id="connect-button"/);
  assert.match(html, /https:\/\/34b\.ninja\//);
  assert.match(app, /navigator\.serial\.requestPort/);
  assert.match(app, /ver xous\\n/);
  assert.match(app, /1_000_000/);
});
