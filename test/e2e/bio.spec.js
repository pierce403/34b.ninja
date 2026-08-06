import { expect, test } from "@playwright/test";

import { installBadgeMock } from "./support/badge-mock.js";

test("uploads a padded BIO program and exchanges FIFO3 words", async ({ page }) => {
  await installBadgeMock(page);
  await page.goto("/#bio");

  await page.locator("#bio-file").setInputFiles({
    name: "touch-demo.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(Array.from({ length: 65 }, (_, index) => (index + 1) & 0xff)),
  });
  await expect(page.locator("#bio-filemeta")).toContainText("65 bytes · 2 data chunks · padded to 60");

  await page.locator("#bio-clock").fill("24 kHz");
  await expect(page.locator("#upload-bio")).toBeDisabled();
  await expect(page.locator("#clock-validation")).toContainText("between 25 kHz and 350 MHz");

  await page.locator("#biosao-preset").click();
  await expect(page.locator('input[name="sao-pin"][value="1"]')).toBeChecked();
  await expect(page.locator('input[name="sao-pin"][value="3"]')).toBeChecked();
  await page.locator("#bio-confirm").check();
  await expect(page.locator("#upload-bio")).toBeEnabled();

  await page.locator("#upload-bio").click();
  await expect(page.locator("#bio-progress-count")).toHaveText("60 / 60", { timeout: 30_000 });
  await expect(page.locator("#app-status")).toContainText("BIO program running");
  await expect(page.locator("#fifo-tx-button")).toBeEnabled();
  await expect(page.locator("#fifo-rx-button")).toBeEnabled();

  let mock = await page.evaluate(() => window.__badgeMock);
  const bioStart = mock.commands.indexOf("bio clear");
  expect(mock.commands.slice(bioStart, bioStart + 4)).toEqual([
    "bio clear",
    "bio ready",
    "bio pin 21 30",
    "bio clk 1000000",
  ]);
  expect(mock.bioFrames).toHaveLength(60);
  expect(mock.bioFrames.map((frame) => frame.index)).toEqual([...Array(60).keys()]);
  expect(mock.bioFrames[0].prefix).toEqual([1, 2, 3, 4, 5, 6]);
  expect(mock.bioFrames[59].prefix).toEqual([0, 0, 0, 0, 0, 0]);
  expect(mock.commands.at(-1)).toBe("bio reload");
  expect(mock.commands).not.toContain("bio pad");

  await page.locator("#fifo-tx-value").fill("not-a-word");
  await page.locator("#fifo-tx-button").click();
  await expect(page.locator("#app-status")).toContainText("unsigned 32-bit");
  await page.locator("#fifo-tx-value").fill("0xdeadbeef");
  await page.locator("#fifo-tx-button").click();
  await expect.poll(async () => (await page.evaluate(() => window.__badgeMock.commands)).at(-1)).toBe("bio tx 0xdeadbeef");

  await page.locator("#fifo-rx-button").click();
  await expect(page.locator("#fifo-rx-value")).toHaveText("0x12340001");
  await expect(page.locator("#fifo-rx-decoded")).toHaveText("TOUCHED · rise average 4660");

  await page.locator("#connection-button").click();
  await expect(page.locator("#connection-button")).toHaveAttribute("data-state", "disconnected");
  await expect(page.locator("#fifo-tx-button")).toBeDisabled();
  await expect(page.locator("#fifo-rx-button")).toBeDisabled();
  mock = await page.evaluate(() => window.__badgeMock);
  expect(mock.closeCount).toBe(1);
});
