const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    await page.goto('http://localhost:3000/app?demo=admin', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-results/audit-20260704/screenshots/macbook/090-macbook-phase51-admin-home.png', fullPage: false });
    console.log('Shot 1: admin home done');

    // Click Receive tab
    const receiveTab = page.locator('button, a, [role="tab"]').filter({ hasText: 'Receive' }).first();
    if (await receiveTab.count() > 0) {
      await receiveTab.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/audit-20260704/screenshots/macbook/091-macbook-phase51-receive-tab.png', fullPage: false });
      console.log('Shot 2: receive tab done');

      // Click New button
      const newBtn = page.locator('button').filter({ hasText: /^New/ }).first();
      if (await newBtn.count() > 0) {
        await newBtn.click();
        await page.waitForTimeout(2500);
        await page.screenshot({ path: 'test-results/audit-20260704/screenshots/macbook/092-macbook-phase51-receive-new-form.png', fullPage: false });
        console.log('Shot 3: receive new form done');
      } else {
        console.log('WARNING: New button not found');
        await page.screenshot({ path: 'test-results/audit-20260704/screenshots/macbook/092-macbook-phase51-receive-no-new-btn.png', fullPage: false });
      }
    } else {
      console.log('WARNING: Receive tab not found - current page buttons:');
      const buttons = await page.locator('button, a[href], [role="tab"]').allTextContents();
      console.log(buttons.slice(0, 20).join(' | '));
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    await page.screenshot({ path: 'test-results/audit-20260704/screenshots/macbook/090-macbook-phase51-error.png', fullPage: false });
  }

  await browser.close();
})();
