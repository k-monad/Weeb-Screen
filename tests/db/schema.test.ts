import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertDatabaseRuntimePragmas,
  initializeDatabase,
  openDatabase,
  type WeebScreenDatabase,
} from "../../src/db/database.js";

function createTempDatabase(): { db: WeebScreenDatabase; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "weeb-screen-db-"));
  const db = openDatabase(join(dir, "test.sqlite"));

  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("ticket A SQLite schema", () => {
  let db: WeebScreenDatabase;
  let cleanup: () => void;

  beforeEach(() => {
    const temp = createTempDatabase();
    db = temp.db;
    cleanup = temp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it("enables foreign keys and WAL on the SQLite connection", () => {
    assertDatabaseRuntimePragmas(db);
  });

  it("creates the required tables and idempotent seeds", () => {
    initializeDatabase(db);
    initializeDatabase(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "app_settings",
      "episodes",
      "import_jobs",
      "profiles",
      "progress",
      "shows",
    ]);

    expect(db.prepare("SELECT id, name, is_household FROM profiles").all()).toEqual([
      { id: 1, name: "Household", is_household: 1 },
    ]);

    expect(db.prepare("SELECT key, value FROM app_settings ORDER BY key").all()).toEqual([
      { key: "progress_view_default", value: "canon" },
      { key: "season_details_default", value: "false" },
      { key: "skip_filler_default", value: "false" },
    ]);
  });

  it("enforces the three-state filler bucket contract", () => {
    initializeDatabase(db);

    db.prepare(
      `INSERT INTO shows(title, slug, service_name, created_at, updated_at)
       VALUES ('Test Show', 'test-show', 'Test Service', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:00.000Z')`,
    ).run();

    const insertEpisode = db.prepare(
      `INSERT INTO episodes(
        show_id,
        real_episode_number,
        service_season_number,
        service_episode_number,
        service_episode_code,
        episode_title,
        filler_bucket,
        canon_filler_type,
        created_at,
        updated_at
      )
      VALUES (1, 1, 1, 1, 'S1E01', 'Pilot', ?, 'Manga Canon', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:00.000Z')`,
    );

    expect(() => insertEpisode.run("No")).not.toThrow();
    expect(() => insertEpisode.run("Maybe")).toThrow(/CHECK constraint failed/);
  });

  it("enforces progress foreign keys against seeded profiles and real episodes", () => {
    initializeDatabase(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO progress(profile_id, episode_id, watched, updated_at)
           VALUES (1, 999, 1, '2026-05-31T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

