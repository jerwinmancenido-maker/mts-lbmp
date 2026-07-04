import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runDir = resolve(root, ".run");
const webPidFile = resolve(runDir, "web-prod.pid");
const apiPidFile = resolve(runDir, "api-prod.pid");
const webLog = resolve(runDir, "web-prod.log");
const apiLog = resolve(runDir, "api-prod.log");
const packageName = "com.mancenido.lbmp.test";
const androidStudioJdk = "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
const defaultAndroidHome = `${homedir()}/Library/Android/sdk`;
const javaHome = process.env.JAVA_HOME || (existsSync(androidStudioJdk) ? androidStudioJdk : "");
const androidHome = process.env.ANDROID_HOME || (existsSync(defaultAndroidHome) ? defaultAndroidHome : "");
const extraPaths = [
  javaHome ? `${javaHome}/bin` : "",
  androidHome ? `${androidHome}/platform-tools` : ""
].filter(Boolean);
const env = {
  ...process.env,
  ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  ...(androidHome ? { ANDROID_HOME: androidHome } : {}),
  PATH: [...extraPaths, process.env.PATH ?? ""].join(":"),
  PORT: "4100"
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit"
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(file) {
  try {
    return Number(readFileSync(file, "utf8").trim());
  } catch {
    return 0;
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, label) {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    if (await isPortOpen(port)) return;
    await wait(400);
  }
  throw new Error(`${label} did not start on port ${port}`);
}

function stopOne(file, label) {
  const pid = readPid(file);
  if (isPidAlive(pid)) {
    console.log(`Stopping ${label} (${pid})...`);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already stopped.
    }
  }
  rmSync(file, { force: true });
}

async function stop() {
  stopOne(webPidFile, "web");
  stopOne(apiPidFile, "api");
  await wait(800);
  stopPort(3000, "web port");
  stopPort(4100, "api port");
  await wait(400);
}

function startDetached(label, command, args, logFile, pidFile) {
  const logFd = spawnSync("sh", ["-c", `: > ${JSON.stringify(logFile)}`], {
    cwd: root,
    encoding: "utf8"
  });
  if (logFd.status !== 0) throw new Error(`Unable to prepare log file for ${label}`);

  const child = spawn(command, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"]
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(`Started ${label} (${child.pid})`);
}

function stopPort(port, label) {
  const result = spawnSync("sh", ["-c", `lsof -tiTCP:${port} -sTCP:LISTEN`], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe"
  });
  const pids = result.stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter(Boolean);
  for (const pid of pids) {
    if (!isPidAlive(pid)) continue;
    console.log(`Stopping stale ${label} owner (${pid})...`);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already stopped.
    }
  }
}

function startLogged(label, command, args, logFile, pidFile, cwd = root) {
  const out = openSync(logFile, "w");
  const err = openSync(logFile, "a");
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", out, err]
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(`Started ${label} (${child.pid})`);
}

async function start() {
  mkdirSync(runDir, { recursive: true });
  await stop();

  startLogged("api", "node", ["apps/api/dist/apps/api/src/main.js"], apiLog, apiPidFile);
  startLogged("web", "node", ["../../node_modules/next/dist/bin/next", "start", "-p", "3000"], webLog, webPidFile, resolve(root, "apps/web"));
  await waitForPort(4100, "API");
  await waitForPort(3000, "Web");

  run("adb", ["reverse", "tcp:3000", "tcp:3000"]);
  run("adb", ["reverse", "tcp:4100", "tcp:4100"]);
  run("adb", ["reverse", "--list"]);
  run("adb", ["shell", "am", "force-stop", packageName]);
  run("adb", ["shell", "monkey", "-p", packageName, "1"]);
}

async function status() {
  const apiPid = readPid(apiPidFile);
  const webPid = readPid(webPidFile);
  console.log(`API pid: ${apiPid || "none"} ${isPidAlive(apiPid) ? "running" : "stopped"}`);
  console.log(`Web pid: ${webPid || "none"} ${isPidAlive(webPid) ? "running" : "stopped"}`);
  console.log(`API port 4100: ${(await isPortOpen(4100)) ? "open" : "closed"}`);
  console.log(`Web port 3000: ${(await isPortOpen(3000)) ? "open" : "closed"}`);
}

try {
  const action = process.argv[2] ?? "start";
  if (action === "start") await start();
  else if (action === "stop") await stop();
  else if (action === "status") await status();
  else throw new Error(`Unknown action: ${action}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
