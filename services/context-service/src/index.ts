/**
 * Context service (Phase 1/4) — hierarchical, budgeted context assembly.
 * Pattern: volcengine/OpenViking (org → project → directory → file layers).
 *
 * Builds a context bundle for planning/execution: project identity layer,
 * map summary layer, relevant directory summaries, memory layer, and exact
 * file excerpts — each item carrying provenance and an inclusion reason.
 * Hard character budget: large inputs are summarized, never dumped.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RepositoryMap } from "@cockpit/contracts";
import { recall, type RecalledMemory } from "@cockpit/memory-service";
import type { Database as DB } from "better-sqlite3";

export const CONTEXT_POLICY_VERSION = "1.0.0";

export const DEFAULT_BUDGET_CHARS = 24_000;

export interface ContextItem {
  layer: "project" | "map" | "directory" | "file" | "memory";
  ref: string;
  content: string;
  inclusion_reason: string;
  label: "verified" | "inferred" | "observed" | "unknown";
}

export interface ContextBundle {
  project_id: string;
  budget_chars: number;
  used_chars: number;
  items: ContextItem[];
  truncated: string[];
}

export interface AssembleOptions {
  organizationId: string;
  projectId: string;
  projectRoot: string;
  map: RepositoryMap;
  taskRequest: string;
  budgetChars?: number;
  includeMemory?: boolean;
}

/** Keyword overlap scoring: task words vs directory purpose/path. */
function scoreDirectory(dirPath: string, purpose: string, task: string): number {
  const t = task.toLowerCase();
  const words = t.split(/\W+/).filter((w) => w.length > 3);
  const hay = `${dirPath} ${purpose}`.toLowerCase();
  let score = 0;
  for (const w of words) if (hay.includes(w)) score += 2;
  if (hay.includes("auth") && t.includes("login")) score += 4;
  if (hay.includes("test") && (t.includes("test") || t.includes("verify"))) score += 3;
  return score;
}

export async function assembleContextBundle(opts: AssembleOptions): Promise<ContextBundle> {
  const budget = opts.budgetChars ?? DEFAULT_BUDGET_CHARS;
  const items: ContextItem[] = [];
  const truncated: string[] = [];
  let used = 0;

  const push = (item: ContextItem): boolean => {
    if (used + item.content.length > budget) {
      truncated.push(item.ref);
      return false;
    }
    items.push(item);
    used += item.content.length;
    return true;
  };

  // Layer 1: project identity (always included)
  push({
    layer: "project",
    ref: `project:${opts.projectId}`,
    content: `Project ${opts.projectId}. Languages: ${opts.map.languages.join(", ")}. Framework: ${opts.map.framework ?? "unknown"}. Package manager: ${opts.map.package_manager ?? "unknown"}. Test: ${opts.map.test_command ?? "unknown"}.`,
    inclusion_reason: "project identity is always in context",
    label: "verified",
  });

  // Layer 2: relevant directory summaries (ranked by task overlap)
  const ranked = [...opts.map.directories]
    .map((d) => ({ d, score: scoreDirectory(d.path, d.purpose, opts.taskRequest) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  for (const { d, score } of ranked) {
    push({
      layer: "directory",
      ref: `dir:${d.path}`,
      content: `${d.path} — ${d.purpose} (${d.file_count} files; ${d.languages.join(", ")})`,
      inclusion_reason: score > 0 ? `matches task keywords (score ${score})` : "top-level structure",
      label: d.label === "inferred" ? "inferred" : "observed",
    });
  }

  // Layer 3: memory (approved only; explains itself)
  if (opts.includeMemory !== false) {
    const memories: RecalledMemory[] = recall(db0(opts), { organizationId: opts.organizationId, projectId: opts.projectId, limit: 10 });
    for (const m of memories) {
      push({
        layer: "memory",
        ref: `memory:${m.id}`,
        content: `[${m.kind}] ${m.content}`,
        inclusion_reason: m.included_because,
        label: "observed",
      });
    }
  }

  // Layer 4: exact file excerpts for the highest-scoring directories
  for (const { d } of ranked.slice(0, 2)) {
    if (d.path === "(root)") continue;
    const absDir = path.join(opts.projectRoot, d.path);
    try {
      const entries = await fs.readdir(absDir, { withFileTypes: true });
      const codeFiles = entries.filter((e) => e.isFile() && /\.(ts|tsx|js|py|go)$/.test(e.name)).slice(0, 2);
      for (const f of codeFiles) {
        const rel = path.join(d.path, f.name).split(path.sep).join("/");
        try {
          const raw = await fs.readFile(path.join(absDir, f.name), "utf-8");
          const excerpt = raw.length > 1500 ? raw.slice(0, 1500) + "\n/* … truncated; full file available on request */" : raw;
          push({
            layer: "file",
            ref: `file:${rel}`,
            content: excerpt,
            inclusion_reason: `exact source from a high-relevance directory (${d.path})`,
            label: "verified",
          });
        } catch {
          truncated.push(`file:${rel}`);
        }
      }
    } catch {
      truncated.push(`dir:${d.path}`);
    }
  }

  return { project_id: opts.projectId, budget_chars: budget, used_chars: used, items, truncated };
}

/** db handle comes from the caller in the app layer; indirection keeps this testable */
import type { Database as DB2 } from "better-sqlite3";
function db0(_opts: AssembleOptions): DB2 {
  return globalThis.__cockpitDb as DB2;
}

declare global {
  // eslint-disable-next-line no-var
  var __cockpitDb: DB2 | undefined;
}

export function setContextDb(db: DB): void {
  globalThis.__cockpitDb = db;
}
