import { assertDatabaseRuntimePragmas, initializeDatabase, openDatabase } from "../src/db/database.js";

const dbPath = process.argv[2] ?? process.env.WEEBSCREEN_DB_PATH;
const db = openDatabase(dbPath);

try {
  initializeDatabase(db);
  assertDatabaseRuntimePragmas(db);
  console.log(`Initialized Weeb-Screen SQLite database at ${db.name}`);
} finally {
  db.close();
}

