/* eslint-disable @typescript-eslint/no-require-imports */
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");

const configPath = path.join(__dirname, "teammate.config.json");
if (!fs.existsSync(configPath)) {
  throw new Error("teammate.config.json not found in tools/");
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const baseUrl = process.env.VISUAL_AUDIT_BASE_URL || config.visualAuditBaseUrl || "http://127.0.0.1:3000";
const maxDiffPixelRatio = Number(process.env.VISUAL_AUDIT_MAX_DIFF_PIXEL_RATIO || "0.01");

const viewports = config.visualAuditViewports || [
  { name: "desktop", width: 1440, height: 1100 }
];

const views = config.visualAuditViews || [];

async function stabilizePage(page) {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation-delay: 0s !important;
        animation-duration: 0.001s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0.001s !important;
      }
    `
  });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
}

async function loginIfConfigured(page) {
  const user = process.env.VISUAL_AUDIT_USER || process.env.AUDIT_LOGIN_EMAIL;
  const pass = process.env.VISUAL_AUDIT_PASSWORD || process.env.AUDIT_LOGIN_PASSWORD;
  if (!user || !pass) return;

  const email = page.locator('input[type="email"], input[name="email"], input[name="username"]').first();
  const password = page.locator('input[type="password"], input[name="password"]').first();
  if ((await email.count()) && (await password.count())) {
    await email.fill(user);
    await password.fill(pass);
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")').first().click();
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  }
}

async function clickViewTarget(page, label) {
  if (!label) return;
  const locator = page
    .getByRole("button", { name: new RegExp(label, "i") })
    .or(page.getByRole("link", { name: new RegExp(label, "i") }))
    .first();
  if (await locator.count()) {
    await locator.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

for (const viewport of viewports) {
  test.describe(`${config.name} visual audit - ${viewport.name}`, () => {
    test.use({ viewport });

    for (const view of views) {
      test(view.name, async ({ page }) => {
        await page.goto(new URL(view.path, baseUrl).toString(), { waitUntil: "domcontentloaded" });
        await loginIfConfigured(page);
        await clickViewTarget(page, view.click);
        await stabilizePage(page);
        await expect(page).toHaveScreenshot(`${view.name}-${viewport.name}.png`, {
          fullPage: true,
          maxDiffPixelRatio
        });
      });
    }
  });
}
