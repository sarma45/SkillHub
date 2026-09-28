/**
 * Row-level repositories. Keep SQL here; services above consume typed rows.
 * Every mutable aggregate uses an explicit version column for CAS.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function uuid(): string {
  return randomUUID();
}

export function newEntityId(prefix: string): string {
  return `${prefix}_${uuid().replace(/-/g, "").slice(0, 20)}`;
}

// ---------- organizations / users ----------

export function getOrg(db: DB, id: string) {
  return db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as
    | { id: string; name: string }
    | undefined;
}

export function getUser(db: DB, id: string) {
  return db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as { id: string; email: string; role: string; organization_id: string } | undefined;
}

export function listUsers(db: DB) {
  return db.prepare("SELECT * FROM users ORDER BY created_at").all() as Array<{
    id: string;
    email: string;
    display_name: string;
    role: string;
    organization_id: string;
  }>;
}

// ---------- projects ----------

export interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  source_type: "local" | "fixture";
  source_ref: string;
  permission_mode: string;
  status: "indexing" | "ready" | "failed" | "needs_input";
  repository_map_json: string | null;
  map_version: number;
  created_at: string;
  updated_at: string;
}

export function insertProject(db: DB, p: Omit<ProjectRow, "created_at" | "updated_at">): ProjectRow {
  const row = { ...p, created_at: nowIso(), updated_at: nowIso() };
  db.prepare(
    `INSERT INTO projects (id, organization_id, name, source_type, source_ref, permission_mode, status, repository_map_json, map_version, created_at, updated_at)
     VALUES (@id, @organization_id, @name, @source_type, @source_ref, @permission_mode, @status, @repository_map_json, @map_version, @created_at, @updated_at)`
  ).run(row);
  return row;
}

export function getProject(db: DB, id: string): ProjectRow | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

export function listProjects(db: DB, orgId: string): ProjectRow[] {
  return db
    .prepare("SELECT * FROM projects WHERE organization_id = ? ORDER BY created_at DESC")
    .all(orgId) as ProjectRow[];
}

export function updateProjectMap(db: DB, id: string, mapJson: string, status: ProjectRow["status"]) {
  db.prepare(
    "UPDATE projects SET repository_map_json = ?, map_version = map_version + 1, status = ?, updated_at = ? WHERE id = ?"
  ).run(mapJson, status, nowIso(), id);
}

export function setProjectStatus(db: DB, id: string, status: ProjectRow["status"]) {
  db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
}

// ---------- tasks ----------

export interface TaskRow {
  id: string;
  project_id: string;
  organization_id: string;
  request_text: string;
  brief_json: string;
  risk: string;
  state: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function insertTask(db: DB, t: Omit<TaskRow, "created_at" | "updated_at" | "version" | "state">): TaskRow {
  const row = { ...t, state: "FRAMED", version: 0, created_at: nowIso(), updated_at: nowIso() };
  db.prepare(
    `INSERT INTO tasks (id, project_id, organization_id, request_text, brief_json, risk, state, version, created_by, created_at, updated_at)
     VALUES (@id, @project_id, @organization_id, @request_text, @brief_json, @risk, @state, @version, @created_by, @created_at, @updated_at)`
  ).run(row);
  return row;
}

export function getTask(db: DB, id: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
}

export function listTasks(db: DB, projectId: string): TaskRow[] {
  return db
    .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as TaskRow[];
}

/**
 * Compare-and-swap state update. Fails (returns undefined) when the caller's
 * expectedVersion no longer matches — the TRD §5.3 aggregate version rule.
 */
