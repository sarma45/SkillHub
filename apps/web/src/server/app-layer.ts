/**
 * Application layer (TRD Layer 3): commands/queries. Owns idempotency-ready
 * orchestration, policy checks, state transitions, and outbox publication.
 * The API transport calls exactly one handler per request.
 */
import {
  getOrg,
  getUser,
  insertProject,
  getProject,
  listProjects,
  insertTask,
  getTask,
  listTasks,
  getLatestPlan,
  getPlan,
  getPlanByHash,
  approvePlanRow,
  insertRun,
  getRun,
  listRunsForTask,
  listRunEvents,
  listEvidence,
  insertOutboxEvent,
  casTaskState,
  updateProjectMap,
  updateRunStatus,
  requestCancel,
  enqueueJob,
  getJob,
  upsertSkill,
  listSkills,
  insertPrDraft,
  getPrDraftForRun,
  approvePrDraft,
  newEntityId,
  nowIso,
  type ProjectRow,
  type TaskRow,
  type PlanRow,
  type RunRow,
} from "@cockpit/db";
import { seed, SEED } from "@cockpit/db";
import {
  assertTransition,
  isCapabilityEnabled,
  CapabilityDisabledError,
  ROLE_SCOPES,
  planHash as computePlanHash,
  type Role,
  type Scope,
} from "@cockpit/policy";
import { CreateProjectRequest, CreateTaskRequest, TaskBriefSchema } from "@cockpit/contracts";
import type { z } from "zod";
import { SKILL_CATALOG } from "@cockpit/skill-registry";
import { fixturePath } from "@cockpit/security-service";
import { Workspace, workspaceBaseDir } from "@cockpit/execution-engine";
import {
  remember as memoryRemember,
  recall as memoryRecall,
  getMemory,
  updateMemoryContent,
  approveMemory,
  expireMemory,
  deleteMemory,
  exportMemories,
  type MemoryRow,
} from "@cockpit/memory-service";
import { assembleContextBundle, setContextDb } from "@cockpit/context-service";
import { extractSkillCandidate, reviewCandidate, listCandidates, type ExtractionSource } from "@cockpit/extraction-service";
import { listProviders, routeProvider } from "@cockpit/routing-service";
import { strixStatus } from "@cockpit/security-service";
import { capturePage } from "@cockpit/browser-service";
import { insertArtifact, insertBrowserCapture, updateBrowserCapture, listBrowserCaptures, getBrowserCapture, listMemories } from "@cockpit/db";
import { existsSync } from "node:fs";
import path from "node:path";
import { getDb } from "./db";

function db() {
  return getDb();
}

/** Ensures org/user rows exist (local dev convenience; seed is idempotent). */
export function ensureSeeded(): void {
  seed(db());
  setContextDb(db()); // context-service memory layer reads through this handle
}

// ---------- capability gate ----------

export function assertCapability(capabilityId: string): void {
  if (!isCapabilityEnabled(capabilityId)) {
    throw new CapabilityDisabledError(capabilityId);
  }
}

// ---------- projects ----------

export function createProject(input: z.infer<typeof CreateProjectRequest>): { project_id: string; status: string } {
  assertCapability("repo.local_import");
  const parsed = CreateProjectRequest.parse(input);

  const existing = listProjects(db(), SEED.org.id).find((p) => p.name === parsed.name);
  if (existing) {
    // idempotent-ish behavior at domain level for duplicate names
    return { project_id: existing.id, status: existing.status };
  }

  let sourceRef: string;
  if (parsed.source.type === "fixture") {
    sourceRef = parsed.source.fixture_id;
  } else {
    sourceRef = parsed.source.path;
  }

  const row = insertProject(db(), {
    id: newEntityId("proj"),
    organization_id: SEED.org.id,
    name: parsed.name,
    source_type: parsed.source.type === "fixture" ? "fixture" : "local",
    source_ref: sourceRef,
    permission_mode: "read_only",
    status: "indexing",
    repository_map_json: null,
    map_version: 0,
  });

  enqueueJob(db(), { job_type: "index_repository", aggregate_id: row.id });
  insertOutboxEvent(db(), {
    aggregate_type: "project",
    aggregate_id: row.id,
    event_type: "project.created",
    schema_version: "1.0",
    payload_json: JSON.stringify({ name: row.name, source_type: row.source_type }),
  });

  return { project_id: row.id, status: "indexing" };
}

