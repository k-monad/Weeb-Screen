import { buildServer } from "../../src/server.js";
import { initializeDatabase, openDatabase, type WeebScreenDatabase } from "../../src/db/database.js";
import { getNextEpisode, setEpisodeWatched, upsertShowImport } from "../../src/db/repositories.js";
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

  it("emits CSS-only dark mode tokens and theme-color metadata", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db);
    try {
      const response = await app.inject({ method: "GET", url: "/" });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<meta name="theme-color" content="#f7f7f4" media="(prefers-color-scheme: light)">');
      expect(response.body).toContain('<meta name="theme-color" content="#121514" media="(prefers-color-scheme: dark)">');
      expect(response.body).toContain("@media (prefers-color-scheme: dark)");
      expect(response.body).toContain(':root:not([data-theme="light"])');
      expect(response.body).toContain(':root[data-theme="dark"]');
      expect(response.body).toContain("color-scheme: dark");
      expect(response.body).toContain("--bg:#121514");
      expect(response.body).toContain("--primary-text:#08160f");
      expect(response.body).toContain("--switch-track-off:#3a403c");
      expect(response.body).toContain("background: var(--switch-track-off)");
      expect(response.body).toMatch(/\.ep\.is-next \.up-next-tag \{[\s\S]*?color: var\(--primary-text\);/);
    } finally {
      await app.close();
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
      expect(flat.body).toContain('aria-label="Canon: 0 of 2 watched"');
      expect(flat.body).toContain('aria-label="All: 0 of 5 watched"');
      expect(flat.body).toContain('<p class="controls__label">View</p>');
      expect(flat.body).toMatch(/<label class="chip">[\s\S]*?Unwatched only[\s\S]*?<\/label>/);
      expect(flat.body).not.toMatch(/<label class="chip"[^>]*aria-pressed=/);
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

  it("renders episode rows for the requested show when multiple shows exist", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db);
    try {
      seedDemoShow(db);
      seedSecondShow(db);

      const second = await app.inject({ method: "GET", url: "/shows/second-anime" });
      expect(second.statusCode).toBe(200);
      const firstRow = extractEpisodeRow(second.body, 1);
      expect(firstRow).toContain("Second Premiere");
      expect(firstRow).not.toContain("Start");
      expect(second.body).not.toContain("Filler Beach");
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

  it("uses live controls for watched updates, filters, and hide filler", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db);
    try {
      seedDemoShow(db);

      const page = await app.inject({ method: "GET", url: "/shows/demo-anime" });
      expect(page.body).toContain("data-watch-form");
      expect(page.body).toContain("data-filter-form");
      expect(page.body).toContain("Hide filler");

      const watch = await app.inject({
        method: "POST",
        url: "/shows/demo-anime/episodes/1/watched",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        payload: "watched=true",
      });
      expect(watch.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(watch.body)).toEqual({ ok: true, watched: true });

      const hide = await app.inject({
        method: "POST",
        url: "/shows/demo-anime/preferences",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        payload: "skip_filler=true",
      });
      expect(hide.statusCode).toBe(200);
      expect(JSON.parse(hide.body)).toEqual({ ok: true });

      const hidden = await app.inject({ method: "GET", url: "/shows/demo-anime" });
      expect(hidden.body).toMatch(
        /<button[^>]*class="switch"[^>]*aria-pressed="true"[^>]*>[\s\S]*?Hide filler[\s\S]*?<\/button>/,
      );
      expect(hidden.body).not.toContain("Filler Beach");
      expect(extractRealOrder(hidden.body)).toEqual([1, 3, 5]);
    } finally {
      await app.close();
      cleanup();
    }
  });

  it("surfaces live watch actions for play-next, up-to, season, and full-show bulk", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db);
    try {
      seedDemoShow(db);

      const initial = await app.inject({ method: "GET", url: "/shows/demo-anime" });
      expect(extractNextCard(initial.body)).toContain('action="/shows/demo-anime/episodes/1/watched"');
      expect(initial.body).toContain('action="/shows/demo-anime/watched/up-to/3"');
      expect(initial.body).toContain('action="/shows/demo-anime/watched/up-to/5"');
      expect(initial.body).toContain('action="/shows/demo-anime/watched/up-to/1"');
      expect(initial.body).toContain('<button type="submit" class="btn btn--secondary">Mark all watched</button>');
      expect(initial.body).toContain('<button type="submit" class="btn btn--secondary">Unwatch all</button>');
      expect(initial.body).toContain('data-undo-action="/shows/demo-anime/watched/up-to/1"');
      expect(initial.body).toContain('data-undo-action="/shows/demo-anime/watched/up-to/5"');
      expect(extractEpisodeRow(initial.body, 1)).toContain('class="btn btn--secondary btn--sm">Mark watched</button>');

      await app.inject({
        method: "POST",
        url: "/shows/demo-anime/episodes/1/watched",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        payload: "watched=true",
      });
      const afterPlayNext = await app.inject({ method: "GET", url: "/shows/demo-anime" });
      expect(extractNextCard(afterPlayNext.body)).toContain('action="/shows/demo-anime/episodes/2/watched"');
      expect(extractNextCard(afterPlayNext.body)).toContain('href="#ep-2"');

      await app.inject({
        method: "POST",
        url: "/shows/demo-anime/watched/up-to/3",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        payload: "watched=true",
      });
      expect(getNextEpisode(db, "demo-anime", false)?.next?.realEpisodeNumber).toBe(4);

      await app.inject({
        method: "POST",
        url: "/shows/demo-anime/preferences",
        payload: "season_details=true",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      const seasonView = await app.inject({ method: "GET", url: "/shows/demo-anime" });
      expect(seasonView.body).toContain('action="/shows/demo-anime/seasons/2/watched"');
      expect(seasonView.body).toContain('class="btn btn--secondary btn--sm">Mark season watched</button>');
      expect(seasonView.body).toContain('data-undo-action="/shows/demo-anime/seasons/2/watched"');

      await app.inject({
        method: "POST",
        url: "/shows/demo-anime/seasons/2/watched",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        payload: "watched=true",
      });
      expect(getNextEpisode(db, "demo-anime", false)?.next).toBeNull();

      await app.inject({
        method: "POST",
        url: "/shows/demo-anime/watched/up-to/1",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        payload: "watched=false",
      });
      expect(getNextEpisode(db, "demo-anime", false)?.next?.realEpisodeNumber).toBe(1);

      await app.inject({
        method: "POST",
        url: "/shows/demo-anime/watched/up-to/5",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        payload: "watched=true",
      });
      expect(getNextEpisode(db, "demo-anime", false)?.next).toBeNull();
    } finally {
      await app.close();
      cleanup();
    }
  });

  it("adds conditional bulk confirms and undo metadata with real counts", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db);
    try {
      seedLongDemoShow(db);

      const flat = await app.inject({ method: "GET", url: "/shows/long-demo" });
      expect(flat.body).toContain('data-toast hidden aria-hidden="true"');

      const markAllForm = extractFormsByAction(flat.body, "/shows/long-demo/watched/up-to/6")[0] ?? "";
      expect(markAllForm).toContain('data-confirm="Mark all 6 episodes watched?"');
      expect(markAllForm).toContain('data-undo-action="/shows/long-demo/watched/up-to/1"');
      expect(markAllForm).toContain('data-undo-watched="false"');

      const unwatchAllForm = extractFormsByAction(flat.body, "/shows/long-demo/watched/up-to/1")[0] ?? "";
      expect(unwatchAllForm).toContain('data-undo-action="/shows/long-demo/watched/up-to/6"');
      expect(unwatchAllForm).toContain('data-undo-watched="true"');

      const upToFiveForms = extractFormsByAction(flat.body, "/shows/long-demo/watched/up-to/5");
      expect(upToFiveForms.some((form) => form.includes("data-confirm="))).toBe(false);

      const upToSixForms = extractFormsByAction(flat.body, "/shows/long-demo/watched/up-to/6");
      expect(
        upToSixForms.some((form) => form.includes('data-confirm="Mark all 6 episodes up to here watched?"')),
      ).toBe(true);

      await app.inject({
        method: "POST",
        url: "/shows/long-demo/preferences",
        payload: "season_details=true",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      const grouped = await app.inject({ method: "GET", url: "/shows/long-demo" });
      const seasonForm = extractFormsByAction(grouped.body, "/shows/long-demo/seasons/1/watched")[0] ?? "";
      expect(seasonForm).toContain('data-confirm="Mark all 6 episodes in Season 1 watched?"');
      expect(seasonForm).toContain('data-undo-action="/shows/long-demo/seasons/1/watched"');
      expect(seasonForm).toContain('data-undo-watched="false"');
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

function extractNextCard(html: string): string {
  return html.match(/<section class="next-card[\s\S]*?<\/section>/)?.[0] ?? "";
}

function extractEpisodeRow(html: string, realEpisodeNumber: number): string {
  const escapedReal = String(realEpisodeNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<article class="ep[^"]*" id="ep-${escapedReal}"[\\s\\S]*?<\\/article>`))?.[0] ?? "";
}

function extractFormsByAction(html: string, action: string): string[] {
  const escapedAction = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...html.matchAll(new RegExp(`<form[^>]*\\saction="${escapedAction}"[^>]*>`, "g"))].map((match) => match[0]);
}

function seedLongDemoShow(db: WeebScreenDatabase): void {
  upsertShowImport(db, {
    format: "csv",
    show: {
      title: "Long Demo",
      slug: "long-demo",
      serviceName: "ExampleTV",
      notes: null,
      seasonBoundarySourceUrl: null,
    },
    counts: {
      total: 6,
      seasons: 1,
      fillerBuckets: {
        No: 3,
        Mixed: 2,
        Yes: 1,
      },
      canonFillerTypes: {
        "Manga Canon": 3,
        "Mixed Canon/Filler": 2,
        Filler: 1,
      },
    },
    issues: [],
    episodes: [
      {
        realEpisodeNumber: 1,
        serviceEpisodeCode: "S1E01",
        episodeTitle: "Long Start",
        fillerBucket: "No",
        canonFillerType: "Manga Canon",
        originalAirdate: "2026-01-01",
        serviceSeasonNumber: 1,
        serviceEpisodeNumber: 1,
        episodeDataSourceUrl: "https://example.com/long-source",
        seasonBoundarySourceUrl: "https://example.com/long-seasons",
      },
      {
        realEpisodeNumber: 2,
        serviceEpisodeCode: "S1E02",
        episodeTitle: "Long Mixed One",
        fillerBucket: "Mixed",
        canonFillerType: "Mixed Canon/Filler",
        originalAirdate: "2026-01-08",
        serviceSeasonNumber: 1,
        serviceEpisodeNumber: 2,
        episodeDataSourceUrl: "https://example.com/long-source",
        seasonBoundarySourceUrl: "https://example.com/long-seasons",
      },
      {
        realEpisodeNumber: 3,
        serviceEpisodeCode: "S1E03",
        episodeTitle: "Long Canon Two",
        fillerBucket: "No",
        canonFillerType: "Manga Canon",
        originalAirdate: "2026-01-15",
        serviceSeasonNumber: 1,
        serviceEpisodeNumber: 3,
        episodeDataSourceUrl: "https://example.com/long-source",
        seasonBoundarySourceUrl: "https://example.com/long-seasons",
      },
      {
        realEpisodeNumber: 4,
        serviceEpisodeCode: "S1E04",
        episodeTitle: "Long Filler",
        fillerBucket: "Yes",
        canonFillerType: "Filler",
        originalAirdate: "2026-01-22",
        serviceSeasonNumber: 1,
        serviceEpisodeNumber: 4,
        episodeDataSourceUrl: "https://example.com/long-source",
        seasonBoundarySourceUrl: "https://example.com/long-seasons",
      },
      {
        realEpisodeNumber: 5,
        serviceEpisodeCode: "S1E05",
        episodeTitle: "Long Mixed Two",
        fillerBucket: "Mixed",
        canonFillerType: "Mixed Canon/Filler",
        originalAirdate: "2026-01-29",
        serviceSeasonNumber: 1,
        serviceEpisodeNumber: 5,
        episodeDataSourceUrl: "https://example.com/long-source",
        seasonBoundarySourceUrl: "https://example.com/long-seasons",
      },
      {
        realEpisodeNumber: 6,
        serviceEpisodeCode: "S1E06",
        episodeTitle: "Long Finale",
        fillerBucket: "No",
        canonFillerType: "Manga Canon",
        originalAirdate: "2026-02-05",
        serviceSeasonNumber: 1,
        serviceEpisodeNumber: 6,
        episodeDataSourceUrl: "https://example.com/long-source",
        seasonBoundarySourceUrl: "https://example.com/long-seasons",
      },
    ],
  });
}

function seedSecondShow(db: WeebScreenDatabase): void {
  upsertShowImport(db, {
    format: "csv",
    show: {
      title: "Second Anime",
      slug: "second-anime",
      serviceName: "ExampleTV",
      notes: null,
      seasonBoundarySourceUrl: null,
    },
    counts: {
      total: 1,
      seasons: 1,
      fillerBuckets: {
        No: 1,
        Mixed: 0,
        Yes: 0,
      },
      canonFillerTypes: {
        "Manga Canon": 1,
      },
    },
    issues: [],
    episodes: [
      {
        realEpisodeNumber: 1,
        serviceEpisodeCode: "S1E01",
        episodeTitle: "Second Premiere",
        fillerBucket: "No",
        canonFillerType: "Manga Canon",
        originalAirdate: "2026-03-01",
        serviceSeasonNumber: 1,
        serviceEpisodeNumber: 1,
        episodeDataSourceUrl: "https://example.com/second-source",
        seasonBoundarySourceUrl: "https://example.com/second-seasons",
      },
    ],
  });
}
