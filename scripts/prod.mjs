#!/usr/bin/env node
/**
 * Production launcher (audit fix #4): starts the built web app (`next start`)
 * and the worker against the repo-root DB/workspaces. Run `npm run build`
 * first (or use this script, which builds if .next is missing).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const procs = [];

function start(name, args, opts = {}) {
  const proc = spawn(process.execPath, args, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, COCKPIT_REPO_ROOT: process.env.COCKPIT_REPO_ROOT ?? root, NEXT_TELEMETRY_DISABLED: "1", ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `[${name}]`;
  const forward = (stream, out) => {
    stream.on("data", (d) => {
      for (const line of String(d).split("\n").filter(Boolean)) out(`${prefix} ${line}`);
    });
  };
  forward(proc.stdout, console.log);
  forward(proc.stderr, console.error);
  proc.on("exit", (code) => console.log(`${prefix} exited (${code})`));
  procs.push(proc);
  return proc;
}

const webDir = path.join(root, "apps/web");
// npm workspaces hoist next to the root node_modules; fall back to the
// workspace copy for pnpm-style layouts.
const nextBin = [
  path.join(root, "node_modules/next/dist/bin/next"),
  path.join(webDir, "node_modules/next/dist/bin/next"),
].find((p) => existsSync(p));
if (!nextBin) {
  console.error("next binary not found — run `npm install` first.");
  process.exit(1);
}
if (!existsSync(path.join(webDir, ".next/BUILD_ID"))) {
  console.log("No production build found — building web…");
  const build = spawn(process.execPath, [nextBin, "build"], { cwd: webDir, stdio: "inherit" });
  await new Promise((resolve) => build.on("exit", resolve));
}

console.log("AI Engineering Cockpit — production");
console.log("  web/api: http://localhost:" + (process.env.PORT ?? "3000"));
console.log("  worker : polling for jobs");
if (!process.env.COCKPIT_AUTH_PASSWORD) {
  console.log("  ⚠ COCKPIT_AUTH_PASSWORD is NOT set — running in local single-user mode.");
  console.log("    Set it before exposing this service to any network.");
}
if (!process.env.COCKPIT_ALLOWED_ROOTS) {
  console.log("  ℹ COCKPIT_ALLOWED_ROOTS unset — imports bounded to the repo root.");
}
console.log("  Press Ctrl+C to stop both.\n");

start("web", [nextBin, "start", "-p", process.env.PORT ?? "3000"], { cwd: webDir });
start("worker", ["--import", "tsx", "apps/worker/src/main.ts"]);

const stop = () => {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
