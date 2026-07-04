#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync, spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const net = require("node:net");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "teammate.config.json");
const checks = [];

if (!existsSync(configPath)) {
  console.error("teammate.config.json not found in tools/");
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));

function addCheck(name, ok, detail = "", hint = "") {
  checks.push({ name, ok, detail, hint });
}

function run(command, args, options = {}) {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        ...options
      }).trim()
    };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout || ""}${error.stderr || ""}`.trim() || error.message
    };
  }
}

function readEnv(file) {
  const full = path.join(root, file);
  if (!existsSync(full)) return {};
  const parsed = {};
  for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    parsed[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return parsed;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(450);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function adbEnv() {
  const androidHome = process.env.ANDROID_HOME || path.join(homedir(), "Library/Android/sdk");
  const platformTools = path.join(androidHome, "platform-tools");
  return {
    ...process.env,
    ANDROID_HOME: existsSync(androidHome) ? androidHome : process.env.ANDROID_HOME,
    PATH: [existsSync(platformTools) ? platformTools : "", process.env.PATH || ""].filter(Boolean).join(":")
  };
}

function prismaDbExecuteArgs(env) {
  const help = run("npx", ["prisma", "db", "execute", "--help"], { env: { ...process.env, DATABASE_URL: env.DATABASE_URL || process.env.DATABASE_URL || "" } });
  if (help.output.includes("--url")) {
    return ["prisma", "db", "execute", "--url", env.DATABASE_URL, "--stdin"];
  }
  return ["prisma", "db", "execute", "--stdin"];
}

async function main() {
  console.log(`Teammate Doctor: ${config.name}`);
  console.log(`Root: ${root}\n`);

  for (const file of config.envFiles || []) {
    const exists = existsSync(path.join(root, file));
    addCheck(`env file ${file}`, exists, exists ? "present" : "missing", `Create ${file} or copy from .env.example.`);
  }

  const env = { ...readEnv(".env.example"), ...readEnv(".env"), ...process.env };
  if (config.prismaSchema || config.requireDatabaseUrl) {
    addCheck("DATABASE_URL configured", Boolean(env.DATABASE_URL), env.DATABASE_URL ? "present, value hidden" : "missing", "Set DATABASE_URL in .env.");
  }

  for (const port of config.ports || []) {
    const open = await portOpen(port);
    const lsof = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    addCheck(
      `port ${port}`,
      !open,
      open ? `in use\n${lsof.output.split("\n").slice(0, 4).join("\n")}` : "available",
      open ? `Stop the conflicting process before starting the expected service on ${port}.` : ""
    );
  }

  if (config.prismaSchema) {
    const schemaPath = path.join(root, config.prismaSchema);
    addCheck("Prisma schema", existsSync(schemaPath), config.prismaSchema, "Restore the Prisma schema path or update this doctor config.");
    if (existsSync(schemaPath)) {
      const validate = run("npx", ["prisma", "validate", "--schema", config.prismaSchema], {
        env: { ...process.env, DATABASE_URL: env.DATABASE_URL || process.env.DATABASE_URL || "file:./doctor-placeholder.db" }
      });
      addCheck("Prisma schema validation", validate.ok, validate.output.split("\n").slice(-4).join("\n"), "Run npm run prisma:generate and inspect schema/env config.");

      if (env.DATABASE_URL) {
        const schema = readFileSync(schemaPath, "utf8");
        const provider = schema.match(/datasource\s+\w+\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/)?.[1] || "";
        const sql = provider === "mysql" ? "SELECT 1;" : provider === "postgresql" ? "SELECT 1;" : "";
        if (sql) {
          const db = spawnSync("npx", prismaDbExecuteArgs(env), {
            cwd: root,
            input: sql,
            encoding: "utf8",
            env: { ...process.env, DATABASE_URL: env.DATABASE_URL }
          });
          addCheck("Prisma database connection", db.status === 0, `${db.stdout || ""}${db.stderr || ""}`.trim().split("\n").slice(-5).join("\n"), "Check DATABASE_URL and database reachability.");
        } else {
          addCheck("Prisma database connection", true, `provider ${provider || "unknown"} uses validate-only doctor check`, "");
        }
      }
    }
  }

  if (config.adbReversePorts && config.adbReversePorts.length > 0) {
    const adbVersion = run("adb", ["version"], { env: adbEnv() });
    addCheck("ADB installed", adbVersion.ok, adbVersion.output.split("\n")[0] || "", "Install Android SDK Platform Tools.");
    const devices = run("adb", ["devices"], { env: adbEnv() });
    const connected = devices.ok && devices.output.split("\n").slice(1).some((line) => /\bdevice\b/.test(line) && !/\boffline|unauthorized\b/.test(line));
    addCheck("ADB device authorized", connected, devices.output, "Enable USB debugging on the tablet and accept the authorization prompt.");
    const reverse = run("adb", ["reverse", "--list"], { env: adbEnv() });
    for (const port of config.adbReversePorts) {
      const hasReverse = reverse.ok && reverse.output.includes(`tcp:${port}`);
      addCheck(`ADB reverse tcp:${port}`, hasReverse, reverse.output || "no reverse mappings", `Run npm run apk:reverse to forward tablet traffic for tcp:${port}.`);
    }
  }

  let failures = 0;
  for (const check of checks) {
    const status = check.ok ? "PASS" : "FAIL";
    if (!check.ok) failures += 1;
    console.log(`${status} ${check.name}`);
    if (check.detail) console.log(check.detail);
    if (!check.ok && check.hint) console.log(`Next: ${check.hint}`);
    console.log("");
  }
  console.log(failures ? `Doctor finished with ${failures} issue(s).` : "Doctor passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
