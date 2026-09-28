/**
 * Isolated worker (TRD §7): claims jobs with leases + fencing tokens,
 * heartbeats, bounded retry, cancellation. One process handles the five MVP
 * job types; jobs are durable rows, never in-memory state.
 *
 * Run: node --import tsx apps/worker/src/main.ts
 */
import { openDb, DEFAULT_DB_FILE } from "@cockpit/db";
import {
  claimJob,
  heartbeatJob,
  completeJob,
  failJob,
  isCancelRequested,
  getJob,
  enqueueJob,
  getProject,
  getTask,
  getPlan,
  updateProjectMap,
  setProjectStatus,
  insertRunEvent,
  insertOutboxEvent,
  casTaskState,
  updateRunStatus,
  getRun,
  listEvidence,
  insertArtifact,
  getArtifact,
  expireStaleMemories,
  purgeExpiredAuthSessions,
  nowIso,
  newEntityId,
} from "@cockpit/db";
import { buildRepositoryMap } from "@cockpit/repo-parser";
import { generatePlan } from "@cockpit/planning-service";
import { executePlan, runAutonomous } from "@cockpit/execution-engine";
import { runBaselineScan, type ScopeManifest } from "@cockpit/security-service";
import { resolveFixtureRoot, fixturesDir } from "@cockpit/security-service";
import { assembleContextBundle, setContextDb } from "@cockpit/context-service";
import { recordLesson } from "@cockpit/memory-service";
import { evaluateChangedFilesQuality } from "@cockpit/evaluation-service";
import { createToolUseGateway } from "@cockpit/model-gateway";
import { ScriptedToolAdapter } from "@cockpit/model-gateway";
import { ROLE_SCOPES, assertPathAllowed, type Scope } from "@cockpit/policy";
import { workspaceBaseDir } from "@cockpit/execution-engine";
import path from "node:path";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

const LEASE_MS = 15_000;
const POLL_MS = 500;
const OWNER = `worker-${process.pid}`;

const db = openDb(process.env.COCKPIT_DB_FILE ?? DEFAULT_DB_FILE);
setContextDb(db); // context-service memory layer reads through this handle

let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});

const JOB_TYPES = [
  "index_repository",
  "generate_plan",
  "execute_run",
  "evaluate_run",
  "security_scan",
  "memory_maintenance",
] as const;

async function tick(): Promise<void> {
  for (const jobType of JOB_TYPES) {
    if (!running) return;
    const job = claimJob(db, jobType, OWNER, LEASE_MS);
    if (!job) continue;

    const hb = setInterval(() => heartbeatJob(db, job.id, OWNER, LEASE_MS), LEASE_MS / 3);
    try {
      const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
      switch (jobType) {
        case "index_repository":
          await handleIndexRepository(job.aggregate_id);
          break;
        case "generate_plan":
          await handleGeneratePlan(job.aggregate_id);
          break;
        case "execute_run":
          await handleExecuteRun(job.aggregate_id, payload);
          break;
        case "evaluate_run":
          await handleEvaluateRun(job.aggregate_id);
          break;
        case "security_scan":
          await handleSecurityScan(payload);
          break;
        case "memory_maintenance":
          await handleMemoryMaintenance();
          break;
      }
      completeJob(db, job.id, OWNER);
    } catch (err) {
      const code = err instanceof Error ? err.message.slice(0, 120) : "UNKNOWN";
      const retryClass = /timeout|unavailable/i.test(code) ? "new_attempt" : "human_action";
      failJob(db, job.id, OWNER, code, retryClass);
      console.error(`[worker] job ${job.id} (${jobType}) failed: ${code}`);
    } finally {
      clearInterval(hb);
    }
  }
}

// ---------- index_repository ----------

async function handleIndexRepository(projectId: string): Promise<void> {
  const project = getProject(db, projectId);
  if (!project) throw new Error("project not found");

  const root =
    project.source_type === "fixture"
      ? resolveFixtureRoot(project.source_ref)
      : assertPathAllowed(project.source_ref); // audit fix #2: allowlist enforced here too

  try {
    const map = await buildRepositoryMap(root);
    updateProjectMap(db, projectId, JSON.stringify(map), "ready");
    insertOutboxEvent(db, {
      aggregate_type: "project",
      aggregate_id: projectId,
      event_type: "project.map_ready",
      schema_version: "1.0",
      payload_json: JSON.stringify({ languages: map.languages, framework: map.framework }),
    });
  } catch (err) {
    setProjectStatus(db, projectId, "failed");
    insertOutboxEvent(db, {
      aggregate_type: "project",
      aggregate_id: projectId,
      event_type: "project.index_failed",
      schema_version: "1.0",
      payload_json: JSON.stringify({ error: err instanceof Error ? err.message : "unknown" }),
    });
    throw err;
  }
}