export function getProjectById(projectId: string): ProjectRow {
  const row = getProject(db(), projectId);
  if (!row) throw Object.assign(new Error("project not found"), { code: "NOT_FOUND" });
  return row;
}

export function listAllProjects(): ProjectRow[] {
  return listProjects(db(), SEED.org.id);
}

export function getRepositoryMap(projectId: string): Record<string, unknown> {
  const project = getProjectById(projectId);
  if (!project.repository_map_json) {
    return { status: project.status, map: null };
  }
  return {
    project_id: project.id,
    status: project.status,
    map: JSON.parse(project.repository_map_json),
    confidence_note: "facts labeled verified|inferred|unknown per source; correct them in the UI",
  };
}

export function correctFact(projectId: string, key: string, value: string): Record<string, unknown> {
  const project = getProjectById(projectId);
  if (!project.repository_map_json) throw Object.assign(new Error("map not ready"), { code: "STATE_CONFLICT" });
  const map = JSON.parse(project.repository_map_json) as {
    facts: Array<{ key: string; value: string; label: string; source_refs: string[] }>;
  };
  const fact = map.facts.find((f) => f.key === key);
  if (fact) {
    fact.value = value;
    fact.label = "verified"; // human-corrected facts are user-observed
    fact.source_refs = ["user correction"];
  } else {
    map.facts.push({ key, value, label: "verified", source_refs: ["user correction"] });
  }
  updateProjectMap(db(), projectId, JSON.stringify(map), project.status);
  return { corrected: key };
}

// ---------- tasks ----------

export function createTask(projectId: string, input: z.infer<typeof CreateTaskRequest>): { task_id: string; status: string; brief_version: number } {
  const project = getProjectById(projectId);
  if (project.status !== "ready") {
    throw Object.assign(new Error("project is not indexed yet"), { code: "STATE_CONFLICT" });
  }
  const parsed = CreateTaskRequest.parse(input);
  const brief = TaskBriefSchema.parse({
    request: parsed.request,
    success_criteria: parsed.success_criteria,
    non_goals: parsed.non_goals,
    risk: parsed.risk,
    assumptions: [],
    open_questions: [],
  });

  const row = insertTask(db(), {
    id: newEntityId("task"),
    project_id: projectId,
    organization_id: SEED.org.id,
    request_text: parsed.request,
    brief_json: JSON.stringify(brief),
    risk: parsed.risk,
    created_by: SEED.users[0]!.id,
  });

  // DRAFT -> FRAMED by user (brief recorded)
  const created = getTask(db(), row.id)!;
  assertTransition("DRAFT", "FRAMED", "user");
  // state stored at FRAMED by insertTask; version bump journaled via outbox
  insertOutboxEvent(db(), {
    aggregate_type: "task",
    aggregate_id: row.id,
    event_type: "task.framed",
    schema_version: "1.0",
    payload_json: JSON.stringify({ project_id: projectId, risk: parsed.risk }),
  });

  return { task_id: row.id, status: created.state, brief_version: 1 };
}

export function getTaskById(taskId: string): TaskRow {
  const row = getTask(db(), taskId);
  if (!row) throw Object.assign(new Error("task not found"), { code: "NOT_FOUND" });
  return row;
}

export function listProjectTasks(projectId: string): TaskRow[] {
  return listTasks(db(), projectId);
}

// ---------- plans ----------

export function requestPlan(taskId: string): { plan_id: string; version: number; plan_hash: string } {
  assertCapability("plan.generate");
  const task = getTaskById(taskId);
  const project = getProjectById(task.project_id);
  if (!project.repository_map_json) throw Object.assign(new Error("map missing"), { code: "STATE_CONFLICT" });
  if (task.state !== "FRAMED") {
    throw Object.assign(new Error(`cannot plan from state ${task.state}`), { code: "STATE_CONFLICT" });
  }

  const job = enqueueJob(db(), { job_type: "generate_plan", aggregate_id: taskId });
  return { plan_id: job.id, version: 0, plan_hash: "" }; // async: worker fills version
}

export function getTaskPlans(taskId: string): PlanRow | undefined {
  return getLatestPlan(db(), taskId);
}

