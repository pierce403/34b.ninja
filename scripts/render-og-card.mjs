import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "public/og/34b-webusb-v2.svg");
const output = path.join(root, "public/og/34b-webusb-v2.png");
const legacyOutput = path.join(root, "public/og-card.png");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

await mkdir(path.dirname(output), { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(source).href, { waitUntil: "networkidle" });
  await page.screenshot({
    path: output,
    clip: { x: 0, y: 0, width: 1200, height: 630 },
    animations: "disabled",
  });
  await copyFile(output, legacyOutput);
  await context.close();
} finally {
  await browser.close();
}

console.log(`${path.relative(root, output)}\n${path.relative(root, legacyOutput)}`);
