/**
 * Isolated workspace (Phase 3 "Execute"): a disposable copy of the target
 * repository. All agent edits happen here; the source repository is never
 * touched. Provides pristine snapshots for diffing and full teardown.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export class Workspace {
  constructor(
    public readonly root: string,
    private readonly pristineRoot: string
  ) {}

  static async create(baseDir: string, workspaceId: string, sourceRoot: string): Promise<Workspace> {
    const root = path.join(baseDir, workspaceId);
    const pristineRoot = `${root}__pristine`;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(pristineRoot, { recursive: true, force: true });
    await copyDir(sourceRoot, root);
    await copyDir(sourceRoot, pristineRoot);
    return new Workspace(root, pristineRoot);
  }

  /** Files that differ from the pristine snapshot (relative posix paths). */
  async changedFiles(): Promise<string[]> {
    const changed: string[] = [];
    await diffDirs(this.pristineRoot, this.root, "", changed);
    return changed;
  }

  /** Unified-ish diff for the review UI (bounded per file). */
  async diff(maxBytes = 512 * 1024): Promise<{ files: Array<{ path: string; patch: string; bytes_added: number; bytes_removed: number }>; total_bytes: number }> {
    const changed = await this.changedFiles();
    const files: Array<{ path: string; patch: string; bytes_added: number; bytes_removed: number }> = [];
    let total = 0;
    for (const rel of changed) {
      const before = await safeRead(path.join(this.pristineRoot, rel));
      const after = await safeRead(path.join(this.root, rel));
      const patch = unifiedDiff(rel, before, after);
      total += patch.length;
      if (total > maxBytes) break;
      files.push({
        path: rel,
        patch,
        bytes_added: countAdded(patch),
        bytes_removed: countRemoved(patch),
      });
    }
    return { files, total_bytes: total };
  }

  async hashAll(): Promise<string> {
    const changed = await this.changedFiles();
    const h = createHash("sha256");
    for (const rel of changed.sort()) {
      h.update(rel);
      h.update(await safeRead(path.join(this.root, rel)));
    }
    return h.digest("hex");
  }

  async destroy(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
    await fs.rm(this.pristineRoot, { recursive: true, force: true });
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

const IGNORE = new Set(["node_modules", ".git", ".next", "dist", "coverage", ".workspaces", "data"]);

async function diffDirs(a: string, b: string, rel: string, out: string[]): Promise<void> {
  const [aEntries, bEntries] = await Promise.all([
    safeReaddir(a),
    safeReaddir(b),
  ]);
  const names = new Set([...aEntries.map((e) => e.name), ...bEntries.map((e) => e.name)]);
  for (const name of [...names].sort()) {
    if (IGNORE.has(name)) continue;
    const relChild = rel ? `${rel}/${name}` : name;
    const aAbs = path.join(a, name);
    const bAbs = path.join(b, name);
    const aIsDir = aEntries.find((e) => e.name === name)?.isDirectory() ?? false;
    const bIsDir = bEntries.find((e) => e.name === name)?.isDirectory() ?? false;
    if (aIsDir || bIsDir) {
      await diffDirs(aAbs, bAbs, relChild, out);
    } else {
      const [aTxt, bTxt] = await Promise.all([safeRead(aAbs), safeRead(bAbs)]);
      if (aTxt !== bTxt) out.push(relChild);
    }
  }
}

async function safeRead(abs: string): Promise<string> {
  try {
    return await fs.readFile(abs, "utf-8");
  } catch {
    return "";
  }
}

async function safeReaddir(abs: string) {
  try {
    return await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
}

// ---------- minimal unified diff ----------

export function unifiedDiff(relPath: string, before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const lines: string[] = [`--- a/${relPath}`, `+++ b/${relPath}`];

  // LCS-based line diff (bounded input sizes)
  const n = a.length;
  const m = b.length;
  const MAX = 4000;
  if (n > MAX || m > MAX) {
    lines.push(`@@ file too large for inline diff (${n}/${m} lines) @@`);
    return lines.join("\n");
  }
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? (lcs[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]?.[j] ?? 0, lcs[i]?.[j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < n) {
    lines.push(`- ${a[i]}`);
    i++;
  }
  while (j < m) {
    lines.push(`+ ${b[j]}`);
    j++;
  }
  return lines.join("\n");
}

function countAdded(patch: string): number {
  return patch.split("\n").filter((l) => l.startsWith("+ ")).length;
}

function countRemoved(patch: string): number {
  return patch.split("\n").filter((l) => l.startsWith("- ")).length;
}
