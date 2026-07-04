/* eslint-disable @typescript-eslint/no-require-imports */
const { defineConfig } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");

const configPath = path.join(__dirname, "teammate.config.json");
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
const visualResultsDir = config.visualResultsDir || "tools/visual-results";

module.exports = defineConfig({
  testDir: ".",
  testMatch: /visual-audit\.spec\.js$/,
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  reporter: [["list"], ["html", { outputFolder: path.join("..", visualResultsDir, "html-report"), open: "never" }]],
  outputDir: path.join("..", visualResultsDir, "test-artifacts"),
  use: {
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure"
  }
});
