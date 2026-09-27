/**
 * Repository parser (Phase 1 "Understand"). Strictly read-only: builds the
 * repository map with confidence labels and source refs. Never writes to the
 * target repository. Large inputs are summarized, never dumped into prompts.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  RepositoryMap,
  TreeNode,
  DirectorySummary,
  MapFact,
} from "@cockpit/contracts";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache", "coverage",
  ".venv", "venv", "__pycache__", ".workspaces", "data", "artifacts",
]);
const MAX_FILES_INDEXED = 5000;

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
  ".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".go": "Go",
  ".rs": "Rust", ".java": "Java", ".rb": "Ruby", ".css": "CSS", ".scss": "SCSS",
  ".sql": "SQL", ".sh": "Shell",
};

export interface ParseProgress {
  phase: "walking" | "detecting" | "summarizing" | "done" | "failed";
  filesIndexed: number;
  message?: string;
}

export interface ParseOptions {
  onProgress?: (p: ParseProgress) => void;
  maxFiles?: number;
}

export async function buildRepositoryMap(
  repoRoot: string,
  opts: ParseOptions = {}
): Promise<RepositoryMap> {
  const root = path.resolve(repoRoot);
  await fs.access(root); // throws if missing -> caller records indexing failure
  const maxFiles = opts.maxFiles ?? MAX_FILES_INDEXED;

  opts.onProgress?.({ phase: "walking", filesIndexed: 0 });
  const files: string[] = [];
  const tree = await walk(root, root, files, maxFiles, 0);

  opts.onProgress?.({ phase: "detecting", filesIndexed: files.length });
  const pkg = await readJson(root, "package.json");
  const languages = detectLanguages(files);
  const framework = detectFramework(pkg, files);
  const packageManager = await detectPackageManager(root);
  const entryPoints = detectEntryPoints(files, pkg);
  const testCommand = detectTestCommand(pkg);
  const buildCommand = detectBuildCommand(pkg);

  opts.onProgress?.({ phase: "summarizing", filesIndexed: files.length });
  const directories = summarizeDirectories(files, languages);
  const facts = buildFacts({
    languages, framework, packageManager, testCommand, buildCommand, entryPoints,
  });
  const unresolved = collectUnresolved(framework, testCommand, packageManager);

  opts.onProgress?.({ phase: "done", filesIndexed: files.length });
  return {
    languages,
    framework,
    package_manager: packageManager,
    entry_points: entryPoints,
    build_command: buildCommand,
    test_command: testCommand,
    tree,
    directories,
    facts,
    unresolved_questions: unresolved,
    map_version: 1,
    generated_at: new Date().toISOString(),
  };
}

// ---------- walk ----------

async function walk(
  absRoot: string,
  currentAbs: string,
  filesOut: string[],
  maxFiles: number,
  depth: number
): Promise<TreeNode> {
  const relPath = path.relative(absRoot, currentAbs).split(path.sep).join("/");
  const node: TreeNode = {
    name: relPath === "" ? path.basename(absRoot) : path.basename(currentAbs),
    path: relPath,
    type: "dir",
    children: [],
  };

  let entries;
  try {
    entries = await fs.readdir(currentAbs, { withFileTypes: true });
  } catch {
    return node;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const e of entries) {
    if (e.isDirectory() && IGNORED_DIRS.has(e.name)) continue;
    const abs = path.join(currentAbs, e.name);
    const rel = path.relative(absRoot, abs).split(path.sep).join("/");
    if (e.isDirectory()) {
      if (depth < 8) {
        node.children!.push(await walk(absRoot, abs, filesOut, maxFiles, depth + 1));
      }
    } else if (e.isFile()) {
      if (filesOut.length >= maxFiles) continue;
      filesOut.push(rel);
      let size: number | undefined;
      try {
        size = (await fs.stat(abs)).size;
      } catch {
        /* ignore */
      }
      node.children!.push({ name: e.name, path: rel, type: "file", size_bytes: size });
    }
  }
  return node;
}

// ---------- helpers ----------