export function approvePlan(
  taskId: string,
  planVersion: number,
  input: { plan_hash: string; approved_by: string; comment?: string }
): PlanRow {
  assertCapability("plan.approve");
  const task = getTaskById(taskId);
  const planRow = getPlan(db(), taskId === task.id ? (getPlanId(taskId, planVersion) ?? "") : "");
  if (!planRow || planRow.task_id !== taskId) {
    throw Object.assign(new Error("plan not found for task/version"), { code: "NOT_FOUND" });
  }
  if (planRow.version !== planVersion) {
    throw Object.assign(new Error("plan version mismatch"), { code: "NOT_FOUND" });
  }

  // stale hash -> 409 (TRD §6.8); material change requires re-approval
  const current = computePlanHash(JSON.parse(planRow.plan_json));
  if (current !== input.plan_hash || current !== planRow.plan_hash) {
    throw Object.assign(new Error("plan hash mismatch: plan changed since approval was requested"), {
      code: "PLAN_HASH_MISMATCH",
    });
  }
  if (planRow.status !== "proposed") {
    throw Object.assign(new Error(`plan is ${planRow.status}, not approvable`), { code: "STATE_CONFLICT" });
  }

  const approved = approvePlanRow(db(), planRow.id, input.approved_by);
  const updated = casTaskState(db(), taskId, task.version, "EXECUTING");
  if (!updated) {
    throw Object.assign(new Error("task version conflict"), { code: "STALE_VERSION" });
  }
  insertOutboxEvent(db(), {
    aggregate_type: "plan",
    aggregate_id: planRow.id,
    event_type: "plan.approved",
    schema_version: "1.0",
    payload_json: JSON.stringify({ task_id: taskId, version: planRow.version, approved_by: input.approved_by }),
  });
  return approved!;
}

function getPlanId(taskId: string, version: number): string | null {
  const row = db()
    .prepare("SELECT id FROM plans WHERE task_id = ? AND version = ?")
    .get(taskId, version) as { id: string } | undefined;
  return row?.id ?? null;
}

// ---------- runs ----------

export function startRun(
  taskId: string,
  input: { plan_hash: string; workspace: "isolated"; max_duration_ms: number; max_retries: number; mode?: "normal" | "autonomous" }
): { run_id: string; status: string; mode: string } {
  assertCapability("run.execute");
  if (input.mode === "autonomous") assertCapability("run.autonomous");
  const task = getTaskById(taskId);
  if (task.state !== "EXECUTING") {
    throw Object.assign(new Error(`task must be EXECUTING to start a run (state=${task.state})`), {
      code: "STATE_CONFLICT",
    });
  }
  const planRow = getLatestPlan(db(), taskId);
  if (!planRow || planRow.status !== "approved") {
    throw Object.assign(new Error("no approved plan"), { code: "STATE_CONFLICT" });
  }
  const current = computePlanHash(JSON.parse(planRow.plan_json));
  if (current !== input.plan_hash || planRow.plan_hash !== input.plan_hash) {
    throw Object.assign(new Error("plan hash mismatch"), { code: "PLAN_HASH_MISMATCH" });
  }

  const run = insertRun(db(), {
    id: newEntityId("run"),
    task_id: taskId,
    plan_id: planRow.id,
    plan_hash: input.plan_hash,
    workspace_id: "pending",
    status: "queued",
    model_route: input.mode === "autonomous"
      ? process.env.ANTHROPIC_API_KEY
        ? "anthropic/claude-sonnet-4+tools"
        : "scripted/deterministic-v1"
      : process.env.ANTHROPIC_API_KEY
        ? "anthropic"
        : "mock",
    budget_json: JSON.stringify({
      max_duration_ms: input.max_duration_ms,
      max_retries: input.max_retries,
    }),
    started_at: null,
    ended_at: null,
    failure_code: null,
  });

  enqueueJob(db(), {
    job_type: "execute_run",
    aggregate_id: run.id,
    payload: { mode: input.mode === "autonomous" ? "autonomous" : "normal" },
  });
  return { run_id: run.id, status: "queued", mode: input.mode === "autonomous" ? "autonomous" : "normal" };
}

export function getRunById(runId: string): RunRow {
  const row = getRun(db(), runId);
  if (!row) throw Object.assign(new Error("run not found"), { code: "NOT_FOUND" });
  return row;
}

export function listTaskRuns(taskId: string): RunRow[] {
  return listRunsForTask(db(), taskId);
}