export function casTaskState(
  db: DB,
  id: string,
  expectedVersion: number,
  nextState: string
): TaskRow | undefined {
  const res = db
    .prepare("UPDATE tasks SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
    .run(nextState, nowIso(), id, expectedVersion);
  if (res.changes === 0) return undefined;
  return getTask(db, id);
}

// ---------- plans ----------

export interface PlanRow {
  id: string;
  task_id: string;
  version: number;
  plan_hash: string;
  plan_json: string;
  status: "proposed" | "approved" | "rejected" | "superseded" | "stale";
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export function insertPlan(db: DB, p: Omit<PlanRow, "created_at" | "version">): PlanRow {
  const next = (
    db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM plans WHERE task_id = ?").get(p.task_id) as {
      v: number;
    }
  ).v;
  const row = { ...p, version: next, created_at: nowIso() };
  db.prepare(
    `INSERT INTO plans (id, task_id, version, plan_hash, plan_json, status, approved_by, approved_at, created_at)
     VALUES (@id, @task_id, @version, @plan_hash, @plan_json, @status, @approved_by, @approved_at, @created_at)`
  ).run(row);
  // supersede older proposals
  db.prepare("UPDATE plans SET status = 'superseded' WHERE task_id = ? AND id != ? AND status = 'proposed'").run(
    p.task_id,
    p.id
  );
  return row;
}

export function getPlan(db: DB, id: string): PlanRow | undefined {
  return db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
}

export function getLatestPlan(db: DB, taskId: string): PlanRow | undefined {
  return db
    .prepare("SELECT * FROM plans WHERE task_id = ? ORDER BY version DESC LIMIT 1")
    .get(taskId) as PlanRow | undefined;
}

export function getPlanByHash(db: DB, taskId: string, hash: string): PlanRow | undefined {
  return db
    .prepare("SELECT * FROM plans WHERE task_id = ? AND plan_hash = ? ORDER BY version DESC LIMIT 1")
    .get(taskId, hash) as PlanRow | undefined;
}

export function approvePlanRow(
  db: DB,
  planId: string,
  approvedBy: string
): PlanRow | undefined {
  db.prepare("UPDATE plans SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").run(
    approvedBy,
    nowIso(),
    planId
  );
  return getPlan(db, planId);
}

// ---------- runs ----------

export interface RunRow {
  id: string;
  task_id: string;
  plan_id: string;
  plan_hash: string;
  workspace_id: string;
  status:
    | "queued"
    | "running"
    | "paused"
    | "verifying"
    | "needs_repair"
    | "ready_for_review"
    | "awaiting_integration_approval"
    | "integrated"
    | "cancelled"
    | "failed";
  attempt: number;
  model_route: string;
  budget_json: string;
  budget_used_json: string;
  started_at: string | null;
  ended_at: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

export function insertRun(db: DB, r: Omit<RunRow, "created_at" | "updated_at" | "budget_used_json" | "attempt">): RunRow {
  const row = { ...r, attempt: 0, budget_used_json: "{}", created_at: nowIso(), updated_at: nowIso() };
  db.prepare(
    `INSERT INTO runs (id, task_id, plan_id, plan_hash, workspace_id, status, attempt, model_route, budget_json, budget_used_json, started_at, ended_at, failure_code, created_at, updated_at)
     VALUES (@id, @task_id, @plan_id, @plan_hash, @workspace_id, @status, @attempt, @model_route, @budget_json, @budget_used_json, @started_at, @ended_at, @failure_code, @created_at, @updated_at)`
  ).run(row);
  return row;
}

export function getRun(db: DB, id: string): RunRow | undefined {
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
}

export function listRunsForTask(db: DB, taskId: string): RunRow[] {
  return db.prepare("SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as RunRow[];
}

export function updateRunStatus(db: DB, id: string, status: RunRow["status"], extra?: Partial<RunRow>) {
  const run = getRun(db, id);
  if (!run) return undefined;
  const next = { ...run, ...extra, status, updated_at: nowIso() };
  db.prepare(
    `UPDATE runs SET status=@status, attempt=@attempt, budget_used_json=@budget_used_json, started_at=@started_at, ended_at=@ended_at, failure_code=@failure_code, updated_at=@updated_at WHERE id=@id`
  ).run({
    status: next.status,
    attempt: next.attempt,
    budget_used_json: next.budget_used_json,
    started_at: next.started_at,
    ended_at: next.ended_at,
    failure_code: next.failure_code,
    updated_at: next.updated_at,
    id,
  });
  return getRun(db, id);
}

// ---------- run events ----------

export interface RunEventRow {
  id: string;
  run_id: string;
  sequence: number;
  event_type: string;
  actor_type: string;
  payload_json: string;
  redacted: number;
  created_at: string;
}

export function insertRunEvent(
  db: DB,
  e: Omit<RunEventRow, "created_at" | "sequence" | "id">
): RunEventRow {
  const seq = (
    db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS s FROM run_events WHERE run_id = ?").get(e.run_id) as {
      s: number;
    }
  ).s;
  const row = { ...e, id: newEntityId("evt"), sequence: seq, created_at: nowIso() };
  db.prepare(
    `INSERT INTO run_events (id, run_id, sequence, event_type, actor_type, payload_json, redacted, created_at)
     VALUES (@id, @run_id, @sequence, @event_type, @actor_type, @payload_json, @redacted, @created_at)`
  ).run(row);
  return row;
}

export function listRunEvents(db: DB, runId: string, afterSequence = 0, limit = 500): RunEventRow[] {
  return db
    .prepare(
      "SELECT * FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?"
    )
    .all(runId, afterSequence, limit) as RunEventRow[];
}

// ---------- artifacts / evidence ----------

export interface ArtifactRow {
  id: string;
  project_id: string;
  run_id: string | null;
  kind: string;
  uri: string;
  sha256: string;
  size_bytes: number;
  sensitivity: string;
  metadata_json: string;
  created_at: string;
}

export function insertArtifact(db: DB, a: Omit<ArtifactRow, "created_at">): ArtifactRow {
  const row = { ...a, created_at: nowIso() };
  db.prepare(
    `INSERT INTO artifacts (id, project_id, run_id, kind, uri, sha256, size_bytes, sensitivity, metadata_json, created_at)
     VALUES (@id, @project_id, @run_id, @kind, @uri, @sha256, @size_bytes, @sensitivity, @metadata_json, @created_at)`
  ).run(row);
  return row;
}

export function getArtifact(db: DB, id: string): ArtifactRow | undefined {
  return db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
}

export interface EvidenceRow {
  id: string;
  run_id: string;
  check_type: string;
  status: "passed" | "failed" | "warning" | "skipped" | "pending";
  severity: string;
  label: string;
  command_or_method: string;
  artifact_id: string | null;
  result_json: string;
  human_required: number;
  created_at: string;
}

export function insertEvidence(db: DB, e: Omit<EvidenceRow, "created_at">): EvidenceRow {
  const row = { ...e, created_at: nowIso() };
  db.prepare(
    `INSERT INTO evidence (id, run_id, check_type, status, severity, label, command_or_method, artifact_id, result_json, human_required, created_at)
     VALUES (@id, @run_id, @check_type, @status, @severity, @label, @command_or_method, @artifact_id, @result_json, @human_required, @created_at)`
  ).run(row);
  return row;
}

export function listEvidence(db: DB, runId: string): EvidenceRow[] {
  return db.prepare("SELECT * FROM evidence WHERE run_id = ? ORDER BY created_at").all(runId) as EvidenceRow[];
}

// ---------- idempotency ----------

export interface IdempotencyRow {
  id: string;
  organization_id: string;
  actor_id: string;
  idempotency_key: string;
  route: string;
  request_hash: string;
  response_status: number;
  response_body: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export function findIdempotentResponse(
  db: DB,
  orgId: string,
  actorId: string,
  key: string,
  route: string
): IdempotencyRow | undefined {
  return db
    .prepare(
      "SELECT * FROM idempotency_records WHERE organization_id = ? AND actor_id = ? AND idempotency_key = ? AND route = ?"
    )
    .get(orgId, actorId, key, route) as IdempotencyRow | undefined;
}

export function saveIdempotentResponse(
  db: DB,
  rec: Omit<IdempotencyRow, "id" | "created_at" | "status">
): void {
  db.prepare(
    `INSERT INTO idempotency_records (id, organization_id, actor_id, idempotency_key, route, request_hash, response_status, response_body, status, expires_at, created_at)
     VALUES (@id, @organization_id, @actor_id, @idempotency_key, @route, @request_hash, @response_status, @response_body, 'completed', @expires_at, @created_at)`
  ).run({ ...rec, id: newEntityId("idm"), created_at: nowIso() });
}

// ---------- outbox ----------

export interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  schema_version: string;
  payload_json: string;
  sequence: number;
  published: number;
  created_at: string;
}

export function insertOutboxEvent(
  db: DB,
  e: Omit<OutboxRow, "id" | "created_at" | "sequence" | "published">
): OutboxRow {
  const seq = (
    db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS s FROM outbox_events").get() as { s: number }
  ).s;
  const row = { ...e, id: newEntityId("obx"), sequence: seq, published: 0, created_at: nowIso() };
  db.prepare(
    `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, schema_version, payload_json, sequence, published, created_at)
     VALUES (@id, @aggregate_type, @aggregate_id, @event_type, @schema_version, @payload_json, @sequence, @published, @created_at)`
  ).run(row);
  return row;
}

export function listUnpublishedOutbox(db: DB, limit = 100): OutboxRow[] {
  return db
    .prepare("SELECT * FROM outbox_events WHERE published = 0 ORDER BY sequence ASC LIMIT ?")
    .all(limit) as OutboxRow[];
}

export function markOutboxPublished(db: DB, ids: string[]): void {
  const stmt = db.prepare("UPDATE outbox_events SET published = 1 WHERE id = ?");
  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) stmt.run(id);
  });
  tx(ids);
}

