import { buildServer } from "../../src/server.js";
import { initializeDatabase, openDatabase } from "../../src/db/database.js";
import { getNextEpisode, setEpisodeWatched } from "../../src/db/repositories.js";
import { createTempDatabase, seedDemoShow } from "../helpers/db.js";

describe("viewer UI and progress semantics", () => {
  it("computes skip-filler next by real episode order and keeps Mixed watchable", () => {
    const { db, cleanup } = createTempDatabase();
    try {
      seedDemoShow(db);
      expect(getNextEpisode(db, "demo-anime", false)?.next?.realEpisodeNumber).toBe(1);
      expect(getNextEpisode(db, "demo-anime", true)?.next?.realEpisodeNumber).toBe(1);

      setEpisodeWatched(db, "demo-anime", 1, true);
      expect(getNextEpisode(db, "demo-anime", false)?.next?.realEpisodeNumber).toBe(2);
      expect(getNextEpisode(db, "demo-anime", true)?.next).toMatchObject({
        realEpisodeNumber: 3,
        fillerBucket: "Mixed",
      });

      setEpisodeWatched(db, "demo-anime", 3, true);
      setEpisodeWatched(db, "demo-anime", 5, true);
      expect(getNextEpisode(db, "demo-anime", true)).toMatchObject({
        next: null,
        reason: "only-filler-remaining",
        fillerRemaining: 2,
      });
    } finally {
      cleanup();
    }
  });

  it("defaults to flat filler-first display and persists opt-in season details without reordering", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db);
    try {
      seedDemoShow(db);

      const flat = await app.inject({ method: "GET", url: "/shows/demo-anime" });
      expect(flat.statusCode).toBe(200);
      expect(flat.body).toContain('data-view-mode="flat"');
      expect(flat.body).toContain("Canon");
      expect(flat.body).toContain("Filler Beach");
      expect(flat.body).not.toContain("S1E01");
      expect(flat.body).not.toContain("https://example.com/source");

      await app.inject({
        method: "POST",
        url: "/shows/demo-anime/preferences",
        payload: "season_details=true",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      const grouped = await app.inject({ method: "GET", url: "/shows/demo-anime" });
      expect(grouped.body).toContain('data-view-mode="season"');
      expect(grouped.body).toContain("Season 1");
      expect(grouped.body).toContain("S1E01");
      expect(extractRealOrder(grouped.body)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await app.close();
      cleanup();
    }
  });

  it("keeps filters independent of display mode", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db);
    try {
      seedDemoShow(db);
      await app.inject({
        method: "POST",
        url: "/shows/demo-anime/preferences",
        payload: "season_details=true",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      const fillerOnly = await app.inject({ method: "GET", url: "/shows/demo-anime?bucket=Yes" });
      expect(fillerOnly.body).toContain("Filler Beach");
      expect(fillerOnly.body).toContain("Festival");
      expect(extractRealOrder(fillerOnly.body)).toEqual([2, 4]);
    } finally {
      await app.close();
      cleanup();
    }
  });

  it("persists progress across database reopen", () => {
    const temp = createTempDatabase();
    try {
      seedDemoShow(temp.db);
      setEpisodeWatched(temp.db, "demo-anime", 1, true);
      temp.db.close();

      const reopened = openDatabase(temp.path);
      initializeDatabase(reopened);
      try {
        expect(getNextEpisode(reopened, "demo-anime", false)?.next?.realEpisodeNumber).toBe(2);
      } finally {
        reopened.close();
      }
    } finally {
      temp.cleanup();
    }
  });
});

function extractRealOrder(html: string): number[] {
  return [...html.matchAll(/data-real="(\d+)"/g)].map((match) => Number.parseInt(match[1] ?? "", 10));
}
