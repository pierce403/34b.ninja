import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("ships the two mobile tools and custom-domain assets", async () => {
  const [html, rootCname, cname, manifest, workflow, serviceWorker, icon192, icon512, hero768, hero1280, heroJpeg] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../CNAME", import.meta.url), "utf8"),
    readFile(new URL("../public/CNAME", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    stat(new URL("../public/icons/icon-192.png", import.meta.url)),
    stat(new URL("../public/icons/icon-512.png", import.meta.url)),
    stat(new URL("../public/images/dc34-human-badge-v1-768.webp", import.meta.url)),
    stat(new URL("../public/images/dc34-human-badge-v1-1280.webp", import.meta.url)),
    stat(new URL("../public/images/dc34-human-badge-v1-1280.jpg", import.meta.url)),
  ]);
  assert.equal(rootCname.trim(), "34b.ninja");
  assert.equal(cname.trim(), "34b.ninja");
  assert.match(html, /data-panel="art"/);
  assert.match(html, /data-panel="bio"/);
  assert.match(html, /id="image-file"/);
  assert.match(html, /id="crop-canvas"/);
  assert.match(html, /id="art-preview"/);
  assert.match(html, /id="bio-file"/);
  assert.match(html, /dc34-human-badge-v1-768\.webp/);
  assert.match(html, /dc34-human-badge-v1-1280\.webp/);
  assert.match(html, /dc34-human-badge-v1-1280\.jpg/);
  assert.match(html, /A lit DEF CON 34 Human badge/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(workflow, /npm run check/);
  assert.match(serviceWorker, /response\.ok && contentType\.includes\("text\/html"\)/);
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
