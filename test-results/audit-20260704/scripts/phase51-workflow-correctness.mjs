import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const root = "/Users/jerwinmancenido/mts-lbmp";
const macbookReceivePath = `${root}/test-results/audit-20260704/screenshots/macbook/093-macbook-phase51-receive-tab.png`;
const nb80ReceivePath = `${root}/test-results/audit-20260704/screenshots/nb80/093-nb80-phase51-receive-tab.png`;
const macbookPostSavePath = `${root}/test-results/audit-20260704/screenshots/macbook/094-macbook-phase51-postsave-rr-visible.png`;
const nb80PostSavePath = `${root}/test-results/audit-20260704/screenshots/nb80/094-nb80-phase51-postsave-rr-visible.png`;

for (const dir of [
  `${root}/test-results/audit-20260704/screenshots/macbook`,
  `${root}/test-results/audit-20260704/screenshots/nb80`
]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function adbScreencap(path) {
  const bytes = execFileSync("adb", ["exec-out", "screencap", "-p"], {
    env: { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/Library/Android/sdk/platform-tools` }
  });
  writeFileSync(path, bytes);
}

function currentWebviewSocket() {
  let lastOutput = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const output = execFileSync("adb", ["shell", "cat", "/proc/net/unix"], {
      env: { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/Library/Android/sdk/platform-tools` },
      encoding: "utf8"
    });
    lastOutput = output;
    const matches = [...output.matchAll(/@(webview_devtools_remote_[0-9]+)/g)];
    const latest = matches.at(-1)?.[1];
    if (latest) return latest;
    execFileSync("sleep", ["1"]);
  }
  throw new Error(`Unable to find NB80 WebView devtools socket. Output: ${lastOutput.slice(-800)}`);
}

async function maybeClick(locator, timeout = 1200) {
  try {
    await locator.first().click({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function maybeFill(locator, value, timeout = 1500) {
  try {
    await locator.first().fill(value, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function selectFirstByLabel(page, labelText, valueText) {
  const select = page.locator(`label:has-text("${labelText}") select`).first();
  if (await select.count()) {
    await select.selectOption({ label: valueText }).catch(async () => select.selectOption(valueText));
    return;
  }
  await page.locator("select").first().selectOption({ label: valueText }).catch(async () => {
    await page.locator("select").first().selectOption(valueText);
  });
}

async function openReceiveNew(page) {
  await page.goto("http://localhost:3000/app?demo=admin", { waitUntil: "domcontentloaded", timeout: 15000 }).catch(async () => {
    await page.goto("http://127.0.0.1:3000/app?demo=admin", { waitUntil: "domcontentloaded", timeout: 15000 });
  });
  await page.waitForTimeout(1800);
  await maybeClick(page.locator("button").filter({ hasText: /Receive/ }).first(), 2500)
    || await maybeClick(page.getByRole("button", { name: /Receive/i }), 2500)
    || await maybeClick(page.getByText(/^Receive$/i), 2500);
  await page.waitForTimeout(800);
  await maybeClick(page.locator("button").filter({ hasText: /New/ }).filter({ hasText: /Receive items/i }).first(), 2500)
    || await maybeClick(page.getByRole("button", { name: /^New$/i }), 2000)
    || await maybeClick(page.getByText(/^New$/i), 2000)
    || await maybeClick(page.getByRole("button", { name: /New Receiving/i }), 2000);
  await page.waitForTimeout(1000);
}

async function fillOneItemAndSave(page, marker) {
  await selectFirstByLabel(page, "Branch", "Daet");
  await page.waitForTimeout(400);

  await maybeFill(page.getByPlaceholder(/Type customer name/i), "QA-CUSTOMER-001 Retail Group");
  await page.waitForTimeout(700);
  await maybeClick(page.getByText(/QA-CUSTOMER-001 Retail Group/i), 900);

  await maybeFill(page.getByPlaceholder(/Example: Legazpi City, Albay/i), `QA Daet delivery area ${marker}`);
  await maybeFill(page.getByPlaceholder(/Type drop-off name/i), `QA Dropoff ${marker}`);
  await maybeFill(page.getByPlaceholder(/Type receiver name/i), `QA Receiver ${marker}`);

  const productField = page.getByPlaceholder(/Type product, SKU, or scan barcode/i).first();
  await productField.scrollIntoViewIfNeeded();
  await productField.fill("QA-ITEM-001");
  await page.waitForTimeout(800);
  await maybeClick(page.getByText(/QA-ITEM-001|Flat bar|Flat/i), 900);

  await maybeFill(page.getByPlaceholder(/Auto if history exists/i), "737", 1000);
  await maybeClick(page.getByRole("button", { name: /^Add Item$/i }), 2500);
  await page.waitForTimeout(1000);

  await maybeClick(page.getByRole("button", { name: /^Save Receiving/i }), 2500);
  await page.waitForTimeout(800);
  await maybeClick(page.getByRole("button", { name: /^Save Receiving$/i }), 2500);
  await page.waitForTimeout(3500);

  await page.waitForSelector("text=/RR-2026-07-/", { timeout: 12000 });
  await page.waitForSelector("text=Print Receipt", { timeout: 12000 });

  const text = await page.locator("body").innerText();
  return {
    hasRr: /RR-2026-07-/.test(text),
    hasPrint: /Print Receipt/.test(text),
    text
  };
}

async function runMacBook() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await openReceiveNew(page);
  await page.screenshot({ path: macbookReceivePath, fullPage: true });
  const result = await fillOneItemAndSave(page, `MB-${Date.now().toString().slice(-5)}`);
  await page.screenshot({ path: macbookPostSavePath, fullPage: true });
  await browser.close();
  return result;
}

async function runNb80() {
  try {
    execFileSync("adb", ["forward", "--remove", "tcp:9223"], {
      env: { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/Library/Android/sdk/platform-tools` }
    });
  } catch {
    // No existing forward is fine.
  }
  execFileSync("adb", ["forward", "tcp:9223", `localabstract:${currentWebviewSocket()}`], {
    env: { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/Library/Android/sdk/platform-tools` }
  });
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();
  await page.setViewportSize({ width: 800, height: 1192 }).catch(() => {});
  await openReceiveNew(page);
  adbScreencap(nb80ReceivePath);
  const result = await fillOneItemAndSave(page, `NB-${Date.now().toString().slice(-5)}`);
  await page.waitForTimeout(800);
  adbScreencap(nb80PostSavePath);
  await browser.close();
  return result;
}

const macbook = await runMacBook();
const nb80 = await runNb80();

console.log(JSON.stringify({
  macbook,
  nb80,
  screenshots: {
    macbookReceivePath,
    nb80ReceivePath,
    macbookPostSavePath,
    nb80PostSavePath
  }
}, null, 2));
