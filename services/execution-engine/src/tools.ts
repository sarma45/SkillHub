/**
 * Typed tools (master prompt "Tool contract"). Every tool declares schemas,
 * side effects, risk, scopes, undo strategy. Scope checks happen HERE in code,
 * deny-by-default — never in prompts.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ToolContract, ToolResult } from "@cockpit/contracts";
import { redactSecrets, isSensitivePath } from "@cockpit/policy";
import type { Scope } from "@cockpit/policy";

export interface ToolContext {
  /** absolute workspace root; all paths resolved under it */
  workspaceRoot: string;
  grantedScopes: readonly Scope[];
  /** called for each executed tool with redacted receipt payload */
  receipt: (payload: Record<string, unknown>) => void;
  /** signals cancellation between operations */
  throwIfCancelled: () => void;
  timeoutMs: number;
}

export interface ToolImplementation {
  contract: ToolContract;
  run(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult>;
}

export class ToolScopeDenied extends Error {
  constructor(public readonly tool: string, public readonly required: readonly string[]) {
    super(`Tool ${tool} denied: missing scopes [${required.join(", ")}]`);
    this.name = "ToolScopeDenied";
  }
}

function assertToolScopes(ctx: ToolContext, tool: ToolContract): void {
  const missing = tool.required_scopes.filter((s) => !ctx.grantedScopes.includes(s as Scope));
  if (missing.length > 0) throw new ToolScopeDenied(tool.name, missing);
}

/** Resolve + confine a user-supplied relative path under the workspace root. */
function safeJoin(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  return abs;
}

function result(ok: boolean, summary: string, bytes: number, outputRef: string | null = null): ToolResult {
  return { ok, summary: summary.slice(0, 2000), bytes, output_ref: outputRef };
}

const readInput = {
  type: "object",
  properties: { path: { type: "string" }, max_bytes: { type: "number" } },
  required: ["path"],
} as const;

const searchInput = {
  type: "object",
  properties: { query: { type: "string" }, glob: { type: "string" } },
  required: ["query"],
} as const;

const listInput = { type: "object", properties: { path: { type: "string" } } } as const;

const editInput = {
  type: "object",
  properties: {
    path: { type: "string" },
    action: { type: "string", enum: ["create", "append", "replace"] },
    content: { type: "string" },
    find: { type: "string" },
    create_dirs: { type: "boolean" },
  },
  required: ["path", "action"],
} as const;

const runTestsInput = {
  type: "object",
  properties: { command: { type: "string" }, timeout_ms: { type: "number" } },
} as const;

const diffInput = { type: "object", properties: {} } as const;

// ---------- read_file ----------

export const read_file: ToolImplementation = {
  contract: {
    name: "read_file",
    description: "Read a bounded text file from the isolated workspace.",
    input_schema: readInput,
    output_schema: { type: "object" },
    side_effects: ["read_workspace"],
    risk_level: "low",
    required_scopes: ["workspace:read"],
    undo_strategy: "n/a (read-only)",
    timeout_ms: 10_000,
    idempotency: "workspace_pure",
  },
  async run(ctx, input) {
    assertToolScopes(ctx, this.contract);
    ctx.throwIfCancelled();
    const rel = String(input.path ?? "");
    const abs = safeJoin(ctx.workspaceRoot, rel);
    if (isSensitivePath(rel)) {
      ctx.receipt({ tool: "read_file", path: rel, blocked: "sensitive-path" });
      return result(false, `blocked: ${rel} is a sensitive path; content not read into context`, 0);
    }
    const max = Math.min(Number(input.max_bytes ?? 64 * 1024), 256 * 1024);
    const stat = await fs.stat(abs);
    if (stat.size > max) {
      return result(true, `truncated receipt: file is ${stat.size} bytes (limit ${max}); read in chunks`, stat.size, null);
    }
    const content = await fs.readFile(abs, "utf-8");
    const r = redactSecrets(content);
    ctx.receipt({ tool: "read_file", path: rel, bytes: content.length, redacted: r.changed });
    return result(true, `read ${rel} (${content.length} bytes)`, content.length);
  },
};

// ---------- search ----------

export const search: ToolImplementation = {
  contract: {
    name: "search",
    description: "Search file contents in the workspace for a literal query.",
    input_schema: searchInput,
    output_schema: { type: "object" },
    side_effects: ["read_workspace"],
    risk_level: "low",
    required_scopes: ["workspace:read"],
    undo_strategy: "n/a (read-only)",
    timeout_ms: 15_000,
    idempotency: "workspace_pure",
  },
  async run(ctx, input) {
    assertToolScopes(ctx, this.contract);
    ctx.throwIfCancelled();
    const query = String(input.query ?? "");
    const root = ctx.workspaceRoot;
    const hits: string[] = [];
    const stack = [root];
    let scanned = 0;
    outer: while (stack.length) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(abs);
        else if (e.isFile()) {
          if (scanned++ > 2000) break outer;
          if (isSensitivePath(path.relative(root, abs))) continue;
          try {
            if ((await fs.stat(abs)).size > 512 * 1024) continue;
            const text = await fs.readFile(abs, "utf-8");
            if (text.includes(query)) {
              hits.push(path.relative(root, abs).split(path.sep).join("/"));
              if (hits.length >= 50) break outer;
            }
          } catch {
            /* binary or unreadable */
          }
        }
      }
    }
    const summary = `search "${query.slice(0, 40)}": ${hits.length} file(s) matched`;
    ctx.receipt({ tool: "search", query: query.slice(0, 100), hits: hits.length });
    return result(hits.length > 0, summary + (hits.length ? `: ${hits.slice(0, 10).join(", ")}` : ""), summary.length);
  },
};