// ---------- job leases ----------

export interface JobRow {
  id: string;
  job_type: string;
  aggregate_id: string;
  attempt: number;
  max_attempts: number;
  lease_owner: string | null;
  fencing_token: number;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  cancel_requested: number;
  status: string;
  failure_code: string | null;
  retry_class: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

export function enqueueJob(
  db: DB,
  j: { job_type: string; aggregate_id: string; payload?: Record<string, unknown>; max_attempts?: number }
): JobRow {
  const now = nowIso();
  const row = {
    id: newEntityId("job"),
    job_type: j.job_type,
    aggregate_id: j.aggregate_id,
    attempt: 0,
    max_attempts: j.max_attempts ?? 3,
    lease_owner: null,
    fencing_token: 0,
    lease_expires_at: null,
    heartbeat_at: null,
    cancel_requested: 0,
    status: "queued",
    failure_code: null,
    retry_class: "none",
    payload_json: JSON.stringify(j.payload ?? {}),
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO job_leases (id, job_type, aggregate_id, attempt, max_attempts, lease_owner, fencing_token, lease_expires_at, heartbeat_at, cancel_requested, status, failure_code, retry_class, payload_json, created_at, updated_at)
     VALUES (@id, @job_type, @aggregate_id, @attempt, @max_attempts, @lease_owner, @fencing_token, @lease_expires_at, @heartbeat_at, @cancel_requested, @status, @failure_code, @retry_class, @payload_json, @created_at, @updated_at)`
  ).run(row);
  return row;
}

/**
 * Claim a queued job with a lease (compare-and-swap on status). fencing_token
 * increments so stale workers write nothing (TRD §7.2).
 */
export function claimJob(db: DB, jobType: string, owner: string, leaseMs: number): JobRow | undefined {
  const now = nowIso();
  const row = db
    .prepare(
      "SELECT * FROM job_leases WHERE job_type = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1"
    )
    .get(jobType) as JobRow | undefined;
  if (!row) return undefined;
  const res = db
    .prepare(
      "UPDATE job_leases SET status = 'running', lease_owner = ?, fencing_token = fencing_token + 1, lease_expires_at = ?, heartbeat_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'"
    )
    .run(owner, new Date(Date.now() + leaseMs).toISOString(), now, now, row.id);
  if (res.changes === 0) return undefined;
  return getJob(db, row.id);
}

export function getJob(db: DB, id: string): JobRow | undefined {
  return db.prepare("SELECT * FROM job_leases WHERE id = ?").get(id) as JobRow | undefined;
}

export function heartbeatJob(db: DB, id: string, owner: string, leaseMs: number): boolean {
  const res = db
    .prepare(
      "UPDATE job_leases SET heartbeat_at = ?, lease_expires_at = ? WHERE id = ? AND lease_owner = ? AND status = 'running'"
    )
    .run(nowIso(), new Date(Date.now() + leaseMs).toISOString(), id, owner);
  return res.changes > 0;
}

export function requestCancel(db: DB, runId: string): void {
  // cancel flag fans out to all queued/running jobs for this aggregate
  db.prepare("UPDATE job_leases SET cancel_requested = 1, updated_at = ? WHERE aggregate_id = ? AND status IN ('queued','running')").run(nowIso(), runId);
}

export function isCancelRequested(db: DB, jobId: string): boolean {
  const j = getJob(db, jobId);
  return !!j && j.cancel_requested === 1;
}

export function completeJob(db: DB, id: string, owner: string): boolean {
  const res = db
    .prepare("UPDATE job_leases SET status = 'succeeded', updated_at = ? WHERE id = ? AND lease_owner = ? AND status = 'running'")
    .run(nowIso(), id, owner);
  return res.changes > 0;
}

export function failJob(db: DB, id: string, owner: string, code: string, retryClass: string): boolean {
  const j = getJob(db, id);
  if (!j) return false;
  const nextAttempt = j.attempt + 1;
  const willRetry = retryClass === "new_attempt" && nextAttempt < j.max_attempts;
  const res = db
    .prepare(
      "UPDATE job_leases SET status = ?, attempt = ?, failure_code = ?, retry_class = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND lease_owner = ?"
    )
    .run(willRetry ? "queued" : "failed", nextAttempt, code, retryClass, nowIso(), id, owner);
  return res.changes > 0;
}

// ---------- skills ----------

export interface SkillRow {
  id: string;
  organization_id: string;
  skill_id: string;
  version: string;
  name: string;
  purpose: string;
  source_repo: string | null;
  source_url: string | null;
  source_commit: null | string;
  license: string | null;
  category: string;
  phase: number | null;
  manifest_json: string;
  status: string;
  owner: string;
  created_at: string;
}

export function upsertSkill(db: DB, s: Omit<SkillRow, "id" | "created_at">): SkillRow {
  const existing = db
    .prepare("SELECT id FROM skills WHERE organization_id = ? AND skill_id = ?")
    .get(s.organization_id, s.skill_id) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE skills SET version=@version, name=@name, purpose=@purpose, source_repo=@source_repo, source_url=@source_url, source_commit=@source_commit, license=@license, category=@category, phase=@phase, manifest_json=@manifest_json, status=@status, owner=@owner WHERE id=@id`
    ).run({ ...s, id: existing.id });
    return db.prepare("SELECT * FROM skills WHERE id = ?").get(existing.id) as SkillRow;
  }
  const row = { ...s, id: newEntityId("skl"), created_at: nowIso() };
  db.prepare(
    `INSERT INTO skills (id, organization_id, skill_id, version, name, purpose, source_repo, source_url, source_commit, license, category, phase, manifest_json, status, owner, created_at)
     VALUES (@id, @organization_id, @skill_id, @version, @name, @purpose, @source_repo, @source_url, @source_commit, @license, @category, @phase, @manifest_json, @status, @owner, @created_at)`
  ).run(row);
  return row;
}