// ---------- generate_plan ----------

async function handleGeneratePlan(taskId: string): Promise<void> {
  const task = getTask(db, taskId);
  if (!task) throw new Error("task not found");
  const project = getProject(db, task.project_id);
  if (!project?.repository_map_json) throw new Error("project map not ready");

  const brief = JSON.parse(task.brief_json) as {
    request: string;
    success_criteria: string[];
    non_goals: string[];
    risk: "low" | "medium" | "high" | "critical";
  };

  // REAL context assembly (context-service): project + map + memory layers
  let contextSummary: string | undefined;
  let contextBundleJson: string | null = null;
  try {
    const map = JSON.parse(project.repository_map_json) as Parameters<typeof assembleContextBundle>[0]["map"];
    const sourceRoot =
      project.source_type === "fixture" ? resolveFixtureRoot(project.source_ref) : path.resolve(project.source_ref);
    const bundle = await assembleContextBundle({
      organizationId: project.organization_id,
      projectId: project.id,
      projectRoot: sourceRoot,
      map,
      taskRequest: brief.request,
    });
    contextSummary = bundle.items
      .map((i) => `[${i.label}/${i.layer}] ${i.ref}: ${i.content.slice(0, 300)}`)
      .join("\n")
      .slice(0, 8000);
    contextBundleJson = JSON.stringify({ used_chars: bundle.used_chars, items: bundle.items.length, truncated: bundle.truncated });
  } catch {
    // context is advisory for planning; the deterministic planner still works
    contextSummary = undefined;
  }

  const { plan, plan_hash, context_summary } = await generatePlan({
    brief,
    repoMap: JSON.parse(project.repository_map_json),
    contextSummary,
  });

  // hash must cover EXACTLY what is stored (approvePlan re-hashes plan_json)
  const storedPlan = contextBundleJson ? { ...plan, context_receipt: JSON.parse(contextBundleJson) } : plan;
  const { planHash: hashOf } = await import("@cockpit/policy");
  const storedHash = hashOf(storedPlan);

  // import insertPlan indirectly to avoid circular import weight: inline here
  const { insertPlan } = await import("@cockpit/db");
  const planRow = insertPlan(db, {
    id: newEntityId("plan"),
    task_id: taskId,
    plan_hash: storedHash,
    plan_json: JSON.stringify(storedPlan),
    status: "proposed",
    approved_by: null,
    approved_at: null,
  });

  const updated = casTaskState(db, taskId, task.version, "AWAITING_PLAN_APPROVAL");
  if (!updated) throw new Error("task version conflict while planning");

  insertOutboxEvent(db, {
    aggregate_type: "plan",
    aggregate_id: planRow.id,
    event_type: "plan.proposed",
    schema_version: "1.0",
    payload_json: JSON.stringify({ task_id: taskId, version: planRow.version, plan_hash: storedHash, context_summary: context_summary ? context_summary.length : 0 }),
  });
}

// ---------- execute_run ----------

