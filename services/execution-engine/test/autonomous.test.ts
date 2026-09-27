import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, seed, getProject, insertProject, insertTask, newEntityId } from "@cockpit/db";
import { executePlan } from "../src/engine.js";
import { runAutonomous, buildAutonomousTools } from "../src/autonomous.js";
import { makeRememberTool, makeBrowserVerifyTool } from "../src/agent-tools.js";
import { ScriptedToolAdapter } from "@cockpit/model-gateway";
import type { PlanDocument } from "@cockpit/contracts";
import { ROLE_SCOPES } from "@cockpit/policy";

let db: ReturnType<typeof openDb>;
let baseDir: string;
const ORG = "org_local";

beforeAll(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "auto-"));
  db = openDb(path.join(baseDir, "t.db"));
  seed(db);
});

afterAll(() => db.close());

function tinyPlan(): PlanDocument {
  return {
    goal: "add a marker function",
    success_criteria: ["marker exists"],
    non_goals: [],
    assumptions: [],
    steps: [
      { id: "s1", title: "read", depends_on: [], tools: ["read_file"], expected_outputs: [], verification: [], affected_files: [], human_checkpoint: false },
      { id: "s2", title: "edit lib", depends_on: ["s1"], tools: ["edit_file"], expected_outputs: [], verification: [], affected_files: ["lib/greet.ts"], human_checkpoint: false },
      { id: "s3", title: "edit tests", depends_on: ["s2"], tools: ["edit_file"], expected_outputs: [], verification: [], affected_files: ["tests/greet.test.ts"], human_checkpoint: false },
      { id: "s4", title: "test", depends_on: ["s3"], tools: ["run_tests"], expected_outputs: [], verification: [], affected_files: [], human_checkpoint: false },
    ],
    risk: "low",
    approval_points: [],
    budget: { max_cost_usd: 1, max_duration_ms: 60_000, max_retries: 1, max_tool_calls: 25 },
  };
}