async function readJson(root: string, rel: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(path.join(root, rel), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectLanguages(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const lang = LANGUAGE_BY_EXT[ext];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
}

function detectFramework(pkg: Record<string, unknown> | null, files: string[]): string | null {
  if (pkg) {
    const deps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
    };
    if (deps.next) return "Next.js";
    if (deps["@remix-run/node"] || deps["@remix-run/react"]) return "Remix";
    if (deps.react && deps.vite) return "React + Vite";
    if (deps.react) return "React";
    if (deps.vue) return "Vue";
    if (deps.svelte) return "Svelte";
    if (deps.express) return "Express";
    if (deps.fastify) return "Fastify";
    if (deps.hono) return "Hono";
  }
  if (files.includes("go.mod")) return "Go";
  if (files.includes("Cargo.toml")) return "Rust";
  if (files.includes("requirements.txt") || files.includes("pyproject.toml")) return "Python";
  return null;
}

async function detectPackageManager(root: string): Promise<string | null> {
  for (const [file, name] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
    ["package.json", "npm"],
  ] as const) {
    try {
      await fs.access(path.join(root, file));
      return name;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function detectEntryPoints(files: string[], pkg: Record<string, unknown> | null): string[] {
  const out: string[] = [];
  if (pkg && typeof pkg.main === "string") out.push(pkg.main as string);
  const candidates = ["src/index.ts", "src/main.ts", "index.ts", "src/app/page.tsx", "app/page.tsx", "main.py", "src/main.py", "cmd/main.go"];
  for (const c of candidates) {
    if (files.includes(c)) out.push(c);
  }
  return [...new Set(out)].slice(0, 10);
}

function scriptsOf(pkg: Record<string, unknown> | null): Record<string, string> {
  return ((pkg?.scripts as Record<string, string>) ?? {});
}

function detectTestCommand(pkg: Record<string, unknown> | null): string | null {
  const scripts = scriptsOf(pkg);
  if (scripts.test) return "npm test";
  return null;
}

function detectBuildCommand(pkg: Record<string, unknown> | null): string | null {
  const scripts = scriptsOf(pkg);
  // A build script is a build script regardless of what it invokes.
  if (scripts.build) return "npm run build";
  return null;
}

function summarizeDirectories(files: string[], languages: string[]): DirectorySummary[] {
  const byDir = new Map<string, { count: number; exts: Set<string> }>();
  for (const f of files) {
    const dir = path.posix.dirname(f) === "." ? "" : path.posix.dirname(f);
    const rec = byDir.get(dir) ?? { count: 0, exts: new Set<string>() };
    rec.count++;
    rec.exts.add(path.extname(f).toLowerCase());
    byDir.set(dir, rec);
  }
  const summaries: DirectorySummary[] = [];
  for (const [dir, rec] of byDir) {
    if (dir === "" && rec.count < 3) continue;
    summaries.push({
      path: dir || "(root)",
      file_count: rec.count,
      languages: languages.slice(0, 3),
      purpose: inferPurpose(dir),
      label: "inferred",
    });
  }
  return summaries.sort((a, b) => b.file_count - a.file_count).slice(0, 200);
}

function inferPurpose(dir: string): string {
  const d = dir.toLowerCase();
  if (d.includes("test") || d.includes("spec")) return "Tests";
  if (d.includes("src/app") || d.includes("pages")) return "Application routes/pages";
  if (d.includes("component")) return "UI components";
  if (d.includes("api")) return "API layer";
  if (d.includes("docs")) return "Documentation";
  if (d.includes("scripts")) return "Automation scripts";
  if (d === "(root)" || d === "") return "Project root: config, manifests, docs";
  return "Source files";
}

interface FactInput {
  languages: string[];
  framework: string | null;
  packageManager: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  entryPoints: string[];
}

function buildFacts(f: FactInput): MapFact[] {
  const facts: MapFact[] = [];
  if (f.languages.length) {
    facts.push({
      key: "languages",
      value: f.languages.join(", "),
      editable_by_user: true,
      label: "verified",
      source_refs: ["file extensions"],
    });
  }
  if (f.framework) {
    facts.push({
      key: "framework",
      value: f.framework,
      editable_by_user: true,
      label: "inferred",
      source_refs: ["package.json dependencies"],
    });
  }
  if (f.packageManager) {
    facts.push({
      key: "package_manager",
      value: f.packageManager,
      editable_by_user: true,
      label: "verified",
      source_refs: ["lockfile / package.json"],
    });
  }
  if (f.testCommand) {
    facts.push({
      key: "test_command",
      value: f.testCommand,
      editable_by_user: true,
      label: "verified",
      source_refs: ["package.json scripts.test"],
    });
  } else {
    facts.push({
      key: "test_command",
      value: "unknown",
      editable_by_user: true,
      label: "unknown",
      source_refs: [],
    });
  }
  if (f.buildCommand) {
    facts.push({
      key: "build_command",
      value: f.buildCommand,
      editable_by_user: true,
      label: "verified",
      source_refs: ["package.json scripts.build"],
    });
  }
  if (f.entryPoints.length) {
    facts.push({
      key: "entry_points",
      value: f.entryPoints.join(", "),
      editable_by_user: true,
      label: "inferred",
      source_refs: ["conventional entry files"],
    });
  }
  return facts;
}

function collectUnresolved(
  framework: string | null,
  testCommand: string | null,
  packageManager: string | null
): string[] {
  const q: string[] = [];
  if (!framework) q.push("Which framework does this project use? (map says unknown)");
  if (!testCommand) q.push("What command runs the tests? (no scripts.test found)");
  if (!packageManager) q.push("Which package manager should be used for isolated runs?");
  return q;
}