async function handleExecuteRun(runId: string, payload: Record<string, unknown>): Promise<void> {
  const run = getRun(db, runId);
  if (!run) throw new Error("run not found");
  const task = getTask(db, run.task_id);
  const planRow = getPlan(db, run.plan_id);
  if (!task || !planRow) throw new Error("task/plan not found");
  const project = getProject(db, task.project_id);
  if (!project) throw new Error("project not found");

  const sourceRoot =
    project.source_type === "fixture"
      ? resolveFixtureRoot(project.source_ref)
      : path.resolve(project.source_ref);

  const plan = JSON.parse(planRow.plan_json) as Parameters<typeof executePlan>[0]["plan"];
  const budget = JSON.parse(run.budget_json) as { max_duration_ms: number };

  const jobId = runId; // cancellation fans out by aggregate id
  updateRunStatus(db, runId, "running", { started_at: nowIso() });
  insertRunEvent(db, {
    run_id: runId,
    event_type: "run_created",
    actor_type: "system",
    payload_json: JSON.stringify({ workspace: "isolated", plan_hash: run.plan_hash }),
    redacted: 0,
  });

  const grantedScopes = ROLE_SCOPES.engineer ?? [];
  const emit = (e: { event_type: string; actor_type: string; payload: Record<string, unknown> }) => {
    const r = JSON.stringify(e.payload);
    insertRunEvent(db, {
      run_id: runId,
      event_type: e.event_type,
      actor_type: e.actor_type,
      payload_json: r,
      redacted: 0,
    });
    insertOutboxEvent(db, {
      aggregate_type: "run",
      aggregate_id: runId,
      event_type: `run.${e.event_type}`,
      schema_version: "1.0",
      payload_json: r,
    });
  };
  const isCancel = () => {
    if (isCancelRequested(db, jobId)) return true;
    const r = getRun(db, runId);
    return r?.status === "cancelled";
  };

  /** Persist a screenshot PNG as a real artifact row; returns artifact id. */
  const onScreenshot = async (pngPath: string): Promise<string | null> => {
    try {
      const buf = await fs.readFile(pngPath);
      const artifact = insertArtifact(db, {
        id: newEntityId("art"),
        project_id: project.id,
        run_id: runId,
        kind: "screenshot",
        uri: pngPath,
        sha256: createHash("sha256").update(buf).digest("hex"),
        size_bytes: buf.length,
        sensitivity: "internal",
        metadata_json: JSON.stringify({ content_type: "image/png" }),
      });
      return artifact.id;
    } catch {
      return null;
    }
  };

  const agentDeps = {
    db,
    organizationId: project.organization_id,
    projectId: project.id,
    runId,
    onScreenshot,
  };

  let outcome:
    | Awaited<ReturnType<typeof executePlan>>
    | Awaited<ReturnType<typeof runAutonomous>>;

  if (payload.mode === "autonomous") {
    // REAL model-driven loop: Anthropic native tool-use when a key exists,
    // otherwise a deterministic scripted loop that exercises the identical
    // protocol end to end (read → edit → test → remember → finish).
    const loop = createToolUseGateway() ?? new ScriptedToolAdapter([
      { tool: "list_tree", input: { path: "" } },
      { tool: "read_file", input: { path: "package.json" } },
      { tool: "edit_file", input: {
          path: "lib/greet.ts",
          action: "append",
          content: "\nexport function autonomousMarker(): string {\n  return \"added by the autonomous loop\";\n}\n",
      } },
      { tool: "edit_file", input: {
          path: "tests/autonomous.test.ts",
          action: "create",
          content: 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { autonomousMarker } from "../lib/greet.ts";\n\ntest("autonomous marker exists", () => {\n  assert.equal(autonomousMarker(), "added by the autonomous loop");\n});\n',
      } },
      { tool: "remember", input: { kind: "lesson", scope: "project", content: "Autonomous run completed: greeting module extended with a marker function and a passing test.", confidence: 0.7 } },
      { final: "Plan executed autonomously: read the repo, extended lib/greet.ts, added a passing test, saved a lesson memory." },
    ]);

    outcome = await runAutonomous({
      workspaceBaseDir: workspaceBaseDir(),
      workspaceId: runId,
      sourceRoot,
      plan,
      planHash: run.plan_hash,
      grantedScopes,
      modelRoute: run.model_route,
      loop,
      maxTurns: 30,
      deadline: Date.now() + budget.max_duration_ms,
      agentDeps,
      taskRequest: task.request_text,
      contextSummary: typeof (plan as { context_receipt?: unknown }).context_receipt === "object" ? "(context receipt present)" : "",
      io: { emit: emit as never, isCancelRequested: isCancel },
    });
  } else {
    outcome = await executePlan({
      workspaceBaseDir: workspaceBaseDir(),
      workspaceId: runId,
      sourceRoot,
      plan,
      planHash: run.plan_hash,
      grantedScopes,
      modelRoute: run.model_route,
      mode: (payload.mode as "normal" | "failing_tests" | "provider_timeout") ?? "normal",
      deadline: Date.now() + budget.max_duration_ms,
      io: { emit: emit as never, isCancelRequested: isCancel },
    });
  }

  const statusMap = {
    ready_for_review: "ready_for_review",
    failed: "failed",
    cancelled: "cancelled",
    needs_repair: "needs_repair",
  } as const;
  updateRunStatus(db, runId, statusMap[outcome.status], {
    ended_at: nowIso(),
    failure_code: outcome.failure_code,
    budget_used_json: JSON.stringify({ tool_calls: outcome.toolCallsUsed }),
  });
  // queue evaluator receipts for completed runs
  if (outcome.status === "ready_for_review" || outcome.status === "needs_repair") {
    enqueueJob(db, { job_type: "evaluate_run", aggregate_id: runId });
  }
  // Phase 4: record a durable lesson memory from every terminal run
  // (agent-written → starts unapproved; a human approves it in the Memory page)
  try {
    const lessonText =
      outcome.status === "ready_for_review"
        ? `Run ${runId} completed: ${outcome.changedFiles.length} file(s) changed via ${outcome.toolCallsUsed} tool calls.`
        : outcome.status === "cancelled"
          ? `Run ${runId} was cancelled by the user; workspace preserved for inspection.`
          : `Run ${runId} ended ${outcome.status} (${outcome.failure_code ?? "unknown"}).`;
    recordLesson(db, {
      organizationId: project.organization_id,
      projectId: project.id,
      runId,
      lesson: lessonText,
      evidenceRefs: [`run:${runId}`],
    });
  } catch {
    /* lesson capture must never fail the run bookkeeping */
  }
  // mirror terminal state onto the task
  const freshTask = getTask(db, run.task_id);
  if (freshTask && outcome.status === "ready_for_review") {
    casTaskState(db, run.task_id, freshTask.version, "READY_FOR_REVIEW");
  }
}