function makeProjectAndTask(): { projectId: string; taskId: string } {
  const projectId = newEntityId("proj");
  insertProject(db, {
    id: projectId,
    organization_id: ORG,
    name: `fixture-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    source_type: "fixture",
    source_ref: "sample-app",
    permission_mode: "read_only",
    status: "ready",
    repository_map_json: null,
    map_version: 0,
  });
  const taskId = newEntityId("task");
  insertTask(db, {
    id: taskId,
    project_id: projectId,
    organization_id: ORG,
    request_text: "add marker",
    brief_json: JSON.stringify({ request: "add marker", success_criteria: [], non_goals: [], risk: "low" }),
    risk: "low",
    created_by: "usr_owner",
  });
  return { projectId, taskId };
}

const events: Array<{ event_type: string; actor_type: string; payload: Record<string, unknown> }> = [];
const io = {
  emit: (e: { event_type: string; actor_type: "user" | "agent" | "system" | "evaluator" | "security"; payload: Record<string, unknown> }) => {
    events.push(e);
  },
  isCancelRequested: () => false,
};

describe("autonomous tool-use loop (real protocol, scripted model)", () => {
  it("exposes exactly the core tools plus remember and browser_verify", () => {
    const tools = buildAutonomousTools({ db, organizationId: ORG, projectId: "p", runId: "r" });
    expect(Object.keys(tools).sort()).toEqual(
      ["browser_verify", "compute_diff", "edit_file", "list_tree", "read_file", "remember", "run_tests", "search"]
    );
  });

  it("runs a full scripted autonomous loop: edit → test → remember → finish", async () => {
    const { projectId, taskId } = makeProjectAndTask();
    const loop = new ScriptedToolAdapter([
      { tool: "read_file", input: { path: "package.json" } },
      { tool: "edit_file", input: {
          path: "lib/greet.ts",
          action: "append",
          content: "\nexport function autoMarker(): string {\n  return \"auto\";\n}\n",
      } },
      { tool: "edit_file", input: {
          path: "tests/auto.test.ts",
          action: "create",
          content: 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { autoMarker } from "../lib/greet.ts";\n\ntest("auto marker", () => {\n  assert.equal(autoMarker(), "auto");\n});\n',
      } },
      { tool: "remember", input: { kind: "lesson", scope: "project", content: "autonomous loop test lesson", confidence: 0.7 } },
      { final: "Done: marker added and tested." },
    ]);

    const outcome = await runAutonomous({
      workspaceBaseDir: baseDir,
      workspaceId: "ws-auto-1",
      sourceRoot: path.resolve(__dirname, "../../../fixtures/sample-app"),
      plan: tinyPlan(),
      planHash: "0".repeat(64),
      grantedScopes: ROLE_SCOPES.engineer,
      modelRoute: "scripted/deterministic-v1",
      loop,
      maxTurns: 20,
      deadline: Date.now() + 60_000,
      agentDeps: { db, organizationId: ORG, projectId, runId: null as unknown as string },
      taskRequest: "add marker",
      contextSummary: "",
      io,
    });

    expect(outcome.status).toBe("ready_for_review");
    expect(outcome.changedFiles.length).toBeGreaterThanOrEqual(2);
    expect(outcome.turnsUsed).toBe(5);
    expect(outcome.toolCallsUsed).toBeGreaterThanOrEqual(4);
    // the forced post-loop test run happened
    expect(events.some((e) => e.event_type === "verification_result")).toBe(true);

    // the remember tool REALLY wrote an unapproved agent memory
    const mem = db
      .prepare("SELECT * FROM memories WHERE content LIKE '%autonomous loop test lesson%'")
      .get() as { approved: number; created_by: string; kind: string } | undefined;
    expect(mem).toBeTruthy();
    expect(mem!.created_by).toBe("agent");
    expect(mem!.approved).toBe(0); // human checkpoint: unapproved until approved
  });

  it("denies a tool outside granted scopes and the loop recovers instead of crashing", async () => {
    const { projectId } = makeProjectAndTask();
    // security role has no workspace:write → edit_file must be denied
    const loop = new ScriptedToolAdapter([
      { tool: "edit_file", input: { path: "lib/greet.ts", action: "append", content: "x" } },
      { final: "nothing I can do without write scope" },
    ]);
    const outcome = await runAutonomous({
      workspaceBaseDir: baseDir,
      workspaceId: "ws-auto-2",
      sourceRoot: path.resolve(__dirname, "../../../fixtures/sample-app"),
      plan: tinyPlan(),
      planHash: "0".repeat(64),
      grantedScopes: ["project:read"], // no workspace:write — deny-by-default
      modelRoute: "scripted",
      loop,
      maxTurns: 10,
      deadline: Date.now() + 60_000,
      agentDeps: { db, organizationId: ORG, projectId, runId: "run_auto_2" },
      taskRequest: "add marker",
      contextSummary: "",
      io,
    });
    // denied edit → final text → forced verify also lacks scope → honest hard failure
    expect(outcome.status).toBe("failed");
    expect(outcome.failure_code).toBe("TOOL_SCOPE_DENIED");
    expect(events.filter((e) => e.event_type === "tool_denied").length).toBe(1);
  });

  it("remember tool enforces scope deny-by-default", async () => {
    const tool = makeRememberTool({ db, organizationId: ORG, projectId: "p", runId: "r" });
    const before = (db.prepare("SELECT COUNT(*) AS c FROM memories").get() as { c: number }).c;
    await expect(
      tool.run(
        {
          workspaceRoot: baseDir,
          grantedScopes: ["project:read"], // no memory:write
          receipt: () => {},
          throwIfCancelled: () => {},
          timeoutMs: 1000,
        },
        { content: "should not be saved", kind: "fact" }
      )
    ).rejects.toThrow(/denied/);
    const after = (db.prepare("SELECT COUNT(*) AS c FROM memories").get() as { c: number }).c;
    expect(after).toBe(before);
  });

  it("browser_verify refuses non-loopback URLs before launching anything", async () => {
    const tool = makeBrowserVerifyTool({ db, organizationId: ORG, projectId: "p", runId: "r" });
    const res = await tool.run(
      {
        workspaceRoot: baseDir,
        grantedScopes: ROLE_SCOPES.owner,
        receipt: () => {},
        throwIfCancelled: () => {},
        timeoutMs: 5000,
      },
      { url: "https://evil.example.com" }
    );
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/loopback/i);
  });

  it("executePlan (deterministic mode) still works unchanged", async () => {
    const { projectId } = makeProjectAndTask();
    const outcome = await executePlan({
      workspaceBaseDir: baseDir,
      workspaceId: "ws-det-1",
      sourceRoot: path.resolve(__dirname, "../../../fixtures/sample-app"),
      plan: tinyPlan(),
      planHash: "0".repeat(64),
      grantedScopes: ROLE_SCOPES.engineer,
      modelRoute: "mock",
      mode: "normal",
      deadline: Date.now() + 60_000,
      io,
    });
    expect(outcome.status).toBe("ready_for_review");
    expect(getProject(db, projectId)).toBeTruthy();
  });
});