export function getRunEvents(runId: string, cursor: number): unknown[] {
  return listRunEvents(db(), runId, cursor).map((e) => ({
    id: e.id,
    sequence: e.sequence,
    event_type: e.event_type,
    actor_type: e.actor_type,
    payload: JSON.parse(e.payload_json),
    redacted: !!e.redacted,
    created_at: e.created_at,
  }));
}

export function controlRun(runId: string, action: "pause" | "resume" | "cancel"): RunRow {
  assertCapability("run.control");
  const run = getRunById(runId);
  const task = getTask(db(), run.task_id);
  if (!task) throw Object.assign(new Error("task missing"), { code: "NOT_FOUND" });

  if (action === "pause") {
    assertTransition(task.state as never, "PAUSED_FOR_HUMAN", "user");
    updateRunStatus(db(), runId, "paused");
    if (task.state === "EXECUTING") casTaskState(db(), task.id, task.version, "PAUSED_FOR_HUMAN");
  } else if (action === "resume") {
    // resume only from a genuinely paused run+task; cancelled runs are terminal
    if (run.status !== "paused") {
      throw Object.assign(new Error(`cannot resume run in status ${run.status}`), { code: "STATE_CONFLICT" });
    }
    assertTransition("PAUSED_FOR_HUMAN", "EXECUTING", "user");
    updateRunStatus(db(), runId, "running");
    const fresh = getTask(db(), task.id)!;
    casTaskState(db(), task.id, fresh.version, "EXECUTING");
  } else {
    assertTransition(task.state as never, "CANCELLED", "user");
    requestCancel(db(), runId);
    updateRunStatus(db(), runId, "cancelled", { ended_at: nowIso() });
    const fresh = getTask(db(), task.id)!;
    casTaskState(db(), task.id, fresh.version, "CANCELLED");
    enqueueJob(db(), { job_type: "evaluate_run", aggregate_id: runId });
  }
  insertOutboxEvent(db(), {
    aggregate_type: "run",
    aggregate_id: runId,
    event_type: `run.${action}d`,
    schema_version: "1.0",
    payload_json: "{}",
  });
  return getRunById(runId);
}

export async function getRunDiff(runId: string): Promise<unknown> {
  getRunById(runId);
  const wsPath = path.join(workspaceBaseDir(), runId);
  if (!existsSync(wsPath)) {
    return { files: [], total_bytes: 0, note: "workspace not retained" };
  }
  const ws = new Workspace(wsPath, `${wsPath}__pristine`);
  return ws.diff();
}

export function getRunEvidence(runId: string): unknown[] {
  return listEvidence(db(), runId).map((e) => ({
    id: e.id,
    check_type: e.check_type,
    status: e.status,
    severity: e.severity,
    label: e.label,
    command_or_method: e.command_or_method,
    result: JSON.parse(e.result_json),
    human_required: !!e.human_required,
    created_at: e.created_at,
  }));
}

// ---------- PR draft ----------

export function createPrDraft(
  runId: string,
  payload: { branch: string; title: string; body: string; acknowledged_risks: boolean }
): Record<string, unknown> {
  assertCapability("integration.pr_draft");
  const run = getRunById(runId);
  if (run.status !== "ready_for_review") {
    throw Object.assign(new Error(`run not ready for review (status=${run.status})`), { code: "STATE_CONFLICT" });
  }
  const evidence = listEvidence(db(), runId);
  const blocking = evidence.filter((e) => e.status === "failed" && ["high", "critical"].includes(e.severity));
  if (blocking.length > 0) {
    throw Object.assign(
      new Error(`blocking findings must be resolved first: ${blocking.map((b) => b.check_type).join(", ")}`),
      { code: "DOMAIN_VALIDATION_FAILED" }
    );
  }
  if (!payload.acknowledged_risks) {
    throw Object.assign(new Error("reviewer must acknowledge unresolved risks before PR draft"), {
      code: "DOMAIN_VALIDATION_FAILED",
    });
  }
  const draft = insertPrDraft(db(), {
    id: newEntityId("prd"),
    run_id: runId,
    payload_json: JSON.stringify(payload),
    evidence_ids_json: JSON.stringify(evidence.map((e) => e.id)),
  });
  const task = getTask(db(), run.task_id)!;
  casTaskState(db(), task.id, task.version, "AWAITING_INTEGRATION_APPROVAL");
  insertOutboxEvent(db(), {
    aggregate_type: "run",
    aggregate_id: runId,
    event_type: "integration.pr_draft_created",
    schema_version: "1.0",
    payload_json: JSON.stringify({ draft_id: draft.id }),
  });
  return {
    draft_id: draft.id,
    run_id: runId,
    status: "draft_pending_approval",
    payload,
    evidence_ids: evidence.map((e) => e.id),
    created_at: draft.created_at,
  };
}

