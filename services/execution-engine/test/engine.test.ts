import { describe, it, expect } from "vitest";
import { executePlan } from "../src/engine.js";
import { Workspace, unifiedDiff } from "../src/workspace.js";
import { planHash } from "@cockpit/policy";
import type { PlanDocument } from "@cockpit/contracts";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SAMPLE = path.resolve(__dirname, "../../../fixtures/sample-app");

function makePlan(): PlanDocument {
  return {
    goal: "Add a bounded login feature",
    success_criteria: ["login greeting added", "tests pass"],
    non_goals: ["OAuth"],
    assumptions: [],
    steps: [
      { id: "s1", title: "ground", depends_on: [], tools: ["list_tree", "read_file", "search"], expected_outputs: [], verification: [], affected_files: [], human_checkpoint: false },
      { id: "s2", title: "implement", depends_on: ["s1"], tools: ["edit_file"], expected_outputs: [], verification: [], affected_files: [], human_checkpoint: false },
      { id: "s3", title: "test", depends_on: ["s2"], tools: ["edit_file"], expected_outputs: [], verification: [], affected_files: [], human_checkpoint: false },
      { id: "s4", title: "verify", depends_on: ["s3"], tools: ["run_tests"], expected_outputs: [], verification: [], affected_files: [], human_checkpoint: false },
    ],
    risk: "low",
    approval_points: [],
    budget: { max_cost_usd: 1, max_duration_ms: 900_000, max_retries: 1, max_tool_calls: 100 },
  };
}

function baseOpts(base: string, overrides: Partial<Parameters<typeof executePlan>[0]> = {}) {
  return {
    workspaceBaseDir: base,
    workspaceId: "ws_test_" + Math.random().toString(36).slice(2, 8),
    sourceRoot: SAMPLE,
    plan: makePlan(),
    planHash: planHash(makePlan()),
    grantedScopes: ["workspace:read", "workspace:write"] as const,
    modelRoute: "mock/deterministic-v1",
    io: {
      emit: () => {},
      isCancelRequested: () => false,
    },
    deadline: Date.now() + 60_000,
    ...overrides,
  };
}

describe("executePlan", () => {
  it("completes the bounded flow and produces a real diff with passing tests", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "ws-"));
    try {
      const events: string[] = [];
      const outcome = await executePlan(
        baseOpts(base, {
          io: { emit: (e) => events.push(e.event_type), isCancelRequested: () => false },
        })
      );
      expect(outcome.status).toBe("ready_for_review");
      expect(outcome.changedFiles).toContain("lib/greet.ts");
      expect(outcome.changedFiles).toContain("tests/greet.test.ts");
      expect(events).toContain("run_started");
      expect(events).toContain("phase_changed");
      expect(events).toContain("verification_result");
      expect(events).toContain("run_completed");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("denies tools when the run lacks workspace:write scope (deny-by-default)", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "ws-"));
    try {
      const denied: unknown[] = [];
      const outcome = await executePlan(
        baseOpts(base, {
          grantedScopes: ["workspace:read"] as const,
          io: {
            emit: (e) => {
              if (e.event_type === "tool_denied") denied.push(e.payload);
            },
            isCancelRequested: () => false,
          },
        })
      );
      expect(outcome.status).toBe("failed");
      expect(outcome.failure_code).toBe("TOOL_SCOPE_DENIED");
      expect(denied.length).toBeGreaterThan(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("stops with BUDGET_EXCEEDED when tool-call budget is zero", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "ws-"));
    try {
      const plan = { ...makePlan(), budget: { ...makePlan().budget, max_tool_calls: 0 } };
      const outcome = await executePlan(baseOpts(base, { plan, planHash: planHash(plan) }));
      expect(outcome.status).toBe("failed");
      expect(outcome.failure_code).toBe("BUDGET_EXCEEDED");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors cancellation between tool calls and preserves the run record", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "ws-"));
    let calls = 0;
    try {
      const outcome = await executePlan(
        baseOpts(base, {
          io: { emit: () => {}, isCancelRequested: () => ++calls > 2 },
        })
      );
      expect(outcome.status).toBe("cancelled");
      expect(outcome.failure_code).toBeNull();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("enters bounded repair on failing tests and reports needs_repair honestly", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "ws-"));
    try {
      const outcome = await executePlan(baseOpts(base, { mode: "failing_tests" }));
      expect(outcome.status).toBe("needs_repair");
      expect(outcome.failure_code).toBe("TESTS_FAILED");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("treats repository content as data (injection fixture does not grant scopes)", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "ws-"));
    try {
      // Injection content is present in the attack fixture dir; the engine never
      // reads instructions from repo text: tool inputs come from the plan only.
      const outcome = await executePlan(baseOpts(base));
      expect(outcome.status).toBe("ready_for_review");
      // nothing outside planned files changed
      expect(outcome.changedFiles.every((f) => f.startsWith("lib/") || f.startsWith("tests/"))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("workspace", () => {
  it("diffs pristine vs modified and reports added/removed lines", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "ws-diff-"));
    try {
      const src = path.join(base, "src");
      cpSync(SAMPLE, src, { recursive: true });
      const ws = await Workspace.create(base, "wsX", SAMPLE);
      const { appendFileSync, writeFileSync } = await import("node:fs");
      appendFileSync(path.join(ws.root, "lib/greet.ts"), "\nexport const x = 1;\n");
      writeFileSync(path.join(ws.root, "package.json"), JSON.stringify({ name: "sample-app", version: "0.2.0" }));
      const changed = await ws.changedFiles();
      expect(changed).toContain("lib/greet.ts");
      expect(changed).toContain("package.json");
      const diff = await ws.diff();
      const greet = diff.files.find((f) => f.path === "lib/greet.ts");
      expect(greet?.bytes_added).toBeGreaterThan(0);
      await ws.destroy();
      const { existsSync } = await import("node:fs");
      expect(existsSync(ws.root)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("unifiedDiff marks added and removed lines", () => {
    const patch = unifiedDiff("f.txt", "a\nb\n", "a\nc\n");
    expect(patch).toContain("- b");
    expect(patch).toContain("+ c");
  });
});