// ---------- memory_maintenance ----------

async function handleMemoryMaintenance(): Promise<void> {
  const expired = expireStaleMemories(db);
  if (expired > 0) {
    insertOutboxEvent(db, {
      aggregate_type: "skill",
      aggregate_id: "memory-service",
      event_type: "memory.expired_batch",
      schema_version: "1.0",
      payload_json: JSON.stringify({ expired }),
    });
  }
}

// ---------- evaluate_run ----------

/**
 * Evaluator receipts are produced from the durable record of the run:
 * tests evidence comes from verification_result events; changed-file review
 * from the diff; secret scan re-checks changed file names + the event stream.
 */
async function handleEvaluateRun(runId: string): Promise<void> {
  const run = getRun(db, runId);
  if (!run) throw new Error("run not found");
  const existing = listEvidence(db, runId);
  if (existing.length > 0) {
    completeJob(db, getJobIdForRun(runId) ?? "", OWNER);
    return;
  }

  const events = db
    .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence")
    .all(runId) as Array<{ event_type: string; payload_json: string }>;

  const testEvents = events.filter((e) => e.event_type === "verification_result");
  const lastTest = testEvents.at(-1);
  const testStatus = lastTest ? (JSON.parse(lastTest.payload_json) as { status: string }).status : "skipped";

  const { insertEvidence } = await import("@cockpit/db");

  insertEvidence(db, {
    id: newEntityId("evd"),
    run_id: runId,
    check_type: "tests",
    status: testStatus === "passed" ? "passed" : testStatus === "failed" ? "failed" : "skipped",
    severity: testStatus === "failed" ? "high" : "informational",
    label: "verified",
    command_or_method: "node --test tests/ (isolated workspace)",
    artifact_id: null,
    result_json: JSON.stringify({ via: "run_events", observed: testStatus }),
    human_required: 0,
  });

  insertEvidence(db, {
    id: newEntityId("evd"),
    run_id: runId,
    check_type: "changed-file-review",
    status: "warning",
    severity: "low",
    label: "observed",
    command_or_method: "workspace diff vs pristine snapshot",
    artifact_id: null,
    result_json: JSON.stringify({ human_required: true, note: "automated review is advisory; human review decides" }),
    human_required: 1,
  });

  // secret scan over the run's own receipts (defense in depth)
  const secretHits = events.filter((e) => {
    try {
      const p = JSON.parse(e.payload_json) as Record<string, unknown>;
      return Object.values(p).some((v) => typeof v === "string" && /ghp_|AKIA|BEGIN.*PRIVATE KEY/.test(v));
    } catch {
      return false;
    }
  });
  insertEvidence(db, {
    id: newEntityId("evd"),
    run_id: runId,
    check_type: "secrets",
    status: secretHits.length === 0 ? "passed" : "failed",
    severity: secretHits.length === 0 ? "informational" : "critical",
    label: "verified",
    command_or_method: "pattern scan over run receipts",
    result_json: JSON.stringify({ hits: secretHits.length }),
    artifact_id: null,
    human_required: 0,
  });

  // quality evaluators (seo / diagram / design) over the run's changed files
  try {
    const wsPath = path.join(workspaceBaseDir(), runId);
    if (existsSync(wsPath) && outcomeChangedFiles(events).length > 0) {
      const report = await evaluateChangedFilesQuality(outcomeChangedFiles(events), wsPath);
      const severities = report.findings.map((f) => f.severity);
      const hasHigh = severities.includes("high") || severities.includes("critical");
      insertEvidence(db, {
        id: newEntityId("evd"),
        run_id: runId,
        check_type: "quality:seo-diagram-design",
        status: hasHigh ? "failed" : report.findings.length > 0 ? "warning" : "passed",
        severity: hasHigh ? "high" : report.findings.length > 0 ? "medium" : "informational",
        label: "verified",
        command_or_method: `heuristic evaluators over ${report.files_scanned} changed file(s)`,
        artifact_id: null,
        result_json: JSON.stringify(report),
        human_required: 0,
      });
    }
  } catch {
    /* quality evidence must not fail the evaluator job */
  }

  insertOutboxEvent(db, {
    aggregate_type: "run",
    aggregate_id: runId,
    event_type: "run.evidence_recorded",
    schema_version: "1.0",
    payload_json: JSON.stringify({ checks: 3 }),
  });
}

