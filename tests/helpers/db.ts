import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeDatabase, openDatabase, type WeebScreenDatabase } from "../../src/db/database.js";
import { upsertShowImport } from "../../src/db/repositories.js";
import type { ImportPreview } from "../../src/importers/types.js";

export function createTempDatabase(): { db: WeebScreenDatabase; path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "weeb-screen-db-"));
  const path = join(dir, "test.sqlite");
  const db = openDatabase(path);
  initializeDatabase(db);

  return {
    db,
    path,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function seedDemoShow(db: WeebScreenDatabase): void {
  upsertShowImport(db, demoPreview());
}

function demoPreview(): ImportPreview {
  return {
    format: "csv",
    show: {
      title: "Demo Anime",
      slug: "demo-anime",
      serviceName: "ExampleTV",
      notes: null,
      seasonBoundarySourceUrl: null,
    },
    counts: {
      total: 5,
      seasons: 2,
      fillerBuckets: {
        No: 2,
        Mixed: 1,
        Yes: 2,
      },
      canonFillerTypes: {
        "Manga Canon": 2,
        "Mixed Canon/Filler": 1,
        Filler: 2,
      },
    },
    issues: [],
    episodes: [
      {
        realEpisodeNumber: 1,
        serviceEpisodeCode: "S1E01",
        episodeTitle: "Start",
        fillerBucket: "No",
        canonFillerType: "Manga Canon",
        originalAirdate: "2026-01-01",
        serviceSeasonNumber: 1,
        serviceEpisodeNumber: 1,
        episodeDataSourceUrl: "https://example.com/source",
        seasonBoundarySourceUrl: "https://example.com/seasons",
      },
      {
        realEpisodeNumber: 2,
        serviceEpisodeCode: "S1E02",
        episodeTitle: "Filler Beach",
        fillerBucket: "Yes",
        canonFillerType: "Filler",
        originalAirdate: "2026-01-08",
        serviceSeasonNumber: 1,
        serviceEpisodeNumber: 2,
        episodeDataSourceUrl: "https://example.com/source",
        seasonBoundarySourceUrl: "https://example.com/seasons",
      },
      {
        realEpisodeNumber: 3,
        serviceEpisodeCode: "S1E03",
        episodeTitle: "Bridge",
        fillerBucket: "Mixed",
        canonFillerType: "Mixed Canon/Filler",
        originalAirdate: "2026-01-15",
        serviceSeasonNumber: 1,
        serviceEpisodeNumber: 3,
        episodeDataSourceUrl: "https://example.com/source",
        seasonBoundarySourceUrl: "https://example.com/seasons",
      },
      {
        realEpisodeNumber: 4,
        serviceEpisodeCode: "S2E01",
        episodeTitle: "Festival",
        fillerBucket: "Yes",
        canonFillerType: "Filler",
        originalAirdate: "2026-01-22",
        serviceSeasonNumber: 2,
        serviceEpisodeNumber: 1,
        episodeDataSourceUrl: "https://example.com/source",
        seasonBoundarySourceUrl: "https://example.com/seasons-2",
      },
      {
        realEpisodeNumber: 5,
        serviceEpisodeCode: "S2E02",
        episodeTitle: "Return",
        fillerBucket: "No",
        canonFillerType: "Manga Canon",
        originalAirdate: "2026-01-29",
        serviceSeasonNumber: 2,
        serviceEpisodeNumber: 2,
        episodeDataSourceUrl: "https://example.com/source",
        seasonBoundarySourceUrl: "https://example.com/seasons-2",
      },
    ],
  };
}