// ---------- list_tree ----------

export const list_tree: ToolImplementation = {
  contract: {
    name: "list_tree",
    description: "List directory entries in the workspace.",
    input_schema: listInput,
    output_schema: { type: "object" },
    side_effects: ["read_workspace"],
    risk_level: "low",
    required_scopes: ["workspace:read"],
    undo_strategy: "n/a (read-only)",
    timeout_ms: 10_000,
    idempotency: "workspace_pure",
  },
  async run(ctx, input) {
    assertToolScopes(ctx, this.contract);
    ctx.throwIfCancelled();
    const rel = String(input.path ?? "");
    const abs = safeJoin(ctx.workspaceRoot, rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const names = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).slice(0, 200);
    const summary = `${rel || "."}: ${names.join(", ")}`;
    ctx.receipt({ tool: "list_tree", path: rel, count: entries.length });
    return result(true, summary, summary.length);
  },
};

// ---------- edit_file ----------

export const edit_file: ToolImplementation = {
  contract: {
    name: "edit_file",
    description: "Create, append to, or replace text in one file inside the isolated workspace.",
    input_schema: editInput,
    output_schema: { type: "object" },
    side_effects: ["write_workspace"],
    risk_level: "medium",
    required_scopes: ["workspace:write"],
    undo_strategy: "workspace is disposable; git-tracked diff allows revert before integration",
    timeout_ms: 10_000,
    idempotency: "workspace_pure",
  },
  async run(ctx, input) {
    assertToolScopes(ctx, this.contract);
    ctx.throwIfCancelled();
    const rel = String(input.path ?? "");
    if (isSensitivePath(rel)) {
      ctx.receipt({ tool: "edit_file", path: rel, blocked: "sensitive-path" });
      return result(false, `blocked: editing ${rel} is not allowed (sensitive path policy)`, 0);
    }
    const abs = safeJoin(ctx.workspaceRoot, rel);
    const action = String(input.action ?? "");
    const content = String(input.content ?? "");

    if (action === "create") {
      if (input.create_dirs) await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, { flag: "wx" }); // fails if exists: atomic create
      ctx.receipt({ tool: "edit_file", path: rel, action, bytes: content.length });
      return result(true, `created ${rel} (${content.length} bytes)`, content.length);
    }
    if (action === "append") {
      await fs.appendFile(abs, content);
      ctx.receipt({ tool: "edit_file", path: rel, action, bytes: content.length });
      return result(true, `appended ${content.length} bytes to ${rel}`, content.length);
    }
    if (action === "replace") {
      const find = String(input.find ?? "");
      if (!find) return result(false, "replace requires non-empty find", 0);
      const before = await fs.readFile(abs, "utf-8");
      if (!before.includes(find)) {
        ctx.receipt({ tool: "edit_file", path: rel, action, matched: false });
        return result(false, `find-text not present in ${rel}; no change made`, 0);
      }
      const after = before.replace(find, content);
      await fs.writeFile(abs, after);
      ctx.receipt({ tool: "edit_file", path: rel, action, matched: true, bytes: content.length });
      return result(true, `replaced ${find.length} bytes in ${rel}`, content.length);
    }
    return result(false, `unknown action ${action}`, 0);
  },
};

