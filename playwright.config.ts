import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: /(?:logistics-workflow|tablet-ui-workflow)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "nb80-tablet",
      testIgnore: /logistics-workflow\.spec\.ts/,
      use: {
        browserName: "chromium",
        viewport: { width: 800, height: 1280 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1
      }
    },
    {
      name: "api-workflow",
      testMatch: /logistics-workflow\.spec\.ts/
    }
  ]
});
