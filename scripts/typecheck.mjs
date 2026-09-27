#!/usr/bin/env node
/**
 * Typechecks all workspace packages (tsc --noEmit each tsconfig).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");

const scopes = ["packages", "services", "apps"];
const configs = [];
for (const scope of scopes) {
  const dir = path.join(root, scope);
  if (!existsSync(dir)) continue;
  for (const pkg of readdirSync(dir)) {
    const cfg = path.join(dir, pkg, "tsconfig.json");
    if (existsSync(cfg)) configs.push(cfg);
  }
}

let failed = false;
for (const cfg of configs) {
  const rel = path.relative(root, cfg);
  const res = spawnSync(process.execPath, [tsc, "--noEmit", "-p", cfg], { encoding: "utf-8" });
  if (res.status !== 0) {
    failed = true;
    console.error(`✗ ${rel}\n${res.stdout}${res.stderr}`);
  } else {
    console.log(`✓ ${rel}`);
  }
}
process.exit(failed ? 1 : 0);
