import { expect, test } from "@playwright/test";

test.describe("MTS LBMP browser smoke", () => {
  test("public website opens and links to operations", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /logistics made traceable/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /open operations app/i })).toBeVisible();
  });

  test("admin operations app opens", async ({ page }) => {
    await page.goto("/app?demo=admin");

    await expect(page.locator("body")).toContainText("Good day.");
    await expect(page.locator("body")).toContainText("Receive");
    await expect(page.locator("body")).toContainText("Cargo");
  });

  test("wall intake opens for origin warehouse", async ({ page }) => {
    await page.goto("/intake/origin");

    await expect(page.getByRole("heading", { name: /drop-off details/i })).toBeVisible();
    await expect(page.getByLabel(/company/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /submit/i })).toBeVisible();
  });

  test("NB80-sized intake layout does not horizontally overflow", async ({ page }) => {
    await page.goto("/intake/origin");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
