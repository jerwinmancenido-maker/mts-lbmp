#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
const update = args.includes("--update-baselines") || args.includes("--update-snapshots");
const passthrough = args.filter((arg) => arg !== "--update-baselines");

const result = spawnSync(
  "npx",
  [
    "playwright",
    "test",
    "--config=tools/visual-audit.config.js",
    ...(update ? ["--update-snapshots"] : []),
    ...passthrough.filter((arg) => arg !== "--update-snapshots")
  ],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      VISUAL_AUDIT_RUNNER: "1"
    }
  }
);

process.exit(result.status ?? 1);
