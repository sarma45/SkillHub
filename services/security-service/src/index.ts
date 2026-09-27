export * from "./manifest.js";
export * from "./scanner.js";

import path from "node:path";

/** Absolute path to a bundled fixture repo (resolves from repo root). */
export function fixturePath(fixtureId: string): string {
  const root = process.env.COCKPIT_REPO_ROOT ?? process.cwd();
  return path.join(root, "fixtures", fixtureId);
}

export function resolveFixtureRoot(fixtureId: string): string {
  return fixturePath(fixtureId);
}

/** Directory containing bundled fixtures (used by worker + tests). */
export function fixturesDir(): string {
  const root = process.env.COCKPIT_REPO_ROOT ?? process.cwd();
  return path.join(root, "fixtures");
}

/** Path of the local vulnerable safe-lab target. */
export function vulnerableAppPath(): string {
  const root = process.env.COCKPIT_REPO_ROOT ?? process.cwd();
  return path.join(root, "security-fixtures", "vulnerable-app");
}

/** Preflight for the Security page: is the real Strix binary usable? */
export async function strixStatus(): Promise<{
  binary: string | null;
  binary_source: "STRIX_BIN" | "PATH" | null;
  version: string | null;
  ready: boolean;
  checklist: string[];
}> {
  const configured = process.env.STRIX_BIN;
  const candidates = configured ? [configured] : ["strix", "strix.exe"];
  for (const bin of candidates) {
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const { spawn } = require("node:child_process") as typeof import("node:child_process");
        const p = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"], timeout: 6000, shell: /win/i.test(process.platform) });
        let s = "";
        p.stdout?.on("data", (d: Buffer) => (s += String(d)));
        p.on("error", reject);
        p.on("close", (code) => (code === 0 ? resolve(s.trim()) : reject(new Error("exit " + code))));
      });
      return {
        binary: bin,
        binary_source: configured ? "STRIX_BIN" : "PATH",
        version: out.split("\n")[0]?.slice(0, 60) ?? null,
        ready: true,
        checklist: [],
      };
    } catch {
      /* try next */
    }
  }
  return {
    binary: null,
    binary_source: null,
    version: null,
    ready: false,
    checklist: [
      "Install Python 3.12+ (winget install Python.Python.3.12)",
      "Install pipx and Strix: pipx install strix-agent",
      "Install and start Docker Desktop (Strix runs its sandbox in Docker)",
      "Provide an LLM key (e.g. ANTHROPIC_API_KEY) — Strix agents need a model",
      "Set STRIX_BIN to the strix executable path, or add it to PATH",
    ],
  };
}