/** Changed files from a run's receipts (edit_file tool results). */
function outcomeChangedFiles(events: Array<{ event_type: string; payload_json: string }>): string[] {
  const files = new Set<string>();
  for (const e of events) {
    if (e.event_type !== "tool_result") continue;
    try {
      const p = JSON.parse(e.payload_json) as { tool?: string; path?: string; action?: string };
      if (p.tool === "edit_file" && p.path) files.add(p.path);
    } catch {
      /* skip */
    }
  }
  return [...files];
}

function getJobIdForRun(runId: string): string | null {
  const j = db
    .prepare("SELECT id FROM job_leases WHERE aggregate_id = ? AND job_type = 'evaluate_run' ORDER BY created_at DESC LIMIT 1")
    .get(runId) as { id: string } | undefined;
  return j?.id ?? null;
}

// ---------- security_scan ----------

async function handleSecurityScan(payload: Record<string, unknown>): Promise<void> {
  const manifest = payload.scope_manifest as ScopeManifest | undefined;
  if (!manifest) throw new Error("scope manifest required");
  const result = await runBaselineScan(manifest);
  const { insertEvidence } = await import("@cockpit/db");
  if (payload.run_id) {
    insertEvidence(db, {
      id: newEntityId("evd"),
      run_id: String(payload.run_id),
      check_type: `security:${result.scanner}`,
      status: result.findings.some((f) => f.severity === "critical" || f.severity === "high")
        ? "failed"
        : result.findings.length > 0
          ? "warning"
          : "passed",
      severity: result.findings[0]?.severity ?? "informational",
      label: "verified",
      command_or_method: result.scanner === "strix" ? "strix local safe-lab (fixture)" : "baseline static scan",
      artifact_id: null,
      result_json: JSON.stringify(result),
      human_required: 1,
    });
  }
  insertOutboxEvent(db, {
    aggregate_type: "finding",
    aggregate_id: manifest.manifest_id,
    event_type: "security.scan_completed",
    schema_version: "1.0",
    payload_json: JSON.stringify({ scanner: result.scanner, findings: result.findings.length }),
  });
}

// ---------- main loop ----------

// periodic maintenance: memory retention sweep (Phase 4), auth-session
// purge, and WAL checkpoint so the write-ahead log stays bounded even when
// the web process holds long-lived readers (audit fix #3).
setInterval(() => {
  try {
    const purged = purgeExpiredAuthSessions(db);
    if (purged > 0) console.log(`[worker] purged ${purged} expired auth session(s)`);
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (err) {
    console.error("[worker] maintenance error:", err instanceof Error ? err.message : err);
  }
  if (running) enqueueJob(db, { job_type: "memory_maintenance", aggregate_id: "memory-sweep" });
}, 10 * 60 * 1000);

console.log(`[worker] ${OWNER} polling ${JOB_TYPES.join(", ")}`);
void (async () => {
  while (running) {
    try {
      await tick();
    } catch (err) {
      console.error("[worker] tick error:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  db.close();
  console.log("[worker] stopped cleanly");
})();

export { fixturesDir };
