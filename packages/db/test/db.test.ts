import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDb } from "../src/index.js";
import {
  insertProject,
  getProject,
  insertTask,
  casTaskState,
  insertPlan,
  getPlan,
  getLatestPlan,
  approvePlanRow,
  getPlanByHash,
  insertRun,
  updateRunStatus,
  insertRunEvent,
  listRunEvents,
  insertEvidence,
  listEvidence,
  findIdempotentResponse,
  saveIdempotentResponse,
  enqueueJob,
  claimJob,
  getJob,
  heartbeatJob,
  completeJob,
  failJob,
  requestCancel,
  isCancelRequested,
  insertOutboxEvent,
  listUnpublishedOutbox,
  markOutboxPublished,
  upsertSkill,
  listSkills,
} from "../src/repo.js";
import { seed } from "../src/seed.js";
import { planHash } from "@cockpit/policy";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let dbPath: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

beforeAll(() => {
  dbPath = path.join(mkdtempSync(path.join(tmpdir(), "cockpit-db-")), "test.db");
  db = openDb(dbPath);
  seed(db);
});

afterAll(() => {
  try {
    db?.close();
  } catch {
    /* ignore */
  }
});

describe("projects + tasks", () => {
  it("creates a project and task with CAS state updates", () => {
    const proj = insertProject(db, {
      id: "proj_test1",
      organization_id: "org_local",
      name: "Test Project",
      source_type: "fixture",
      source_ref: "sample-app",
      permission_mode: "read_only",
      status: "indexing",
      repository_map_json: null,
      map_version: 0,
    });
    expect(getProject(db, proj.id)?.name).toBe("Test Project");

    const task = insertTask(db, {
      id: "task_test1",
      project_id: proj.id,
      organization_id: "org_local",
      request_text: "Add a bounded login feature",
      brief_json: JSON.stringify({ request: "Add a bounded login feature" }),
      risk: "low",
      created_by: "usr_owner",
    });
    expect(task.state).toBe("FRAMED");

    const moved = casTaskState(db, task.id, task.version, "PLANNED");
    expect(moved?.state).toBe("PLANNED");
    expect(moved?.version).toBe(task.version + 1);

    // stale CAS rejected
    expect(casTaskState(db, task.id, task.version, "EXECUTING")).toBeUndefined();
  });
});

describe("plans", () => {
  it("versions plans and binds approval to hash", () => {
    const plan = { goal: "g", steps: [{ id: "s1" }] };
    const p1 = insertPlan(db, {
      id: "plan_1",
      task_id: "task_test1",
      plan_hash: planHash(plan),
      plan_json: JSON.stringify(plan),
      status: "proposed",
      approved_by: null,
      approved_at: null,
    });
    expect(p1.version).toBe(1);

    const p2 = insertPlan(db, {
      id: "plan_2",
      task_id: "task_test1",
      plan_hash: planHash({ ...plan, goal: "g2" }),
      plan_json: JSON.stringify({ ...plan, goal: "g2" }),
      status: "proposed",
      approved_by: null,
      approved_at: null,
    });
    expect(p2.version).toBe(2);
    // v1 superseded
    expect(getPlan(db!, p1.id)!.status).toBe("superseded");

    approvePlanRow(db, p2.id, "usr_owner");
    expect(getLatestPlan(db, "task_test1")?.status).toBe("approved");
    expect(getPlanByHash(db, "task_test1", planHash({ ...plan, goal: "g2" }))?.id).toBe("plan_2");
    // stale hash lookup still finds the old version's hash
    expect(getPlanByHash(db, "task_test1", planHash(plan))?.id).toBe("plan_1");
  });
});

describe("runs + events + evidence", () => {
  it("records events with monotonic sequences and evidence rows", () => {
    const run = insertRun(db, {
      id: "run_1",
      task_id: "task_test1",
      plan_id: "plan_2",
      plan_hash: "a".repeat(64),
      workspace_id: "ws_1",
      status: "queued",
      model_route: "mock",
      budget_json: JSON.stringify({ max_duration_ms: 900_000 }),
      started_at: null,
      ended_at: null,
      failure_code: null,
    });
    expect(run.status).toBe("queued");

    updateRunStatus(db, run.id, "running", { started_at: new Date().toISOString() });
    insertRunEvent(db, { run_id: run.id, event_type: "run_started", actor_type: "system", payload_json: "{}", redacted: 0 });
    insertRunEvent(db, { run_id: run.id, event_type: "tool_result", actor_type: "agent", payload_json: "{}", redacted: 0 });
    const events = listRunEvents(db, run.id);
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);

    insertEvidence(db, {
      id: "ev_1",
      run_id: run.id,
      check_type: "tests",
      status: "passed",
      severity: "informational",
      label: "verified",
      command_or_method: "npm test",
      artifact_id: null,
      result_json: "{}",
      human_required: 0,
    });
    expect(listEvidence(db, run.id)).toHaveLength(1);

    updateRunStatus(db, run.id, "ready_for_review");
    expect(db.prepare("SELECT status FROM runs WHERE id = ?").get(run.id).status).toBe("ready_for_review");
  });
});