export function approvePrDraftForRun(runId: string): Record<string, unknown> {
  assertCapability("integration.pr_draft");
  // GitHub submission is dormant: approval records human intent, nothing external runs
  assertCapability("integration.github_submit");
  const draft = approvePrDraft(db(), runId);
  if (!draft) throw Object.assign(new Error("no pending draft"), { code: "NOT_FOUND" });
  const run = getRunById(runId);
  const task = getTask(db(), run.task_id);
  if (task) casTaskState(db(), task.id, task.version, "INTEGRATED");
  return { draft_id: draft.id, status: draft.status, note: "approved locally; GitHub submission capability is dormant in MVP" };
}

export function getPrDraft(runId: string): Record<string, unknown> | null {
  const d = getPrDraftForRun(db(), runId);
  if (!d) return null;
  return { draft_id: d.id, status: d.status, payload: JSON.parse(d.payload_json) };
}

// ---------- skills ----------

export function listSkillCatalog(): unknown[] {
  return listSkills(db(), SEED.org.id).map((s) => ({
    skill_id: s.skill_id,
    version: s.version,
    name: s.name,
    purpose: s.purpose,
    source_repo: s.source_repo,
    source_url: s.source_url,
    license: s.license,
    category: s.category,
    phase: s.phase,
    status: s.status,
    manifest: JSON.parse(s.manifest_json),
  }));
}

export function seedSkillCatalog(): void {
  for (const entry of SKILL_CATALOG) {
    upsertSkill(db(), {
      organization_id: SEED.org.id,
      skill_id: entry.manifest.id,
      version: entry.manifest.version,
      name: entry.manifest.name,
      purpose: entry.manifest.purpose,
      source_repo: entry.manifest.source_repo,
      source_url: entry.manifest.source_url,
      source_commit: entry.manifest.source_commit,
      license: entry.manifest.license,
      category: entry.manifest.category,
      phase: entry.manifest.phase,
      manifest_json: JSON.stringify(entry.manifest),
      status: entry.manifest.status,
      owner: entry.manifest.status === "approved" ? "platform-team" : "catalog",
    });
  }
}

// ---------- security ----------

export function createSecurityScanJob(input: {
  target: string;
  mode: "baseline" | "strix";
  authorizer: string;
}): { job_id: string; manifest_id: string } {
  assertCapability("security.local_fixture_scan");
  const manifest = {
    manifest_id: newEntityId("man"),
    authorizer: input.authorizer,
    environment: "local" as const,
    targets: [{ kind: "local_path" as const, value: input.target }],
    exclusions: [],
    allowed_actions: ["passive_scan" as const],
    forbidden_actions: ["destructive payloads", "credential harvesting", "denial of service"],
    rate_limit_rps: 5,
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: new Date(Date.now() + 3600_000).toISOString(),
  };
  const job = enqueueJob(db(), {
    job_type: "security_scan",
    aggregate_id: manifest.manifest_id,
    payload: { scope_manifest: manifest, mode: input.mode },
  });
  return { job_id: job.id, manifest_id: manifest.manifest_id };
}

// ---------- roles helper ----------

export function scopesForRole(role: string): readonly Scope[] {
  return ROLE_SCOPES[role as Role] ?? [];
}

export function getOrgInfo() {
  return getOrg(db(), SEED.org.id);
}

export function getUserInfo(userId: string) {
  return getUser(db(), userId);
}

// ---------- memory (Phase 4 — REAL feature) ----------

export function createMemory(input: {
  scope: MemoryRow["scope"];
  kind: MemoryRow["kind"];
  content: string;
  project_id?: string | null;
  confidence?: number;
  sensitivity?: MemoryRow["sensitivity"];
  source_refs?: string[];
}): Record<string, unknown> {
  assertCapability("memory.service");
  const { row, requiresApproval } = memoryRemember(db(), {
    organizationId: SEED.org.id,
    projectId: input.project_id ?? null,
    runId: null,
    scope: input.scope,
    kind: input.kind,
    content: input.content,
    sourceRefs: input.source_refs ?? [],
    confidence: input.confidence ?? 0.9,
    createdBy: "human",
    sensitivity: input.sensitivity,
  });
  return { memory_id: row.id, status: row.status, requires_approval: requiresApproval };
}

