import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { installBadgeMock } from "./support/badge-mock.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const photoFixture = path.join(repositoryRoot, "public/images/dc34-human-badge-v2-1280.jpg");

test("uploads, crops, previews, downloads, and sends a real image", async ({ page }) => {
  await installBadgeMock(page);
  await page.goto("/#art");
  await page.locator("#image-file").setInputFiles(photoFixture);

  await expect(page.locator("#crop-card")).toBeVisible();
  await expect(page.locator("#source-filename")).toHaveText("dc34-human-badge-v2-1280.jpg");
  await expect(page.locator("#download-art")).toBeEnabled();

  const before = await page.locator("#art-preview").evaluate((canvas) => canvas.toDataURL());
  await page.locator("#crop-canvas").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.locator("#rotate-image").click();
  await page.locator("#zoom-control").fill("145");
  await page.locator("#dither-mode").selectOption("bayer");
  await page.locator("#invert-image").check();
  await page.waitForTimeout(50);
  const after = await page.locator("#art-preview").evaluate((canvas) => canvas.toDataURL());
  expect(after).not.toBe(before);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-art").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("34b-badge-art.png");
  const downloadPath = await download.path();
  const png = await fs.readFile(downloadPath);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBe(128);
  expect(png.readUInt32BE(20)).toBe(128);

  await page.locator("#upload-art").click();
  await expect(page.locator("#art-progress-count")).toHaveText("32 / 32", { timeout: 20_000 });
  await expect(page.locator("#app-status")).toContainText("Image sent");

  const mock = await page.evaluate(() => window.__badgeMock);
  expect(mock.requestPortOptions).toEqual({ filters: [{ usbVendorId: 0x1d50, usbProductId: 0x6198 }] });
  expect(mock.openOptions[0]).toEqual({
    baudRate: 1_000_000,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
  });
  expect(mock.commands).toContain("ver xous");
  expect(mock.commands.filter((command) => command === "image clear")).toHaveLength(1);
  expect(mock.imageFrames).toHaveLength(32);
  expect(mock.imageFrames.map((frame) => frame.index)).toEqual([...Array(32).keys()]);
  expect(mock.staleAckInjected).toBe(true);

  const log = await page.locator("#technical-log").textContent();
  expect(log).toContain("image <bitmap chunk>");
  expect(log).not.toMatch(/[A-Za-z0-9+/]{94}==/);
});

test("renders and downloads a nametag without requiring a source file", async ({ page }) => {
  await installBadgeMock(page);
  await page.goto("/#art");
  await page.locator("#nametag-mode-button").click();
  await expect(page.locator("#nametag-mode-button")).toHaveAttribute("tabindex", "0");
  await page.locator("#nametag-handle").fill("NINJA CAT");
  await page.locator("#nametag-subtitle").fill("DC34 HUMAN");
  await page.locator("#nametag-inverse").check();
  await expect(page.locator("#download-art")).toBeEnabled();

  const crispPreview = await page.locator("#art-preview").evaluate((canvas) => canvas.toDataURL());
  await page.locator("#dither-mode").selectOption("floyd-steinberg");
  await page.locator("#threshold-control").fill("200");
  await page.locator("#contrast-control").fill("80");
  await page.waitForTimeout(50);
  await expect.poll(() => page.locator("#art-preview").evaluate((canvas) => canvas.toDataURL())).toBe(crispPreview);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-art").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("34b-nametag.png");

  await page.locator("#nametag-mode-button").focus();
  await page.keyboard.press("Home");
  await expect(page.locator("#photo-mode-button")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.locator("#nametag-mode-button")).toHaveAttribute("aria-selected", "true");
});

test("starts a fresh clear-first transfer after a cable loss", async ({ page }) => {
  await installBadgeMock(page, { fault: "disconnect-on-first-image" });
  await page.goto("/#art");
  await page.locator("#nametag-mode-button").click();

  await page.locator("#upload-art").click();
  await expect(page.locator("#connection-button")).toHaveAttribute("data-state", "disconnected", { timeout: 10_000 });
  await expect(page.locator("#app-status")).toContainText("stopped responding");
  let mock = await page.evaluate(() => window.__badgeMock);
  expect(mock.commands.filter((command) => command === "image clear")).toHaveLength(1);
  expect(mock.imageFrames).toHaveLength(1);

  await page.locator("#upload-art").click();
  await expect(page.locator("#art-progress-count")).toHaveText("32 / 32", { timeout: 20_000 });
  await expect(page.locator("#app-status")).toContainText("Image sent");
  mock = await page.evaluate(() => window.__badgeMock);
  expect(mock.commands.filter((command) => command === "image clear")).toHaveLength(2);
  expect(mock.imageFrames.slice(-32).map((frame) => frame.index)).toEqual([...Array(32).keys()]);
});

test("waits for a slow final image commit without restarting", async ({ page }) => {
  await installBadgeMock(page, { transport: "usb", fault: "delay-final-image" });
  await page.goto("/#art");
  await page.locator("#nametag-mode-button").click();

  await page.locator("#upload-art").click();
  await expect(page.locator("#art-progress-label")).toHaveText("Saving image on the badge…", { timeout: 15_000 });
  await expect(page.locator("#art-progress-count")).toHaveText("31 / 32 confirmed");
  await expect(page.locator("#art-progress-count")).toHaveText("32 / 32", { timeout: 10_000 });
  await expect(page.locator("#app-status")).toContainText("Image sent");

  const mock = await page.evaluate(() => window.__badgeMock);
  expect(mock.commands.filter((command) => command === "image clear")).toHaveLength(1);
  expect(mock.imageFrames).toHaveLength(32);
});

test("leaves a terminal progress state after a rejected image commit", async ({ page }) => {
  await installBadgeMock(page, { fault: "reject-final-image" });
  await page.goto("/#art");
  await page.locator("#nametag-mode-button").click();

  await page.locator("#upload-art").click();
  await expect(page.locator("#art-progress")).toHaveAttribute("data-phase", "error", { timeout: 15_000 });
  await expect(page.locator("#art-progress-label")).toHaveText("Image transfer stopped.");
  await expect(page.locator("#art-progress-count")).toHaveText("31 / 32 confirmed");
  await expect(page.locator("#app-status")).toContainText("Badge rejected image chunk 32");
});