describe("idempotency", () => {
  it("replays the original response for the same key", () => {
    saveIdempotentResponse(db, {
      organization_id: "org_local",
      actor_id: "usr_owner",
      idempotency_key: "key-1",
      route: "POST /api/v1/projects",
      request_hash: "hash-1",
      response_status: 202,
      response_body: '{"data":{"project_id":"proj_test1"}}',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const rec = findIdempotentResponse(db, "org_local", "usr_owner", "key-1", "POST /api/v1/projects");
    expect(rec?.response_status).toBe(202);

    // same key, different request hash -> conflict is decided by API layer
    const rec2 = findIdempotentResponse(db, "org_local", "usr_owner", "key-1", "POST /api/v1/tasks");
    expect(rec2).toBeUndefined(); // route-scoped
  });
});

describe("job leases", () => {
  it("claims with fencing tokens and enforces ownership", () => {
    const job = enqueueJob(db, { job_type: "execute_run", aggregate_id: "run_1" });
    const owner = "worker-A";
    const claimed = claimJob(db, job.job_type, owner, 60_000);
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.fencing_token).toBe(1);

    // wrong owner cannot heartbeat or complete
    expect(heartbeatJob(db, job.id, "worker-B", 60_000)).toBe(false);
    expect(completeJob(db, job.id, "worker-B")).toBe(false);

    expect(heartbeatJob(db, job.id, owner, 60_000)).toBe(true);
    expect(completeJob(db, job.id, owner)).toBe(true);
    expect(claimJob(db, job.job_type, owner, 60_000)).toBeUndefined();
  });

  it("retries are bounded and classified", () => {
    const job = enqueueJob(db, { job_type: "generate_plan", aggregate_id: "task_x", max_attempts: 2 });
    const owner = "worker-B";
    const claimed = claimJob(db, job.job_type, owner, 60_000)!;
    expect(failJob(db, claimed.id, owner, "PROVIDER_TIMEOUT", "new_attempt")).toBe(true);
    expect(getJob(db, claimed.id)?.status).toBe("queued"); // retry scheduled
    const reClaimed = claimJob(db, job.job_type, "worker-C", 60_000)!;
    expect(reClaimed.attempt).toBe(1);
    expect(failJob(db, reClaimed.id, "worker-C", "PROVIDER_TIMEOUT", "new_attempt")).toBe(true);
    expect(getJob(db, reClaimed.id)?.status).toBe("failed"); // max attempts reached
  });

  it("cancel flags propagate to queued/running jobs", () => {
    const job = enqueueJob(db, { job_type: "execute_run", aggregate_id: "run_cancel" });
    claimJob(db, job.job_type, "worker-D", 60_000);
    requestCancel(db, "run_cancel");
    expect(isCancelRequested(db, job.id)).toBe(true);
  });
});

describe("outbox", () => {
  it("writes and publishes in order", () => {
    insertOutboxEvent(db, { aggregate_type: "run", aggregate_id: "run_1", event_type: "run.completed", schema_version: "1.0", payload_json: "{}" });
    insertOutboxEvent(db, { aggregate_type: "run", aggregate_id: "run_1", event_type: "run.evidence", schema_version: "1.0", payload_json: "{}" });
    const pending = listUnpublishedOutbox(db);
    expect(pending.map((e) => e.event_type)).toContain("run.completed");
    markOutboxPublished(db, pending.map((e) => e.id));
    expect(listUnpublishedOutbox(db)).toHaveLength(0);
  });
});

describe("skills", () => {
  it("seeds the catalog and upserts by skill_id", () => {
    const rows = listSkills(db, "org_local");
    expect(rows.length).toBeGreaterThanOrEqual(50);
    upsertSkill(db, {
      organization_id: "org_local",
      skill_id: "repo-exploration",
      version: "1.1.0",
      name: "Repository exploration",
      purpose: "Build a map and identify relevant files without editing.",
      source_repo: null,
      source_url: null,
      source_commit: null,
      license: "MIT",
      category: "harness",
      phase: 1,
      manifest_json: "{}",
      status: "approved",
      owner: "platform-team",
    });
    expect(listSkills(db, "org_local").length).toBe(rows.length); // upsert not insert
  });
});