export function listAllMemories(filter: { kind?: string; scope?: string; project_id?: string } = {}): unknown[] {
  assertCapability("memory.service");
  const rows = listMemories(db(), {
    organizationId: SEED.org.id,
    projectId: filter.project_id ?? null,
    kind: filter.kind as MemoryRow["kind"] | undefined,
    scope: filter.scope as MemoryRow["scope"] | undefined,
    includeUnapproved: true,
    limit: 200,
  });
  return rows.map((m) => ({
    id: m.id,
    scope: m.scope,
    kind: m.kind,
    content: m.content,
    confidence: m.confidence,
    created_by: m.created_by,
    approved: !!m.approved,
    sensitivity: m.sensitivity,
    status: m.status,
    source_refs: JSON.parse(m.source_refs_json) as string[],
    project_id: m.project_id,
    run_id: m.run_id,
    created_at: m.created_at,
  }));
}

export function editMemory(id: string, content: string): Record<string, unknown> {
  assertCapability("memory.service");
  const row = updateMemoryContent(db(), id, content);
  if (!row) throw Object.assign(new Error("memory not found"), { code: "NOT_FOUND" });
  return { memory_id: row.id, updated: true };
}

export function approveMemoryById(id: string): Record<string, unknown> {
  assertCapability("memory.service");
  const row = approveMemory(db(), id);
  if (!row) throw Object.assign(new Error("memory not found"), { code: "NOT_FOUND" });
  return { memory_id: row.id, approved: true, note: "approved: this memory can now influence future plans and runs" };
}

export function expireMemoryById(id: string): Record<string, unknown> {
  assertCapability("memory.service");
  const row = expireMemory(db(), id);
  if (!row) throw Object.assign(new Error("memory not found"), { code: "NOT_FOUND" });
  return { memory_id: row.id, status: row.status };
}

export function deleteMemoryById(id: string): Record<string, unknown> {
  assertCapability("memory.service");
  const row = deleteMemory(db(), id);
  if (!row) throw Object.assign(new Error("memory not found"), { code: "NOT_FOUND" });
  return { memory_id: row.id, deleted: true };
}

export function exportAllMemories(): unknown {
  assertCapability("memory.service");
  return exportMemories(db(), SEED.org.id);
}

// ---------- context bundle (Phase 1/4 — REAL feature) ----------

export async function buildContextBundleFor(projectId: string, taskRequest: string): Promise<unknown> {
  assertCapability("context.bundle");
  const project = getProjectById(projectId);
  if (!project.repository_map_json) {
    throw Object.assign(new Error("project map not ready"), { code: "STATE_CONFLICT" });
  }
  const sourceRoot =
    project.source_type === "fixture" ? fixturePath(project.source_ref) : path.resolve(project.source_ref);
  const bundle = await assembleContextBundle({
    organizationId: project.organization_id,
    projectId: project.id,
    projectRoot: sourceRoot,
    map: JSON.parse(project.repository_map_json) as never,
    taskRequest,
  });
  return bundle;
}

// ---------- browser verification (Phase 6 — REAL feature) ----------

export async function createBrowserCapture(input: { url: string; expect_text?: string }): Promise<Record<string, unknown>> {
  assertCapability("browser.verify");
  const captureId = newEntityId("cap");
  const row = insertBrowserCapture(db(), {
    id: captureId,
    run_id: null,
    url: input.url,
    title: null,
    status: "capturing",
    browser_path: null,
    console_messages_json: "[]",
    http_failures_json: "[]",
    viewport_json: JSON.stringify({ width: 1280, height: 900 }),
  });

  const capture = await capturePage({
    url: input.url,
    outDir: path.join(workspaceBaseDir(), "_captures"),
    captureId,
    settleMs: 2500,
  });

  let artifactId: string | null = null;
  if (capture.screenshot_path) {
    try {
      const { readFile } = await import("node:fs/promises");
      const { createHash } = await import("node:crypto");
      const buf = await readFile(capture.screenshot_path);
      // artifacts require a real project FK; attach to the most recent project
      const owner = listAllProjects()[0];
      if (!owner) throw new Error("no project exists to attach the capture to");
      const artifact = insertArtifact(db(), {
        id: newEntityId("art"),
        project_id: owner.id,
        run_id: null,
        kind: "screenshot",
        uri: capture.screenshot_path,
        sha256: createHash("sha256").update(buf).digest("hex"),
        size_bytes: buf.length,
        sensitivity: "internal",
        metadata_json: JSON.stringify({ content_type: "image/png", capture_id: captureId }),
      });
      artifactId = artifact.id;
    } catch {
      artifactId = null;
    }
  }

  updateBrowserCapture(db(), captureId, {
    status: capture.ok ? "captured" : "failed",
    title: capture.title,
    console_messages_json: JSON.stringify(capture.console_messages),
    http_failures_json: JSON.stringify(capture.http_failures),
  });

  return {
    capture_id: captureId,
    artifact_id: artifactId,
    url: capture.url,
    title: capture.title,
    ok: capture.ok,
    error: capture.error,
    console_messages: capture.console_messages,
    http_failures: capture.http_failures,
    page_errors: capture.page_errors,
    screenshot_path: capture.screenshot_path,
  };
}

