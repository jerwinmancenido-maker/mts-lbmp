import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";

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
  PORT: process.env.PORT ?? "4100"
};

const children = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
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

function start(name, command, args) {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && !shuttingDown) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(1);
    }
  });
  return child;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(url, label) {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      // Keep waiting while the process starts.
    }
    await wait(500);
  }
  throw new Error(`${label} did not become reachable at ${url}`);
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

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  console.log("Checking Android device...");
  const devices = run("adb", ["devices"], { quiet: true }).stdout;
  const connected = devices
    .split("\n")
    .slice(1)
    .some((line) => /\sdevice\b/.test(line));
  if (!connected) {
    throw new Error("No Android device is connected. Pair/connect the NB80 first.");
  }

  const busyPorts = [];
  if (await isPortOpen(3000)) busyPorts.push("3000 web");
  if (await isPortOpen(4100)) busyPorts.push("4100 API");
  if (busyPorts.length) {
    throw new Error(
      `Cannot start production-local APK session because these ports are already in use: ${busyPorts.join(", ")}.\n` +
        "Stop the current dev web/API servers first, then run this command again."
    );
  }

  console.log("Starting optimized API and web app...");
  start("api", "npm", ["run", "start", "--workspace", "@mts-lbmp/api"]);
  start("web", "npm", ["run", "start", "--workspace", "@mts-lbmp/web"]);

  await Promise.all([
    waitFor("http://127.0.0.1:4100/health", "API"),
    waitFor("http://127.0.0.1:3000/app?demo=admin", "Web app")
  ]);

  console.log("Reversing APK ports...");
  run("adb", ["reverse", "tcp:3000", "tcp:3000"]);
  run("adb", ["reverse", "tcp:4100", "tcp:4100"]);
  run("adb", ["reverse", "--list"]);

  console.log("Relaunching LBMP APK...");
  run("adb", ["shell", "am", "force-stop", packageName]);
  run("adb", ["shell", "monkey", "-p", packageName, "1"]);

  console.log("Production-local APK session is running.");
  console.log("Open in browser: http://localhost:3000/app?demo=admin");
  console.log("Press Ctrl+C in this terminal when done testing.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}