export function listSkills(db: DB, orgId: string): SkillRow[] {
  return db
    .prepare("SELECT * FROM skills WHERE organization_id = ? ORDER BY category, name")
    .all(orgId) as SkillRow[];
}

export function getSkill(db: DB, orgId: string, skillId: string): SkillRow | undefined {
  return db
    .prepare("SELECT * FROM skills WHERE organization_id = ? AND skill_id = ?")
    .get(orgId, skillId) as SkillRow | undefined;
}

export function listApprovedSkills(db: DB, orgId: string): SkillRow[] {
  return db
    .prepare("SELECT * FROM skills WHERE organization_id = ? AND status = 'approved'")
    .all(orgId) as SkillRow[];
}

// ---------- decisions (deterministic receipts in MVP; Jev dormant) ----------

export function insertDecision(db: DB, d: {
  project_id: string;
  run_id: string | null;
  decision_kind: string;
  state_hash: string | null;
  provider: string;
  question_json: string;
  answer_json: string;
  confidence: number | null;
  policy_version: string;
  action: string;
  human_override: number | null;
}): void {
  db.prepare(
    `INSERT INTO decisions (id, project_id, run_id, decision_kind, state_hash, provider, question_json, answer_json, confidence, policy_version, action, human_override, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newEntityId("dec"),
    d.project_id,
    d.run_id,
    d.decision_kind,
    d.state_hash,
    d.provider,
    d.question_json,
    d.answer_json,
    d.confidence,
    d.policy_version,
    d.action,
    d.human_override,
    nowIso()
  );
}

// ---------- PR drafts ----------

export interface PrDraftRow {
  id: string;
  run_id: string;
  payload_json: string;
  status: "draft_pending_approval" | "approved_not_submitted" | "submitted";
  evidence_ids_json: string;
  created_at: string;
}

export function insertPrDraft(db: DB, d: Omit<PrDraftRow, "created_at" | "status">): PrDraftRow {
  const row = { ...d, status: "draft_pending_approval" as const, created_at: nowIso() };
  db.prepare(
    "INSERT INTO pr_drafts (id, run_id, payload_json, status, evidence_ids_json, created_at) VALUES (@id, @run_id, @payload_json, @status, @evidence_ids_json, @created_at)"
  ).run(row);
  return row;
}

export function getPrDraftForRun(db: DB, runId: string): PrDraftRow | undefined {
  return db.prepare("SELECT * FROM pr_drafts WHERE run_id = ? ORDER BY created_at DESC LIMIT 1").get(runId) as
    | PrDraftRow
    | undefined;
}

export function approvePrDraft(db: DB, runId: string): PrDraftRow | undefined {
  db.prepare("UPDATE pr_drafts SET status = 'approved_not_submitted' WHERE run_id = ? AND status = 'draft_pending_approval'").run(runId);
  return getPrDraftForRun(db, runId);
}

// ---------- memories (Phase 4 service) ----------

export interface MemoryRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  run_id: string | null;
  scope: "user" | "team" | "project" | "task";
  kind: "fact" | "preference" | "decision" | "lesson" | "artifact";
  content: string;
  source_refs_json: string;
  confidence: number;
  created_by: "human" | "agent" | "import";
  approved: number;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
  status: "active" | "expired" | "deleted";
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function insertMemory(db: DB, m: Omit<MemoryRow, "created_at" | "updated_at" | "status">): MemoryRow {
  const now = nowIso();
  const row = { ...m, status: "active" as const, created_at: now, updated_at: now };
  db.prepare(
    `INSERT INTO memories (id, organization_id, project_id, run_id, scope, kind, content, source_refs_json, confidence, created_by, approved, sensitivity, status, expires_at, created_at, updated_at)
     VALUES (@id, @organization_id, @project_id, @run_id, @scope, @kind, @content, @source_refs_json, @confidence, @created_by, @approved, @sensitivity, @status, @expires_at, @created_at, @updated_at)`
  ).run(row);
  return row;
}

export function getMemory(db: DB, id: string): MemoryRow | undefined {
  return db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined;
}

export interface MemoryQuery {
  organizationId: string;
  projectId?: string | null;
  scope?: MemoryRow["scope"];
  kind?: MemoryRow["kind"];
  includeUnapproved?: boolean;
  includeExpired?: boolean;
  limit?: number;
}

export function listMemories(db: DB, q: MemoryQuery): MemoryRow[] {
  const where: string[] = ["organization_id = @organizationId", "status = 'active'"];
  if (q.projectId) where.push("(project_id = @projectId OR scope IN ('user','team'))");
  if (q.scope) where.push("scope = @scope");
  if (q.kind) where.push("kind = @kind");
  if (!q.includeUnapproved) where.push("approved = 1");
  if (q.includeExpired) where.splice(1, 1); // drop status filter when explicitly asked
  where.push("(expires_at IS NULL OR expires_at > @now)");
  const rows = db
    .prepare(
      `SELECT * FROM memories WHERE ${where.join(" AND ")} ORDER BY confidence DESC, created_at DESC LIMIT @limit`
    )
    .all({ ...q, limit: q.limit ?? 100, now: nowIso() }) as MemoryRow[];
  return rows;
}

export function updateMemoryContent(db: DB, id: string, content: string, confidence?: number): MemoryRow | undefined {
  db.prepare("UPDATE memories SET content = ?, confidence = COALESCE(?, confidence), updated_at = ? WHERE id = ?").run(
    content,
    confidence ?? null,
    nowIso(),
    id
  );
  return getMemory(db, id);
}

export function approveMemory(db: DB, id: string): MemoryRow | undefined {
  db.prepare("UPDATE memories SET approved = 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
  return getMemory(db, id);
}

export function expireMemory(db: DB, id: string): MemoryRow | undefined {
  db.prepare("UPDATE memories SET status = 'expired', updated_at = ? WHERE id = ?").run(nowIso(), id);
  return getMemory(db, id);
}

/** Hard delete (user right to deletion). Returns the deleted row or undefined. */
export function deleteMemory(db: DB, id: string): MemoryRow | undefined {
  const row = getMemory(db, id);
  if (!row) return undefined;
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  return row;
}

export function expireStaleMemories(db: DB): number {
  const res = db
    .prepare("UPDATE memories SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?")
    .run(nowIso(), nowIso());
  return res.changes;
}

export function exportMemories(db: DB, organizationId: string): unknown {
  const rows = db
    .prepare("SELECT * FROM memories WHERE organization_id = ? ORDER BY created_at")
    .all(organizationId) as MemoryRow[];
  return {
    exported_at: nowIso(),
    schema_version: "1.0",
    count: rows.length,
    memories: rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      kind: r.kind,
      content: r.content,
      source_refs: JSON.parse(r.source_refs_json) as string[],
      confidence: r.confidence,
      created_by: r.created_by,
      approved: !!r.approved,
      sensitivity: r.sensitivity,
      status: r.status,
      expires_at: r.expires_at,
      created_at: r.created_at,
      project_id: r.project_id,
      run_id: r.run_id,
    })),
  };
}

// ---------- browser captures (Phase 6 verification) ----------

export interface BrowserCaptureRow {
  id: string;
  run_id: string | null;
  url: string;
  title: string | null;
  status: "capturing" | "captured" | "failed";
  browser_path: string | null;
  console_messages_json: string;
  http_failures_json: string;
  viewport_json: string;
  created_at: string;
}

export function insertBrowserCapture(db: DB, c: Omit<BrowserCaptureRow, "created_at">): BrowserCaptureRow {
  const row = { ...c, created_at: nowIso() };
  db.prepare(
    `INSERT INTO browser_captures (id, run_id, url, title, status, browser_path, console_messages_json, http_failures_json, viewport_json, created_at)
     VALUES (@id, @run_id, @url, @title, @status, @browser_path, @console_messages_json, @http_failures_json, @viewport_json, @created_at)`
  ).run(row);
  return row;
}

export function getBrowserCapture(db: DB, id: string): BrowserCaptureRow | undefined {
  return db.prepare("SELECT * FROM browser_captures WHERE id = ?").get(id) as BrowserCaptureRow | undefined;
}

export function listBrowserCaptures(db: DB, runId: string | null): BrowserCaptureRow[] {
  const rows = runId
    ? (db.prepare("SELECT * FROM browser_captures WHERE run_id = ? ORDER BY created_at").all(runId) as BrowserCaptureRow[])
    : (db.prepare("SELECT * FROM browser_captures WHERE run_id IS NULL ORDER BY created_at DESC LIMIT 50").all() as BrowserCaptureRow[]);
  return rows;
}

// ---------- auth sessions (audit fix #1) ----------

export interface AuthSessionRow {
  id: string;
  token_hash: string;
  actor_id: string;
  org_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export function insertAuthSession(db: DB, s: { id: string; token_hash: string; actor_id: string; org_id: string; expires_at: string }): AuthSessionRow {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO auth_sessions (id, token_hash, actor_id, org_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(s.id, s.token_hash, s.actor_id, s.org_id, now, s.expires_at);
  return getAuthSession(db, s.id)!;
}

export function getAuthSession(db: DB, id: string): AuthSessionRow | undefined {
  return db.prepare("SELECT * FROM auth_sessions WHERE id = ?").get(id) as AuthSessionRow | undefined;
}

export function getAuthSessionByTokenHash(db: DB, tokenHash: string): AuthSessionRow | undefined {
  return db.prepare("SELECT * FROM auth_sessions WHERE token_hash = ?").get(tokenHash) as AuthSessionRow | undefined;
}

export function revokeAuthSession(db: DB, tokenHash: string): boolean {
  const res = db
    .prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .run(new Date().toISOString(), tokenHash);
  return res.changes > 0;
}

export function purgeExpiredAuthSessions(db: DB): number {
  const res = db
    .prepare("DELETE FROM auth_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL")
    .run(new Date().toISOString());
  return res.changes;
}

export function updateBrowserCapture(db: DB, id: string, patch: Partial<Pick<BrowserCaptureRow, "status" | "title" | "console_messages_json" | "http_failures_json" | "viewport_json">>): BrowserCaptureRow | undefined {
  const existing = getBrowserCapture(db, id);
  if (!existing) return undefined;
  const next = { ...existing, ...patch };
  db.prepare(
    "UPDATE browser_captures SET status=@status, title=@title, console_messages_json=@console_messages_json, http_failures_json=@http_failures_json, viewport_json=@viewport_json WHERE id=@id"
  ).run({
    status: next.status,
    title: next.title,
    console_messages_json: next.console_messages_json,
    http_failures_json: next.http_failures_json,
    viewport_json: next.viewport_json,
    id,
  });
  return getBrowserCapture(db, id);
}
