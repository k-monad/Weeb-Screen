import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type WeebScreenDatabase = Database.Database;

const repoRoot = process.cwd();
const schemaPath = join(repoRoot, "app", "db", "schema.sql");

export const DEFAULT_DB_PATH = join(repoRoot, "data", "weebscreen.sqlite");
export const SCHEMA_SQL = readFileSync(schemaPath, "utf8");

export function openDatabase(filename = process.env.WEEBSCREEN_DB_PATH ?? DEFAULT_DB_PATH): WeebScreenDatabase {
  mkdirSync(dirname(filename), { recursive: true });

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  return db;
}

export function initializeDatabase(db: WeebScreenDatabase): void {
  db.exec(SCHEMA_SQL);
}

export function getPragmaValue(db: WeebScreenDatabase, pragma: string): unknown {
  const rows = db.pragma(pragma, { simple: true });
  return rows;
}

export function assertDatabaseRuntimePragmas(db: WeebScreenDatabase): void {
  const foreignKeys = getPragmaValue(db, "foreign_keys");
  const journalMode = String(getPragmaValue(db, "journal_mode")).toLowerCase();

  if (foreignKeys !== 1) {
    throw new Error(`SQLite foreign_keys must be ON; received ${String(foreignKeys)}`);
  }

  if (journalMode !== "wal") {
    throw new Error(`SQLite journal_mode must be WAL; received ${journalMode}`);
  }
}
