/**
 * Deterministic seed (TRD §14 local dev: "Seed data is deterministic").
 * Creates the local org, three users, capability grants mirroring
 * packages/policy capability status, and the skill catalog from the
 * versioned registry data in services/skill-registry.
 */
import type { Database as DB } from "better-sqlite3";
import { CAPABILITIES } from "@cockpit/policy";
import { SKILL_CATALOG } from "@cockpit/skill-registry";
import { upsertSkill, newEntityId } from "./repo.js";

export const SEED = {
  org: { id: "org_local", name: "Local Development" },
  users: [
    { id: "usr_owner", email: "owner@local.test", display_name: "Local Owner", role: "owner" },
    { id: "usr_engineer", email: "engineer@local.test", display_name: "Local Engineer", role: "engineer" },
    { id: "usr_reviewer", email: "reviewer@local.test", display_name: "Local Reviewer", role: "reviewer" },
    { id: "usr_security", email: "security@local.test", display_name: "Local Security", role: "security" },
  ],
};

export function seed(db: DB): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(SEED.org.id, SEED.org.name, now, now);

  const insUser = db.prepare(
    "INSERT OR IGNORE INTO users (id, organization_id, email, display_name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const u of SEED.users) {
    insUser.run(u.id, SEED.org.id, u.email, u.display_name, u.role, now, now);
  }

  // capability grants mirror the static registry server-side
  const insGrant = db.prepare(
    "INSERT OR IGNORE INTO capability_grants (id, organization_id, capability_id, status, granted_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const cap of CAPABILITIES) {
    insGrant.run(
      newEntityId("cap"),
      SEED.org.id,
      cap.capability_id,
      cap.status,
      "system",
      null,
      now
    );
  }

  // skill catalog (50 starred repos + 3 first-party core skills)
  for (const s of SKILL_CATALOG) {
    upsertSkill(db, {
      organization_id: SEED.org.id,
      skill_id: s.manifest.id,
      version: s.manifest.version,
      name: s.manifest.name,
      purpose: s.manifest.purpose,
      source_repo: s.manifest.source_repo,
      source_url: s.manifest.source_url,
      source_commit: s.manifest.source_commit,
      license: s.manifest.license,
      category: s.manifest.category,
      phase: s.manifest.phase,
      manifest_json: JSON.stringify(s.manifest),
      status: s.manifest.status,
      owner: s.manifest.status === "approved" ? "platform-team" : "catalog",
    });
  }
}

/** Reset all seeded + domain data (dev convenience, never called in prod path). */
export function resetAll(db: DB): void {
  const tables = [
    "audit_events",
    "pr_drafts",
    "decisions",
    "evidence",
    "artifacts",
    "run_events",
    "runs",
    "plans",
    "tasks",
    "projects",
    "job_leases",
    "outbox_events",
    "idempotency_records",
    "capability_grants",
    "skills",
    "users",
    "organizations",
    "migration_metadata",
    "memories",
    "browser_captures",
  ];
  const tx = db.transaction(() => {
    for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  });
  tx();
  seed(db);
}
