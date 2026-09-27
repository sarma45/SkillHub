import { openDb } from "./index.js";
import { DEFAULT_DB_FILE } from "./config.js";
import { seed } from "./seed.js";

const command = process.argv[2] ?? "migrate";
const file = process.env.COCKPIT_DB_FILE ?? DEFAULT_DB_FILE;

const db = openDb(file);
if (command === "migrate") {
  console.log(`[db] migrated ${file}`);
} else if (command === "seed") {
  seed(db);
  console.log(`[db] seeded ${file}`);
} else {
  console.error(`unknown command: ${command}`);
  process.exitCode = 1;
}
db.close();
