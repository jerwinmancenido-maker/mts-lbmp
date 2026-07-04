import { expect, test } from "@playwright/test";

test.describe("NB80 tablet UI workflow", () => {
  test.use({
    viewport: { width: 430, height: 900 },
    isMobile: true,
    hasTouch: true
  });

  test("receiving screen exposes the staff-critical controls without horizontal overflow", async ({ page }) => {
    await page.goto("/app?demo=admin");
    await page.getByRole("button", { name: /receive new receiving/i }).click();

    await expect(page.getByRole("heading", { name: /what do you want to do/i })).toBeVisible();
    await expect(page.getByText("New", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Records", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Intake Tasks", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Companies", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Products", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: /new receive items/i }).click();
    await expect(page.getByRole("heading", { name: /receive items/i })).toBeVisible();
    await expect(page.locator("label").filter({ hasText: /^Branch/ }).locator("select").first()).toBeVisible();
    await expect(page.getByLabel("Customer Name")).toBeVisible();
    await expect(page.getByLabel("Area / Address Summary")).toBeVisible();
    await expect(page.getByText("Drop-off Person")).toBeVisible();
    await expect(page.getByText("Receiver / Consignee")).toBeVisible();
    await expect(page.getByLabel("DR Number")).toBeVisible();
    await expect(page.getByLabel("Product Code / Barcode")).toBeVisible();
    await expect(page.getByLabel("Product / Description")).toBeVisible();
    await expect(page.getByLabel("Unit Price")).toBeVisible();
    await expect(page.getByText("Payment at Receiving")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("can create a trip from the tablet trip screen and find it in trip list", async ({ page }) => {
    const plateNumber = `UI${String(Date.now()).slice(-6)}`;

    await page.goto("/app?demo=admin");
    await page.getByRole("button", { name: /trips loading and trips/i }).click();

    await expect(page.getByText("Create Trip", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Trip List", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Trucks", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: /create trip start truck movement/i }).click();
    await expect(page.getByRole("heading", { name: /create trip/i })).toBeVisible();
    await page.locator("label").filter({ hasText: /^Plate Number/ }).locator("input").fill(plateNumber);
    await expect(page.getByRole("button", { name: /create daet trip/i })).toBeEnabled();
    await page.getByRole("button", { name: /create daet trip/i }).click();
    await expect(page.locator("body")).toContainText("completed");

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator("body")).toContainText(plateNumber);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
