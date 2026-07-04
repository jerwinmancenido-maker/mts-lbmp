import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
const toolEnv = {
  ...process.env,
  ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  ...(androidHome ? { ANDROID_HOME: androidHome } : {}),
  PATH: [...extraPaths, process.env.PATH ?? ""].join(":")
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    env: toolEnv,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit"
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function output(command, args) {
  return spawnSync(command, args, { env: toolEnv, encoding: "utf8" });
}

const devices = output("adb", ["devices"]);
if (devices.status !== 0) {
  console.error("ADB is not available. Export ANDROID_HOME/platform-tools first.");
  process.exit(1);
}

const connected = devices.stdout
  .split("\n")
  .slice(1)
  .some((line) => /\sdevice\b/.test(line));

if (!connected) {
  console.error("No Android device is connected. Pair/connect the NB80 first, then retry.");
  process.exit(1);
}

console.log("Stopping LBMP APK...");
run("adb", ["shell", "am", "force-stop", packageName]);

console.log("Clearing APK WebView/cache data for a clean development refresh...");
run("adb", ["shell", "pm", "clear", packageName]);

console.log("Reconnecting local web/API ports...");
run("adb", ["reverse", "tcp:3000", "tcp:3000"]);
run("adb", ["reverse", "tcp:4100", "tcp:4100"]);
run("adb", ["reverse", "--list"]);

console.log("Relaunching LBMP APK...");
run("adb", ["shell", "monkey", "-p", packageName, "1"]);

console.log("Hard refresh complete. The APK should load fresh CSS and JavaScript.");