// ---------- run_tests ----------

/** Allowed command prefixes: no arbitrary shell. Type stripping runs fixture TS on Node 22+. */
const ALLOWED_COMMANDS: Array<{ prefix: string; argv: (cwd: string) => string[] }> = [
  { prefix: "npm test", argv: () => ["node", "--experimental-strip-types", "--test", "tests/*.test.ts"] },
  { prefix: "node --test", argv: () => ["node", "--experimental-strip-types", "--test", "tests/*.test.ts"] },
];

export const run_tests: ToolImplementation = {
  contract: {
    name: "run_tests",
    description: "Run the repository's configured test command in the workspace (allowlisted).",
    input_schema: runTestsInput,
    output_schema: { type: "object" },
    side_effects: ["read_workspace", "write_workspace"],
    risk_level: "medium",
    required_scopes: ["workspace:read"],
    undo_strategy: "n/a (tests are side-effect free for fixtures)",
    timeout_ms: 120_000,
    idempotency: "workspace_pure",
  },
  async run(ctx, input) {
    assertToolScopes(ctx, this.contract);
    ctx.throwIfCancelled();
    const command = String(input.command ?? "npm test");
    const allowed = ALLOWED_COMMANDS.find((a) => command.startsWith(a.prefix));
    if (!allowed) {
      ctx.receipt({ tool: "run_tests", command, denied: "not-allowlisted" });
      return result(false, `command not allowlisted: ${command.slice(0, 80)}`, 0);
    }
    const timeout = Math.min(Number(input.timeout_ms ?? 120_000), 120_000);
    const started = Date.now();
    try {
      const argv = allowed.argv(ctx.workspaceRoot);
      const bin = argv[0] ?? "node";
      const args = argv.slice(1);
      const proc = spawn(bin, args, {
        cwd: ctx.workspaceRoot,
        timeout,
        env: { ...process.env, NODE_OPTIONS: "" },
        stdio: ["ignore", "pipe", "pipe"] as const,
      });
      const { code, stdout } = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
        let out = "";
        proc.stdout?.on("data", (d: Buffer) => (out += String(d).slice(0, 200_000)));
        proc.on("error", () => resolve({ code: -1, stdout: out }));
        proc.on("close", (c: number | null) => resolve({ code: c, stdout: out }));
      });
      const r = redactSecrets(stdout);
      const tail = r.redacted.split("\n").filter(Boolean).slice(-12).join("\n");
      ctx.receipt({ tool: "run_tests", command, exit_code: code, duration_ms: Date.now() - started, redacted: r.changed });
      return result(
        code === 0,
        code === 0 ? `tests passed (${Date.now() - started} ms)` : `tests failed exit=${code}\n${tail.slice(0, 1200)}`,
        stdout.length
      );
    } catch (err) {
      return result(false, `test runner error: ${err instanceof Error ? err.message : "unknown"}`, 0);
    }
  },
};

// ---------- compute_diff ----------

export const compute_diff: ToolImplementation = {
  contract: {
    name: "compute_diff",
    description: "Produce a unified diff of every changed file in the workspace vs. the pristine copy.",
    input_schema: diffInput,
    output_schema: { type: "object" },
    side_effects: ["read_workspace"],
    risk_level: "low",
    required_scopes: ["workspace:read"],
    undo_strategy: "n/a (read-only)",
    timeout_ms: 30_000,
    idempotency: "workspace_pure",
  },
  async run(ctx) {
    assertToolScopes(ctx, this.contract);
    ctx.throwIfCancelled();
    // executed via workspace.diffAgainstPristine(); this tool-form is used by the loop
    return result(true, "diff delegated to workspace snapshot", 0);
  },
};

export const TOOLS: Record<string, ToolImplementation> = {
  read_file,
  search,
  list_tree,
  edit_file,
  run_tests,
  compute_diff,
};

export function toolContractList(): ToolContract[] {
  return Object.values(TOOLS).map((t) => t.contract);
}
