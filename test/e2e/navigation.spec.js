import { expect, test } from "@playwright/test";

import { installBadgeMock } from "./support/badge-mock.js";

test("uses the original-photo theme and stays usable at phone, tablet, and desktop widths", async ({ page }) => {
  await installBadgeMock(page);
  await page.goto("/#art");

  await expect(page.locator(".hero-photo")).toHaveAttribute("src", /dc34-human-badge-v2-1280\.jpg$/);
  await expect.poll(() => page.locator(".hero-photo").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  const theme = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      background: styles.getPropertyValue("--bg").trim(),
      cyan: styles.getPropertyValue("--lime").trim(),
      orange: styles.getPropertyValue("--amber").trim(),
    };
  });
  expect(theme).toEqual({ background: "#100e0c", cyan: "#56ebf1", orange: "#f07a3e" });

  for (const viewport of [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const navigation = viewport.width <= 940 ? ".mobile-nav" : ".desktop-nav";
    for (const route of ["art", "bio", "about"]) {
      await page.locator(`${navigation} a[data-route="${route}"]`).click();
      await expect(page.locator(`[data-panel="${route}"]`)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    if (viewport.width <= 940) {
      await expect(page.locator(".mobile-nav")).toBeVisible();
      const targets = await page.locator(".mobile-nav a").evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height));
      expect(targets.every((height) => height >= 44)).toBe(true);
      await expect(page.locator(".desktop-nav")).toBeHidden();
    } else {
      await expect(page.locator(".desktop-nav")).toBeVisible();
      await expect(page.locator(".mobile-nav")).toBeHidden();
    }
  }

  await page.goto("/#about");
  await expect(page.locator('[data-panel="about"]')).toContainText("Android Chrome + USB-C OTG (experimental)");
  await expect(page.locator('.source-links a[href*="dc34-image"]')).toBeVisible();
  await expect(page.locator('.source-links a[href*="dc34-bio"]')).toBeVisible();
  await page.locator(".technical-log-wrap summary").click();
  const logButtonSizes = await page.locator(".log-actions button").evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(logButtonSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
});

test("connects through the experimental WebUSB CDC adapter", async ({ page }) => {
  await installBadgeMock(page, { transport: "usb" });
  await page.goto("/#about");
  await page.locator("#connection-button").click();
  await expect(page.locator("#connection-button")).toHaveAttribute("data-state", "connected");
  await expect(page.locator("#transport-label")).toHaveText("WebUSB CDC");
  await expect(page.locator("#usb-identity")).toContainText("0x1D50:0x6198 via WebUSB CDC");
  await expect(page.locator("#xous-version")).toHaveText("mock-34b");

  const mock = await page.evaluate(() => window.__badgeMock);
  expect(mock.requestDeviceOptions).toEqual({
    filters: [{ classCode: 2, vendorId: 0x1d50, productId: 0x6198 }],
  });
  expect(mock.claimedInterfaces).toEqual([2, 3]);
  expect(mock.usbInterfaces).toContainEqual({
    interfaceNumber: 2,
    interfaceClass: 2,
    interfaceSubclass: 2,
    interfaceProtocol: 1,
  });
  expect(mock.usbInterfaces).toContainEqual({
    interfaceNumber: 3,
    interfaceClass: 10,
    interfaceSubclass: 0,
    interfaceProtocol: 0,
  });
  expect(mock.transferOutEndpoints).toContain(3);
  expect(mock.transferInEndpoints).toContain(3);
  const lineCoding = mock.controlTransfers.find((entry) => entry.setup.request === 0x20);
  expect(lineCoding.data).toEqual([0x40, 0x42, 0x0f, 0, 0, 0, 8]);
  const dtr = mock.controlTransfers.find((entry) => entry.setup.request === 0x22);
  expect(dtr.setup.value).toBe(1);

  await page.locator("#connection-button").click();
  await expect(page.locator("#connection-button")).toHaveAttribute("data-state", "disconnected");
  const disconnected = await page.evaluate(() => window.__badgeMock);
  expect(disconnected.controlTransfers.filter((entry) => entry.setup.request === 0x22).map((entry) => entry.setup.value)).toEqual([1, 0]);
  expect(disconnected.closeCount).toBe(1);
});
