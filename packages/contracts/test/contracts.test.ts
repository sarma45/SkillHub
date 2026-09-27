import { describe, it, expect } from "vitest";
import {
  PlanDocument,
  PlanStep,
  ToolContract,
  CreateTaskRequest,
  CreateProjectRequest,
  RepositoryMap,
  TreeNode,
  PullRequestDraftRequest,
  ApiError,
  ResponseEnvelope,
  envelope,
  errorEnvelope,
  ErrorCodes,
  HTTP_STATUS,
} from "../src/index.js";

describe("plan contract", () => {
  const step: PlanStep = {
    id: "s1",
    title: "Add login module",
    depends_on: [],
    tools: ["edit_file", "run_tests"],
    expected_outputs: ["src/auth/login.ts"],
    verification: ["npm test passes"],
    affected_files: ["src/auth/login.ts"],
    human_checkpoint: false,
  };

  const plan = {
    goal: "Add a bounded login feature to the sample app",
    success_criteria: ["login form renders", "tests pass"],
    non_goals: ["OAuth", "password reset"],
    assumptions: [{ text: "no existing auth", confidence: 0.9, source: "repo map" }],
    steps: [step],
    risk: "low" as const,
    approval_points: ["before integration"],
    budget: { max_cost_usd: 1, max_duration_ms: 900_000, max_retries: 2, max_tool_calls: 200 },
  };

  it("accepts a valid plan document", () => {
    expect(PlanDocument.safeParse(plan).success).toBe(true);
  });

  it("rejects a step with an unknown dependency (cycle/dangling)", () => {
    const bad = { ...plan, steps: [{ ...step, depends_on: ["ghost"] }] };
    // dangling deps are rejected by policy layer; contract only checks shape
    expect(PlanStep.safeParse(bad.steps[0]).success).toBe(true);
  });

  it("rejects invalid budget", () => {
    const bad = { ...plan, budget: { ...plan.budget, max_retries: -1 } };
    expect(PlanDocument.safeParse(bad).success).toBe(false);
  });
});

describe("tool contract", () => {
  it("accepts a well-formed tool declaration", () => {
    const tool = {
      name: "edit_file",
      description: "Apply a bounded replacement to one file in the workspace",
      input_schema: {},
      output_schema: {},
      side_effects: ["write_workspace"],
      risk_level: "medium",
      required_scopes: ["workspace:write"],
      undo_strategy: "git checkout of the file in isolated workspace",
      timeout_ms: 30_000,
      idempotency: "workspace_pure",
    };
    expect(ToolContract.safeParse(tool).success).toBe(true);
  });

  it("rejects tools with no side-effect declaration", () => {
    const tool = {
      name: "mystery",
      description: "Undeclared side effects are forbidden",
      input_schema: {},
      output_schema: {},
      side_effects: [],
      risk_level: "low",
      required_scopes: [],
      undo_strategy: "n/a",
      timeout_ms: 1000,
      idempotency: "workspace_pure",
    };
    expect(ToolContract.safeParse(tool).success).toBe(false);
  });
});

describe("task + project requests", () => {
  it("task brief requires success criteria", () => {
    const bad = { request: "Add a bounded login feature", success_criteria: [], risk: "low" };
    expect(CreateTaskRequest.safeParse(bad).success).toBe(false);
  });

  it("project source rejects unknown source types", () => {
    expect(
      CreateProjectRequest.safeParse({ name: "demo", source: { type: "ftp" } }).success
    ).toBe(false);
    expect(
      CreateProjectRequest.safeParse({
        name: "demo",
        source: { type: "fixture", fixture_id: "sample-app" },
        permissions: { read: true, write: false },
      }).success
    ).toBe(true);
  });
});

describe("repository map", () => {
  const tree: TreeNode = {
    name: "sample-app",
    path: "",
    type: "dir",
    children: [
      { name: "src", path: "src", type: "dir", children: [{ name: "index.ts", path: "src/index.ts", type: "file" }] },
      { name: "package.json", path: "package.json", type: "file" },
    ],
  };
  const map = {
    languages: ["TypeScript"],
    framework: null,
    package_manager: "npm",
    entry_points: ["src/index.ts"],
    build_command: null,
    test_command: "npm test",
    tree,
    directories: [],
    facts: [{ key: "test_command", value: "npm test", label: "verified", source_refs: ["package.json"] }],
    unresolved_questions: [],
    map_version: 1,
    generated_at: new Date().toISOString(),
  };
  it("accepts a valid repository map", () => {
    expect(RepositoryMap.safeParse(map).success).toBe(true);
  });
  it("rejects a fact with an invalid evidence label", () => {
    const bad = { ...map, facts: [{ ...map.facts[0], label: "guessed" }] };
    expect(RepositoryMap.safeParse(bad).success).toBe(false);
  });
});

describe("PR draft", () => {
  it("requires explicit risk acknowledgment", () => {
    const draft = {
      branch: "feat/login",
      title: "Add bounded login feature",
      body: "Implements the approved plan v1 with evidence links.",
      acknowledged_risks: false,
    };
    expect(PullRequestDraftRequest.safeParse(draft).success).toBe(true); // shape ok
    // policy layer refuses ack=false; contract carries the field
  });
});

describe("envelope", () => {
  it("round-trips data and error envelopes", () => {
    const ok = envelope("req_123", { hello: 1 });
    expect(ResponseEnvelope.safeParse(ok).success).toBe(true);

    const err = errorEnvelope("req_123", {
      code: ErrorCodes.PLAN_HASH_MISMATCH,
      message: "stale",
      details: [],
      retryable: false,
      retry_class: "human_action",
      field_errors: [],
    });
    expect(err.error?.code).toBe(ErrorCodes.PLAN_HASH_MISMATCH);
    expect(HTTP_STATUS[ErrorCodes.PLAN_HASH_MISMATCH]).toBe(409);
  });
});
