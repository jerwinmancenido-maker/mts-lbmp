import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

function run(command, args = [], options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit"
  });
}

function listeningPids(port) {
  const result = run("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { quiet: true });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  return result.stdout
    .trim()
    .split("\n")
    .map((pid) => pid.trim())
    .filter(Boolean);
}

function stopPort(port) {
  const pids = listeningPids(port);
  if (pids.length === 0) {
    console.log(`Port ${port}: no listener.`);
    return;
  }

  console.log(`Port ${port}: stopping ${pids.join(", ")}...`);
  for (const pid of pids) {
    run("kill", [pid], { quiet: true });
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);

  for (const pid of listeningPids(port)) {
    console.log(`Port ${port}: force stopping ${pid}...`);
    run("kill", ["-9", pid], { quiet: true });
  }
}

stopPort(3000);
rmSync("apps/web/.next", { recursive: true, force: true });
console.log("Removed apps/web/.next.");

const child = spawn("sh", ["-c", "npm run dev:web > /tmp/mts-lbmp-web.log 2>&1"], {
  detached: true,
  stdio: "ignore"
});
child.unref();

console.log("Started web dev server. Log: /tmp/mts-lbmp-web.log");
console.log("Wait for Next.js to finish compiling, then refresh the APK.");
