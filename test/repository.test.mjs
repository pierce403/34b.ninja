import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("ships the two mobile tools and custom-domain assets", async () => {
  const [html, cname, manifest, workflow, serviceWorker, icon192, icon512] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/CNAME", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    stat(new URL("../public/icons/icon-192.png", import.meta.url)),
    stat(new URL("../public/icons/icon-512.png", import.meta.url)),
  ]);
  assert.equal(cname.trim(), "34b.ninja");
  assert.match(html, /data-panel="art"/);
  assert.match(html, /data-panel="bio"/);
  assert.match(html, /id="image-file"/);
  assert.match(html, /id="crop-canvas"/);
  assert.match(html, /id="art-preview"/);
  assert.match(html, /id="bio-file"/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(workflow, /npm run check/);
  assert.match(serviceWorker, /response\.ok && contentType\.includes\("text\/html"\)/);
  assert.ok(icon192.size > 1_000);
  assert.ok(icon512.size > 1_000);
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
