import { openDb } from "@cockpit/db";
import type { Database as DB } from "better-sqlite3";

let instance: DB | null = null;

export function getDb(): DB {
  if (!instance) {
    instance = openDb(process.env.COCKPIT_DB_FILE ?? "data/cockpit.db");
  }
  return instance;
}
