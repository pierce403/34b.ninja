import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("ships the two mobile tools and custom-domain assets", async () => {
  const [html, appMain, badgeConnection, rootCname, cname, manifest, workflow, serviceWorker, ogSvg, ogPng, ogRenderer, icon192, icon512, hero768, hero1280, heroJpeg] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/badge-connection.js", import.meta.url), "utf8"),
    readFile(new URL("../CNAME", import.meta.url), "utf8"),
    readFile(new URL("../public/CNAME", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/og/34b-webusb-v2.svg", import.meta.url), "utf8"),
    readFile(new URL("../public/og/34b-webusb-v2.png", import.meta.url)),
    readFile(new URL("../scripts/render-og-card.mjs", import.meta.url), "utf8"),
    stat(new URL("../public/icons/icon-192.png", import.meta.url)),
    stat(new URL("../public/icons/icon-512.png", import.meta.url)),
    stat(new URL("../public/images/dc34-human-badge-v2-768.webp", import.meta.url)),
    stat(new URL("../public/images/dc34-human-badge-v2-1280.webp", import.meta.url)),
    stat(new URL("../public/images/dc34-human-badge-v2-1280.jpg", import.meta.url)),
  ]);
  assert.equal(rootCname.trim(), "34b.ninja");
  assert.equal(cname.trim(), "34b.ninja");
  assert.match(html, /data-panel="art"/);
  assert.match(html, /data-panel="bio"/);
  assert.match(html, /id="image-file"/);
  assert.match(html, /id="crop-canvas"/);
  assert.match(html, /id="art-preview"/);
  assert.match(html, /id="bio-file"/);
  assert.match(html, /dc34-human-badge-v2-768\.webp/);
  assert.match(html, /dc34-human-badge-v2-1280\.webp/);
  assert.match(html, /dc34-human-badge-v2-1280\.jpg/);
  assert.match(html, /A lit DEF CON 34 Human badge/);
  assert.match(html, /<title>Hack Your DEF CON 34 Badge From Your Phone — 34B\.NINJA<\/title>/);
  assert.match(html, /<h1 id="art-title">Hack on your badge <em>from your phone\.<\/em><\/h1>/);
  assert.match(html, /og:image:alt/);
  assert.match(html, /twitter:image:alt/);
  assert.match(html, /https:\/\/34b\.ninja\/og\/34b-webusb-v2\.png/);
  assert.doesNotMatch(`${html}\n${appMain}\n${manifest}\n${ogSvg}`, /Put your thing|do weird stuff|Source rabbit holes|YOUR PIXELS|ITS WEIRD PINS|NO IMAGE UPLOAD|Ordered \/ crunchy/i);
  assert.match(manifest, /experimental Android WebUSB/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /playwright install/);
  assert.match(badgeConnection, /import \{ serial as webUsbSerial \} from "web-serial-polyfill";/);
  assert.doesNotMatch(badgeConnection, /import\("web-serial-polyfill"\)/);
  assert.match(serviceWorker, /response\.ok && contentType\.includes\("text\/html"\)/);
  assert.match(serviceWorker, /34b-ninja-v5/);
  assert.match(ogSvg, /HACK YOUR/);
  assert.match(ogSvg, /FROM YOUR PHONE/);
  assert.match(ogSvg, /dc34-human-badge-v2-1280\.jpg/);
  assert.match(ogRenderer, /34b-webusb-v2\.svg/);
  assert.deepEqual([...ogPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(ogPng.readUInt32BE(16), 1200);
  assert.equal(ogPng.readUInt32BE(20), 630);
  assert.ok(icon192.size > 1_000);
  assert.ok(icon512.size > 1_000);
  assert.ok(hero768.size > 10_000);
  assert.ok(hero1280.size > hero768.size);
  assert.ok(heroJpeg.size > hero1280.size);
});

test("repository guidance follows the recurse.bot document split", async () => {
  const files = await Promise.all([
    "AGENTS.md",
    "FEATURES.md",
    "MEMORY.md",
    "SKILLS.md",
    "skills/maintain-badge-protocol/SKILL.md",
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.ok(files.every((content) => content.length > 100));
});