export function listAllBrowserCaptures(): unknown[] {
  return listBrowserCaptures(db(), null).map((c) => {
    const art = db()
      .prepare("SELECT id FROM artifacts WHERE kind = 'screenshot' AND metadata_json LIKE ? ORDER BY created_at DESC LIMIT 1")
      .get(`%"capture_id":"${c.id}"%`) as { id: string } | undefined;
    return {
      id: c.id,
      artifact_id: art?.id ?? null,
      url: c.url,
      title: c.title,
      status: c.status,
      created_at: c.created_at,
      console_messages: JSON.parse(c.console_messages_json) as unknown[],
      http_failures: JSON.parse(c.http_failures_json) as unknown[],
    };
  });
}

export function getBrowserCaptureById(id: string): unknown {
  const c = getBrowserCapture(db(), id);
  if (!c) throw Object.assign(new Error("capture not found"), { code: "NOT_FOUND" });
  return { ...c, console_messages: JSON.parse(c.console_messages_json), http_failures: JSON.parse(c.http_failures_json) };
}

// ---------- skill extraction (book-to-skill — REAL pipeline) ----------

export async function createSkillExtraction(input: {
  source: ExtractionSource;
  category?: string;
}): Promise<Record<string, unknown>> {
  const { candidate, row } = await extractSkillCandidate(db(), SEED.org.id, input.source, {
    category: input.category,
  });
  insertOutboxEvent(db(), {
    aggregate_type: "skill",
    aggregate_id: row.id,
    event_type: "skill.extracted",
    schema_version: "1.0",
    payload_json: JSON.stringify({ skill_id: row.skill_id, license: candidate.license, warnings: candidate.warnings.length }),
  });
  return { candidate, skill_id: row.skill_id, status: row.status, requires_review: true };
}

export function listSkillCandidates(): unknown[] {
  return listCandidates(db(), SEED.org.id).map((s) => ({
    skill_id: s.skill_id,
    name: s.name,
    purpose: s.purpose,
    category: s.category,
    license: s.license,
    status: s.status,
    created_at: s.created_at,
  }));
}

export function reviewSkillCandidate(skillId: string, decision: "approve" | "reject" | "promote_reviewed"): Record<string, unknown> {
  const row = reviewCandidate(db(), SEED.org.id, skillId, decision);
  insertOutboxEvent(db(), {
    aggregate_type: "skill",
    aggregate_id: row.id,
    event_type: `skill.${decision}`,
    schema_version: "1.0",
    payload_json: JSON.stringify({ skill_id: skillId, status: row.status }),
  });
  return { skill_id: skillId, status: row.status };
}

// ---------- routing (providers.multi — REAL catalog) ----------

export function getProviderCatalog(): unknown {
  return { providers: listProviders(), routing_policy_note: "deterministic: keys first, then purpose-fit, then cost, then latency" };
}

export function getRoutingDecision(purpose: string): unknown {
  const allowed = ["planning", "editing", "tools", "verification_analysis"] as const;
  if (!allowed.includes(purpose as never)) {
    throw Object.assign(new Error(`invalid purpose ${purpose}`), { code: "DOMAIN_VALIDATION_FAILED" });
  }
  return routeProvider(purpose as "planning");
}

// ---------- strix preflight ----------

export async function getStrixStatus(): Promise<unknown> {
  return strixStatus();
}
