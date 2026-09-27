import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDb } from "@cockpit/db";
import { seed, SEED } from "@cockpit/db";
import { remember, recall, approveMemory, expireMemory, deleteMemory, exportMemories, updateMemoryContent, expireStaleMemories, recordLesson, getMemory } from "../src/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let db: ReturnType<typeof openDb>;
const ORG = SEED.org.id;

beforeAll(() => {
  db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "mem-")), "t.db"));
  seed(db);
});

afterAll(() => db.close());

describe("memory governance", () => {
  it("human memories are approved; agent memories require human approval", () => {
    const human = remember(db, {
      organizationId: ORG, scope: "project", kind: "preference",
      content: "This team uses pnpm workspaces.", createdBy: "human",
      sourceRefs: ["user statement"],
    });
    expect(human.row.approved).toBe(1);
    expect(human.requiresApproval).toBe(false);

    const agent = remember(db, {
      organizationId: ORG, scope: "project", kind: "lesson",
      content: "Run tests with --experimental-strip-types on Node 22.",
      createdBy: "agent", sourceRefs: ["run_1 evidence"],
    });
    expect(agent.row.approved).toBe(0);
    expect(agent.requiresApproval).toBe(true);

    // unapproved agent memory must NOT appear in retrieval
    const recalled = recall(db, { organizationId: ORG });
    expect(recalled.some((r) => r.id === agent.row.id)).toBe(false);

    approveMemory(db, agent.row.id);
    const after = recall(db, { organizationId: ORG });
    expect(after.some((r) => r.id === agent.row.id)).toBe(true);
  });

  it("redacts secrets before storing", () => {
    const { row } = remember(db, {
      organizationId: ORG, scope: "task", kind: "fact",
      content: "the token is ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      createdBy: "human",
    });
    expect(row.content).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(row.content).toContain("[REDACTED]");
  });

  it("restricted sensitivity expires automatically", () => {
    const { row } = remember(db, {
      organizationId: ORG, scope: "task", kind: "artifact",
      content: "screenshot containing restricted data",
      createdBy: "human", sensitivity: "restricted",
    });
    expect(row.expires_at).not.toBeNull();
  });

  it("user/team scope is visible across projects; project scope filters", () => {
    // memories.project_id references projects(id); insert real rows for the test
    const now = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO projects (id, organization_id, name, source_type, source_ref, permission_mode, status, repository_map_json, map_version, created_at, updated_at) VALUES (?, ?, ?, 'fixture', 'sample-app', 'read_only', 'ready', NULL, 0, ?, ?)").run("proj_a", ORG, "proj-a", now, now);
    db.prepare("INSERT OR IGNORE INTO projects (id, organization_id, name, source_type, source_ref, permission_mode, status, repository_map_json, map_version, created_at, updated_at) VALUES (?, ?, ?, 'fixture', 'sample-app', 'read_only', 'ready', NULL, 0, ?, ?)").run("proj_b", ORG, "proj-b", now, now);
    remember(db, { organizationId: ORG, projectId: "proj_a", scope: "project", kind: "fact", content: "proj-a specific", createdBy: "human" });
    remember(db, { organizationId: ORG, scope: "user", kind: "preference", content: "prefers concise diffs", createdBy: "human" });
    const forProjB = recall(db, { organizationId: ORG, projectId: "proj_b" });
    expect(forProjB.some((m) => m.content === "proj-a specific")).toBe(false);
    expect(forProjB.some((m) => m.content === "prefers concise diffs")).toBe(true);
    for (const m of forProjB) expect(m.included_because).toBeTruthy();
  });

  it("edit, expire, hard delete, export, and retention sweep all work", () => {
    const { row } = remember(db, { organizationId: ORG, scope: "project", kind: "decision", content: "v1 decision", createdBy: "human" });
    updateMemoryContent(db, row.id, "v2 decision (revised)");
    expect(getMemory(db, row.id)?.content).toBe("v2 decision (revised)");

    const { row: ex } = remember(db, { organizationId: ORG, scope: "task", kind: "fact", content: "to expire", createdBy: "human" });
    expireMemory(db, ex.id);
    expect(recall(db, { organizationId: ORG }).some((m) => m.id === ex.id)).toBe(false);

    const { row: del } = remember(db, { organizationId: ORG, scope: "task", kind: "fact", content: "to delete", createdBy: "human" });
    expect(deleteMemory(db, del.id)?.id).toBe(del.id);
    expect(getMemory(db, del.id)).toBeUndefined();

    const { row: stale } = remember(db, { organizationId: ORG, scope: "task", kind: "fact", content: "stale", createdBy: "human", expiresInDays: 0 });
    expect(expireStaleMemories(db)).toBeGreaterThanOrEqual(1);
    expect(getMemory(db, stale.id)?.status).toBe("expired");

    const dump = exportMemories(db, ORG) as { count: number; memories: unknown[] };
    expect(dump.count).toBeGreaterThan(3);
    expect(dump.memories.length).toBe(dump.count);
  });

  it("recordLesson creates an unapproved agent lesson bound to the run", () => {
    const { row, requiresApproval } = recordLesson(db, {
      organizationId: ORG, projectId: "proj_a", runId: null,
      lesson: "Fixture tests need the glob pattern on Windows.",
      evidenceRefs: ["evt_1", "evt_2"],
    });
    expect(requiresApproval).toBe(true);
    expect(row.kind).toBe("lesson");
  });
});
