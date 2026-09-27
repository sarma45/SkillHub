/**
 * Persistence layer: SQLite via better-sqlite3, Postgres-portable schema.
 * TRD §8: migrations-managed, tenant-scoped, versioned aggregates, outbox.
 */
export interface DbConfig {
  /** file path for sqlite; use ':memory:' for tests */
  file: string;
}

export const DEFAULT_DB_FILE = "data/cockpit.db";

export type OrgId = string;
export type ProjectId = string;
export type TaskId = string;
export type PlanId = string;
export type RunId = string;
export type SkillId = string;
export type FindingId = string;
