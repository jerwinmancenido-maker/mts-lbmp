import { spawnSync } from "node:child_process";
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

function run(args) {
  const result = spawnSync("adb", args, {
    env: toolEnv,
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["reverse", "tcp:3000", "tcp:3000"]);
run(["reverse", "tcp:4100", "tcp:4100"]);
run(["reverse", "--list"]);
