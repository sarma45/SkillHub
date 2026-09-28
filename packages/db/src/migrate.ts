/**
 * Schema migrations (TRD §8.5). Applied in order, idempotently, tracked in
 * migration_metadata. Application startup never mutates schema implicitly —
 * only this module does, via `npm run db:migrate`.
 */
import Database from "better-sqlite3";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "core-tables",
    sql: `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'engineer' CHECK (role IN ('owner','engineer','reviewer','security')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('local','fixture')),
  source_ref TEXT NOT NULL,
  permission_mode TEXT NOT NULL DEFAULT 'read_only',
  status TEXT NOT NULL DEFAULT 'indexing' CHECK (status IN ('indexing','ready','failed','needs_input')),
  repository_map_json TEXT,
  map_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_org_name ON projects(organization_id, name);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  request_text TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('low','medium','high','critical')),
  state TEXT NOT NULL DEFAULT 'DRAFT',
  version INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_project_state ON tasks(project_id, state);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  version INTEGER NOT NULL,
  plan_hash TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','superseded','stale')),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (task_id, version)
);
CREATE INDEX IF NOT EXISTS idx_plans_task ON plans(task_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  plan_hash TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','paused','verifying','needs_repair','ready_for_review','awaiting_integration_approval','integrated','cancelled','failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  model_route TEXT NOT NULL DEFAULT 'mock',
  budget_json TEXT NOT NULL,
  budget_used_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  ended_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','agent','system','evaluator','security')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  redacted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_id TEXT REFERENCES runs(id),
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sensitivity TEXT NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public','internal','confidential','restricted')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_hash ON artifacts(sha256);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  check_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed','failed','warning','skipped','pending')),
  severity TEXT NOT NULL CHECK (severity IN ('informational','low','medium','high','critical')),
  label TEXT NOT NULL CHECK (label IN ('observed','verified','inferred','proposed','unknown')),
  command_or_method TEXT NOT NULL,
  artifact_id TEXT,
  result_json TEXT NOT NULL DEFAULT '{}',
  human_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_severity ON evidence(severity);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  source_repo TEXT,
  source_url TEXT,
  source_commit TEXT,
  license TEXT,
  category TEXT NOT NULL,
  phase INTEGER,
  manifest_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','reviewed','approved','deprecated','catalog_only')),
  owner TEXT NOT NULL DEFAULT 'platform',
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_skills_cat ON skills(category);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_id TEXT REFERENCES runs(id),
  decision_kind TEXT NOT NULL,
  state_hash TEXT,
  provider TEXT NOT NULL DEFAULT 'deterministic',
  question_json TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  confidence REAL,
  policy_version TEXT NOT NULL,
  action TEXT NOT NULL,
  human_override INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_grants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  capability_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('dormant','internal','beta','enabled')),
  granted_by TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, capability_id)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, actor_id, idempotency_key, route)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('project','task','plan','run','skill','finding')),
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  payload_json TEXT NOT NULL DEFAULT '{}',
  sequence INTEGER NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox_events(published, sequence);

CREATE TABLE IF NOT EXISTS job_leases (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('index_repository','generate_plan','execute_run','evaluate_run','security_scan','memory_maintenance')),
  aggregate_id TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_owner TEXT,
  fencing_token INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','paused','succeeded','failed','cancelled','dead_letter')),
  failure_code TEXT,
  retry_class TEXT NOT NULL DEFAULT 'none' CHECK (retry_class IN ('none','same_attempt','new_attempt','provider_switch','human_action','replan')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_claimable ON job_leases(status, job_type);

CREATE TABLE IF NOT EXISTS pr_drafts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft_pending_approval' CHECK (status IN ('draft_pending_approval','approved_not_submitted','submitted')),
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','agent','system','evaluator','security')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  request_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT,
  entry_hash TEXT,
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: "memory-and-browser",
    sql: `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT REFERENCES projects(id),
  run_id TEXT REFERENCES runs(id),
  scope TEXT NOT NULL CHECK (scope IN ('user','team','project','task')),
  kind TEXT NOT NULL CHECK (kind IN ('fact','preference','decision','lesson','artifact')),
  content TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  created_by TEXT NOT NULL CHECK (created_by IN ('human','agent','import')),
  approved INTEGER NOT NULL DEFAULT 0,
  sensitivity TEXT NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public','internal','confidential','restricted')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','deleted')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(organization_id, project_id, scope, status);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);

CREATE TABLE IF NOT EXISTS browser_captures (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  url TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL CHECK (status IN ('capturing','captured','failed')),
  browser_path TEXT,
  console_messages_json TEXT NOT NULL DEFAULT '[]',
  http_failures_json TEXT NOT NULL DEFAULT '[]',
  viewport_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
`
  },
  {
    version: 3,
    name: "auth-sessions",
    sql: `
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
`
  },
];

export function migrate(db: Database.Database): { applied: number[]; current: number } {
  db.exec(`CREATE TABLE IF NOT EXISTS migration_metadata (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);
  const currentRow = db
    .prepare("SELECT MAX(version) AS v FROM migration_metadata")
    .get() as { v: number | null };
  const current = currentRow.v ?? 0;

  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO migration_metadata (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString()
      );
    });
    tx();
    applied.push(m.version);
  }
  return { applied, current: Math.max(current, ...MIGRATIONS.map((m) => m.version), current) };
}
