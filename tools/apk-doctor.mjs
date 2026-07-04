import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

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

function run(command, args = []) {
  try {
    const output = execFileSync(command, args, {
      env: toolEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    return {
      ok: true,
      output
    };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || error.message
    };
  }
}

function printCheck(label, result, hint) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${label}`);
  if (result.output) console.log(result.output.split("\n").slice(0, 5).join("\n"));
  if (!result.ok && hint) console.log(`Next: ${hint}`);
  console.log("");
}

const java = run("java", ["-version"]);
const adb = run("adb", ["version"]);
const devices = run("adb", ["devices"]);
const connectedDevices = devices.ok
  ? devices.output
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /\bdevice\b/.test(line) && !/\bunauthorized\b|\boffline\b/.test(line))
  : [];
const authorizedDeviceCheck = {
  ok: devices.ok && connectedDevices.length > 0,
  output: devices.output
};
const androidProject = { ok: existsSync("android"), output: existsSync("android") ? "android project exists" : "android project not created yet" };
const gradlew = { ok: existsSync("android/gradlew"), output: existsSync("android/gradlew") ? "Gradle wrapper exists" : "Gradle wrapper not available yet" };

printCheck("Java JDK", java, "Install Android Studio or a JDK, then reopen Terminal.");
printCheck("ADB", adb, "Install Android SDK Platform Tools from Android Studio.");
printCheck("Connected Android devices", authorizedDeviceCheck, "Enable USB debugging on the NB80, connect USB, and accept the prompt. Run adb devices again until it shows a device row.");
printCheck("Capacitor Android project", androidProject, "Run npm run apk:add:android after Java/Android SDK are ready.");
printCheck("Android Gradle wrapper", gradlew, "Created automatically after npm run apk:add:android.");

if (javaHome) console.log(`Using JAVA_HOME: ${javaHome}`);
if (androidHome) console.log(`Using ANDROID_HOME: ${androidHome}`);
console.log("");

if (java.ok && adb.ok && authorizedDeviceCheck.ok && androidProject.ok && gradlew.ok) {
  console.log("APK toolchain looks ready. Next: npm run apk:sync && npm run apk:build:debug");
} else {
  console.log("APK toolchain is not ready yet. Fix the failed checks above first.");
}
