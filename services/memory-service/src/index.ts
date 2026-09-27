/**
 * Memory service (Phase 4 "Remember") — governed, scoped project memory.
 * Patterns: rohitg00/agentmemory (lifecycle, confidence) + master prompt §Phase 4.
 *
 * Policies enforced here:
 *  - agent-written memories start unapproved; a human approves before they
 *    can influence future runs (first-save checkpoint),
 *  - sensitive scopes require explicit sensitivity labels and expire,
 *  - retrieval only returns approved, unexpired, scoped rows and explains
 *    why each was included (source refs + scope match),
 *  - users can inspect, edit, approve, expire, export, and hard-delete.
 */
import type { Database as DB } from "better-sqlite3";
import {
  insertMemory,
  getMemory,
  listMemories,
  updateMemoryContent,
  approveMemory,
  expireMemory,
  deleteMemory,
  expireStaleMemories,
  exportMemories,
  newEntityId,
  type MemoryRow,
} from "@cockpit/db";
import { redactSecrets } from "@cockpit/policy";

export const MEMORY_POLICY_VERSION = "1.0.0";

/** Retention: restricted memories expire after 30 days unless renewed. */
const RESTRICTED_TTL_MS = 30 * 24 * 3600 * 1000;

export interface RememberInput {
  organizationId: string;
  projectId?: string | null;
  runId?: string | null;
  scope: MemoryRow["scope"];
  kind: MemoryRow["kind"];
  content: string;
  sourceRefs?: string[];
  confidence?: number;
  createdBy: "human" | "agent" | "import";
  sensitivity?: MemoryRow["sensitivity"];
  expiresInDays?: number | null;
}

export function remember(db: DB, input: RememberInput): { row: MemoryRow; requiresApproval: boolean } {
  const content = redactSecrets(input.content).redacted;
  const sensitivity = input.sensitivity ?? (input.createdBy === "agent" ? "internal" : "internal");
  const requiresApproval = input.createdBy === "agent"; // human checkpoint on first agent save
  const expiresAt =
    input.expiresInDays != null
      ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
      : sensitivity === "restricted"
        ? new Date(Date.now() + RESTRICTED_TTL_MS).toISOString()
        : null;

  const row = insertMemory(db, {
    id: newEntityId("mem"),
    organization_id: input.organizationId,
    project_id: input.projectId ?? null,
    run_id: input.runId ?? null,
    scope: input.scope,
    kind: input.kind,
    content,
    source_refs_json: JSON.stringify(input.sourceRefs ?? []),
    confidence: Math.min(Math.max(input.confidence ?? (input.createdBy === "human" ? 0.9 : 0.6), 0), 1),
    created_by: input.createdBy,
    approved: requiresApproval ? 0 : 1,
    sensitivity,
    expires_at: expiresAt,
  });
  return { row, requiresApproval };
}

export interface RecalledMemory {
  id: string;
  scope: MemoryRow["scope"];
  kind: MemoryRow["kind"];
  content: string;
  confidence: number;
  source_refs: string[];
  included_because: string;
}

/**
 * Retrieval for a run: approved + unexpired + project-scoped (+ user/team
 * memories). Every row explains why it was included — no opaque context.
 */
export function recall(db: DB, opts: { organizationId: string; projectId?: string | null; kinds?: MemoryRow["kind"][]; limit?: number }): RecalledMemory[] {
  const rows = listMemories(db, {
    organizationId: opts.organizationId,
    projectId: opts.projectId ?? null,
    limit: opts.limit ?? 40,
  });
  return rows
    .filter((r) => !opts.kinds || opts.kinds.includes(r.kind))
    .map((r) => ({
      id: r.id,
      scope: r.scope,
      kind: r.kind,
      content: r.content,
      confidence: r.confidence,
      source_refs: JSON.parse(r.source_refs_json) as string[],
      included_because:
        r.scope === "project"
          ? "project-scoped memory approved for this project"
          : r.scope === "team"
            ? "team-scoped memory visible to all projects"
            : "user-scoped memory visible to this user",
    }));
}

/** Lessons from completed runs feed the next plan (Phase 9 seed). */
export function recordLesson(db: DB, input: { organizationId: string; projectId: string; runId: string | null; lesson: string; evidenceRefs: string[] }): { row: MemoryRow; requiresApproval: boolean } {
  return remember(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    runId: input.runId,
    scope: "project",
    kind: "lesson",
    content: input.lesson,
    sourceRefs: input.evidenceRefs,
    createdBy: "agent",
    confidence: 0.7,
  });
}

export {
  getMemory,
  listMemories,
  updateMemoryContent,
  approveMemory,
  expireMemory,
  deleteMemory,
  expireStaleMemories,
  exportMemories,
  type MemoryRow,
} from "@cockpit/db";
