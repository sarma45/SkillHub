#!/usr/bin/env node
/**
 * One documented command starts web+API and the worker (TRD §14 local dev).
 * Usage: npm run dev
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const procs = [];

function start(name, args, opts = {}) {
  const proc = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `[${name}]`;
  const forward = (stream, out) => {
    stream.on("data", (d) => {
      for (const line of String(d).split("\n").filter(Boolean)) {
        out(`${prefix} ${line}`);
      }
    });
  };
  forward(proc.stdout, console.log);
  forward(proc.stderr, console.error);
  proc.on("exit", (code) => console.log(`${prefix} exited (${code})`));
  procs.push(proc);
  return proc;
}

console.log("AI Engineering Cockpit — local dev");
console.log("  web/api: http://localhost:3000");
console.log("  worker : polling for jobs");
console.log("  Press Ctrl+C to stop both.\n");

start("web", ["node_modules/next/dist/bin/next", "dev", "-p", "3000"], { cwd: path.join(root, "apps/web") });
start("worker", ["--import", "tsx", "apps/worker/src/main.ts"]);

function shutdown() {
  for (const p of procs) {
    try {
      p.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
