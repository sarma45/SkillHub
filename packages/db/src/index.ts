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
  migrate(db);
  return db;
}
