export * from "./config.js";
export * from "./migrate.js";
export * from "./seed.js";
export * from "./repo.js";

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrate } from "./migrate.js";

export type Database = Database.Database;

export function openDb(file: string): Database.Database {
  if (file !== ":memory:") {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Audit fix #3: keep the WAL bounded (OneDrive/backup-friendly) and fail
  // fast-ish under lock contention instead of throwing SQLITE_BUSY forever.
  db.pragma("wal_autocheckpoint = 256");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}
