import type { EpisodeImportRow, ImportPreview } from "../importers/types.js";
import type {
  EpisodeWithProgress,
  FillerBucket,
  NextEpisodeResult,
  ProgressSummary,
  Show,
  ShowDetail,
  ShowSummary,
} from "../domain/types.js";
import type { WeebScreenDatabase } from "./database.js";

const PROFILE_ID = 1;

export type ShowDetailOptions = {
  bucket?: FillerBucket | "All";
  unwatched?: boolean;
};

export type ImportJobStatus = "preview" | "committed" | "failed";

export type ImportJob = {
  id: number;
  showId: number | null;
  filename: string | null;
  format: "xlsx" | "csv" | null;
  showSlug: string | null;
  status: ImportJobStatus;
  rowsTotal: number | null;
  rowsImported: number | null;
  rowsUpdated: number | null;
  rowsSkipped: number | null;
  countsJson: string | null;
  errorText: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type SettingsSnapshot = {
  defaults: {
    skipFiller: boolean;
    progressView: "canon" | "all";
    seasonDetails: boolean;
  };
  showOverrides: Array<{
    showSlug: string;
    skipFiller: boolean | null;
    seasonDetails: boolean | null;
  }>;
};

type EpisodeRow = {
  id: number;
  show_id: number;
  real_episode_number: number;
  service_season_number: number;
  service_episode_number: number;
  service_episode_code: string;
  episode_title: string;
  filler_bucket: FillerBucket;
  canon_filler_type: string;
  original_airdate: string | null;
  watched: 0 | 1 | null;
  watched_at: string | null;
};

type ShowRow = {
  id: number;
  title: string;
  slug: string;
  service_name: string | null;
  total_real_episodes: number | null;
  season_boundary_source_url: string | null;
  notes: string | null;
};

type SummaryRow = {
  canon_watched: number | null;
  canon_total: number | null;
  all_watched: number | null;
  all_total: number | null;
};

type ImportJobRow = {
  id: number;
  show_id: number | null;
  filename: string | null;
  format: "xlsx" | "csv" | null;
  show_slug: string | null;
  status: ImportJobStatus;
  rows_total: number | null;
  rows_imported: number | null;
  rows_updated: number | null;
  rows_skipped: number | null;
  counts_json: string | null;
  preview_json: string | null;
  error_text: string | null;
  created_at: string;
  finished_at: string | null;
};

export function listShows(db: WeebScreenDatabase): ShowSummary[] {
  const mode = getProgressViewDefault(db);
  const rows = db
    .prepare(
      `SELECT
        s.id,
        s.title,
        s.slug,
        s.service_name,
        s.total_real_episodes,
        s.season_boundary_source_url,
        s.notes,
        COALESCE(SUM(CASE WHEN e.filler_bucket = 'No' AND COALESCE(p.watched, 0) = 1 THEN 1 ELSE 0 END), 0) AS canon_watched,
        COALESCE(SUM(CASE WHEN e.filler_bucket = 'No' THEN 1 ELSE 0 END), 0) AS canon_total,
        COALESCE(SUM(CASE WHEN COALESCE(p.watched, 0) = 1 THEN 1 ELSE 0 END), 0) AS all_watched,
        COUNT(e.id) AS all_total
      FROM shows s
      LEFT JOIN episodes e ON e.show_id = s.id
      LEFT JOIN progress p ON p.episode_id = e.id AND p.profile_id = ?
      GROUP BY s.id
      ORDER BY s.title COLLATE NOCASE`,
    )
    .all(PROFILE_ID) as Array<ShowRow & SummaryRow>;

  return rows.map((row) => ({
    ...mapShow(row),
    ...mapSummary(row),
    progressMode: mode,
  }));
}

export function getShowDetail(db: WeebScreenDatabase, slug: string, options: ShowDetailOptions = {}): ShowDetail | null {
  const show = getShow(db, slug);
  if (!show) {
    return null;
  }

  const skipFiller = getShowBooleanSetting(db, "skip_filler", show.slug, "skip_filler_default");
  const seasonDetails = getShowBooleanSetting(db, "season_details", show.slug, "season_details_default");
  const where: string[] = ["e.show_id = ?"];
  const params: unknown[] = [show.id, PROFILE_ID];

  if (options.bucket && options.bucket !== "All") {
    where.push("e.filler_bucket = ?");
    params.push(options.bucket);
  }

  if (skipFiller) {
    where.push("e.filler_bucket != 'Yes'");
  }

  if (options.unwatched) {
    where.push("COALESCE(p.watched, 0) = 0");
  }

  const rows = db
    .prepare(
      `SELECT
        e.id,
        e.show_id,
        e.real_episode_number,
        e.service_season_number,
        e.service_episode_number,
        e.service_episode_code,
        e.episode_title,
        e.filler_bucket,
        e.canon_filler_type,
        e.original_airdate,
        p.watched,
        p.watched_at
      FROM episodes e
      LEFT JOIN progress p ON p.episode_id = e.id AND p.profile_id = ?
      WHERE ${where.join(" AND ")}
      ORDER BY e.real_episode_number ASC`,
    )
    .all(...params) as EpisodeRow[];

  return {
    show,
    summary: getProgressSummary(db, show.id),
    episodes: rows.map(mapEpisode),
    preferences: {
      skipFiller,
      seasonDetails,
    },
  };
}

export function getNextEpisode(db: WeebScreenDatabase, slug: string, skipFiller: boolean): NextEpisodeResult | null {
  const show = getShow(db, slug);
  if (!show) {
    return null;
  }

  const bucketClause = skipFiller ? "AND e.filler_bucket IN ('No', 'Mixed')" : "";
  const row = db
    .prepare(
      `SELECT
        e.id,
        e.show_id,
        e.real_episode_number,
        e.service_season_number,
        e.service_episode_number,
        e.service_episode_code,
        e.episode_title,
        e.filler_bucket,
        e.canon_filler_type,
        e.original_airdate,
        p.watched,
        p.watched_at
      FROM episodes e
      LEFT JOIN progress p ON p.episode_id = e.id AND p.profile_id = ?
      WHERE e.show_id = ?
        AND COALESCE(p.watched, 0) = 0
        ${bucketClause}
      ORDER BY e.real_episode_number ASC
      LIMIT 1`,
    )
    .get(PROFILE_ID, show.id) as EpisodeRow | undefined;

  if (row) {
    return {
      next: mapEpisode(row),
      reason: "next",
      fillerRemaining: 0,
    };
  }

  if (!skipFiller) {
    return {
      next: null,
      reason: "all-caught-up",
      fillerRemaining: 0,
    };
  }

  const fillerRemaining = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM episodes e
       LEFT JOIN progress p ON p.episode_id = e.id AND p.profile_id = ?
       WHERE e.show_id = ? AND e.filler_bucket = 'Yes' AND COALESCE(p.watched, 0) = 0`,
    )
    .get(PROFILE_ID, show.id) as { count: number };

  return {
    next: null,
    reason: fillerRemaining.count > 0 ? "only-filler-remaining" : "all-canon-watched",
    fillerRemaining: fillerRemaining.count,
  };
}

export function setEpisodeWatched(
  db: WeebScreenDatabase,
  slug: string,
  realEpisodeNumber: number,
  watched: boolean,
): EpisodeWithProgress | null {
  const show = getShow(db, slug);
  if (!show) {
    return null;
  }

  const episode = db
    .prepare("SELECT id FROM episodes WHERE show_id = ? AND real_episode_number = ?")
    .get(show.id, realEpisodeNumber) as { id: number } | undefined;

  if (!episode) {
    return null;
  }

  writeProgress(db, episode.id, watched);
  return getEpisodeById(db, episode.id);
}

export function setSeasonWatched(db: WeebScreenDatabase, slug: string, seasonNumber: number, watched: boolean): boolean {
  const show = getShow(db, slug);
  if (!show) {
    return false;
  }

  const episodeIds = db
    .prepare("SELECT id FROM episodes WHERE show_id = ? AND service_season_number = ?")
    .all(show.id, seasonNumber)
    .map((row) => (row as { id: number }).id);

  const transaction = db.transaction(() => {
    for (const episodeId of episodeIds) {
      writeProgress(db, episodeId, watched);
    }
  });
  transaction();
  return true;
}

export function setWatchedUpTo(db: WeebScreenDatabase, slug: string, realEpisodeNumber: number, watched: boolean): boolean {
  const show = getShow(db, slug);
  if (!show) {
    return false;
  }

  const comparator = watched ? "<=" : ">=";
  const episodeIds = db
    .prepare(`SELECT id FROM episodes WHERE show_id = ? AND real_episode_number ${comparator} ?`)
    .all(show.id, realEpisodeNumber)
    .map((row) => (row as { id: number }).id);

  const transaction = db.transaction(() => {
    for (const episodeId of episodeIds) {
      writeProgress(db, episodeId, watched);
    }
  });
  transaction();
  return true;
}

export function setShowPreference(db: WeebScreenDatabase, slug: string, key: "skip_filler" | "season_details", value: boolean): void {
  db.prepare(
    `INSERT INTO app_settings(key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(`${key}:${slug}`, String(value));
}

export function getShowBooleanSetting(
  db: WeebScreenDatabase,
  keyPrefix: "skip_filler" | "season_details",
  slug: string,
  defaultKey: string,
): boolean {
  const override = getSetting(db, `${keyPrefix}:${slug}`);
  if (override !== null) {
    return override === "true";
  }
  return getSetting(db, defaultKey) === "true";
}

export function getSetting(db: WeebScreenDatabase, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: WeebScreenDatabase, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings(key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getProgressViewDefault(db: WeebScreenDatabase): "canon" | "all" {
  return getSetting(db, "progress_view_default") === "all" ? "all" : "canon";
}

export function getSettingsSnapshot(db: WeebScreenDatabase): SettingsSnapshot {
  const overrideRows = db
    .prepare(
      `SELECT key, value
       FROM app_settings
       WHERE key LIKE 'skip_filler:%' OR key LIKE 'season_details:%'
       ORDER BY key`,
    )
    .all() as Array<{ key: string; value: string }>;

  const bySlug = new Map<string, { showSlug: string; skipFiller: boolean | null; seasonDetails: boolean | null }>();
  for (const row of overrideRows) {
    const splitIndex = row.key.indexOf(":");
    if (splitIndex < 0) {
      continue;
    }

    const keyPrefix = row.key.slice(0, splitIndex);
    const showSlug = row.key.slice(splitIndex + 1);
    if (showSlug.length === 0) {
      continue;
    }

    const current = bySlug.get(showSlug) ?? {
      showSlug,
      skipFiller: null,
      seasonDetails: null,
    };

    if (keyPrefix === "skip_filler") {
      current.skipFiller = row.value === "true";
    } else if (keyPrefix === "season_details") {
      current.seasonDetails = row.value === "true";
    }

    bySlug.set(showSlug, current);
  }

  return {
    defaults: {
      skipFiller: getSetting(db, "skip_filler_default") === "true",
      progressView: getProgressViewDefault(db),
      seasonDetails: getSetting(db, "season_details_default") === "true",
    },
    showOverrides: [...bySlug.values()].sort((left, right) => left.showSlug.localeCompare(right.showSlug)),
  };
}

export function countMissingEpisodesForImport(
  db: WeebScreenDatabase,
  showSlug: string,
  incomingRealEpisodeNumbers: number[],
): number | null {
  const show = getShow(db, showSlug);
  if (!show) {
    return null;
  }

  const incoming = new Set<number>(incomingRealEpisodeNumbers);
  const existingRows = db
    .prepare("SELECT real_episode_number FROM episodes WHERE show_id = ?")
    .all(show.id) as Array<{ real_episode_number: number }>;

  return existingRows.reduce(
    (count, row) => (incoming.has(row.real_episode_number) ? count : count + 1),
    0,
  );
}

export function upsertShowImport(
  db: WeebScreenDatabase,
  preview: ImportPreview,
): { showId: number; inserted: number; updated: number; skipped: number } {
  const now = nowIso();
  const existing = getShow(db, preview.show.slug);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const transaction = db.transaction(() => {
    const showId =
      existing?.id ??
      (db
        .prepare(
          `INSERT INTO shows(
            title,
            slug,
            service_name,
            total_real_episodes,
            season_boundary_source_url,
            notes,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          preview.show.title,
          preview.show.slug,
          preview.show.serviceName,
          preview.counts.total,
          preview.show.seasonBoundarySourceUrl,
          preview.show.notes,
          now,
          now,
        ).lastInsertRowid as number);

    if (existing) {
      db.prepare(
        `UPDATE shows
         SET title = ?,
             service_name = ?,
             total_real_episodes = ?,
             season_boundary_source_url = ?,
             notes = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(
        preview.show.title,
        preview.show.serviceName,
        preview.counts.total,
        preview.show.seasonBoundarySourceUrl,
        preview.show.notes,
        now,
        existing.id,
      );
    }

    if (existing) {
      const incomingRealEpisodeNumbers = new Set<number>(preview.episodes.map((episode) => episode.realEpisodeNumber));
      const missingRows = db
        .prepare("SELECT real_episode_number FROM episodes WHERE show_id = ?")
        .all(showId) as Array<{ real_episode_number: number }>;

      skipped = missingRows.reduce(
        (count, row) => (incomingRealEpisodeNumbers.has(row.real_episode_number) ? count : count + 1),
        0,
      );
    }

    const existingEpisode = db.prepare("SELECT id FROM episodes WHERE show_id = ? AND real_episode_number = ?");
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
        original_airdate,
        episode_data_source_url,
        season_boundary_source_url,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateEpisode = db.prepare(
      `UPDATE episodes
       SET service_season_number = ?,
           service_episode_number = ?,
           service_episode_code = ?,
           episode_title = ?,
           filler_bucket = ?,
           canon_filler_type = ?,
           original_airdate = ?,
           episode_data_source_url = ?,
           season_boundary_source_url = ?,
           updated_at = ?
       WHERE id = ?`,
    );

    for (const episode of preview.episodes) {
      const current = existingEpisode.get(showId, episode.realEpisodeNumber) as { id: number } | undefined;
      if (current) {
        bindUpdateEpisode(updateEpisode, episode, current.id, now);
        updated += 1;
      } else {
        bindInsertEpisode(insertEpisode, showId, episode, now);
        inserted += 1;
      }
    }

    return showId;
  });

  const showId = transaction() as number;
  return { showId, inserted, updated, skipped };
}

export function createPreviewImportJob(db: WeebScreenDatabase, preview: ImportPreview, filename: string): ImportJob {
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO import_jobs(
        filename,
        format,
        show_slug,
        status,
        rows_total,
        rows_imported,
        rows_updated,
        rows_skipped,
        counts_json,
        preview_json,
        error_text,
        created_at
      )
      VALUES (?, ?, ?, 'preview', ?, 0, 0, 0, ?, ?, ?, ?)`,
    )
    .run(
      filename,
      preview.format,
      preview.show.slug,
      preview.episodes.length,
      JSON.stringify(preview.counts),
      JSON.stringify(preview),
      formatIssueSummary(preview),
      now,
    );

  return getImportJob(db, result.lastInsertRowid as number) as ImportJob;
}

export function markImportJobCommitted(
  db: WeebScreenDatabase,
  jobId: number,
  showId: number,
  rowsImported: number,
  rowsUpdated: number,
  rowsSkipped: number,
): void {
  db.prepare(
    `UPDATE import_jobs
     SET show_id = ?,
         status = 'committed',
         rows_imported = ?,
         rows_updated = ?,
         rows_skipped = ?,
         finished_at = ?
     WHERE id = ?`,
  ).run(showId, rowsImported, rowsUpdated, rowsSkipped, nowIso(), jobId);
}

export function markImportJobFailed(db: WeebScreenDatabase, jobId: number, errorText: string): void {
  db.prepare(
    `UPDATE import_jobs
     SET status = 'failed',
         error_text = ?,
         finished_at = ?
     WHERE id = ?`,
  ).run(errorText, nowIso(), jobId);
}

export function getImportJob(db: WeebScreenDatabase, jobId: number): ImportJob | null {
  const row = db.prepare("SELECT * FROM import_jobs WHERE id = ?").get(jobId) as ImportJobRow | undefined;
  return row ? mapImportJob(row) : null;
}

export function listImportJobs(db: WeebScreenDatabase): ImportJob[] {
  const rows = db.prepare("SELECT * FROM import_jobs ORDER BY created_at DESC, id DESC LIMIT 50").all() as ImportJobRow[];
  return rows.map(mapImportJob);
}

export function getImportPreviewFromJob(db: WeebScreenDatabase, jobId: number): ImportPreview | null {
  const row = db
    .prepare("SELECT preview_json FROM import_jobs WHERE id = ?")
    .get(jobId) as { preview_json: string | null } | undefined;

  if (!row?.preview_json) {
    return null;
  }

  try {
    return JSON.parse(row.preview_json) as ImportPreview;
  } catch (_error) {
    return null;
  }
}

type RunnableStatement = {
  run: (...params: unknown[]) => unknown;
};

function bindInsertEpisode(statement: RunnableStatement, showId: number, episode: EpisodeImportRow, now: string): void {
  statement.run(
    showId,
    episode.realEpisodeNumber,
    episode.serviceSeasonNumber,
    episode.serviceEpisodeNumber,
    episode.serviceEpisodeCode,
    episode.episodeTitle,
    episode.fillerBucket,
    episode.canonFillerType,
    episode.originalAirdate,
    episode.episodeDataSourceUrl,
    episode.seasonBoundarySourceUrl,
    now,
    now,
  );
}

function formatIssueSummary(preview: ImportPreview): string | null {
  const errors = preview.issues.filter((issue) => issue.level === "error");
  if (errors.length === 0) {
    return null;
  }

  return errors
    .slice(0, 20)
    .map((issue) => {
      const place = issue.row ? `row ${issue.row}${issue.column ? ` ${issue.column}` : ""}` : issue.column ?? "file";
      return `${place}: ${issue.message}`;
    })
    .join("\n");
}

function bindUpdateEpisode(statement: RunnableStatement, episode: EpisodeImportRow, episodeId: number, now: string): void {
  statement.run(
    episode.serviceSeasonNumber,
    episode.serviceEpisodeNumber,
    episode.serviceEpisodeCode,
    episode.episodeTitle,
    episode.fillerBucket,
    episode.canonFillerType,
    episode.originalAirdate,
    episode.episodeDataSourceUrl,
    episode.seasonBoundarySourceUrl,
    now,
    episodeId,
  );
}

function writeProgress(db: WeebScreenDatabase, episodeId: number, watched: boolean): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO progress(profile_id, episode_id, watched, watched_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(profile_id, episode_id) DO UPDATE SET
       watched = excluded.watched,
       watched_at = excluded.watched_at,
       updated_at = excluded.updated_at`,
  ).run(PROFILE_ID, episodeId, watched ? 1 : 0, watched ? now : null, now);
}

function getEpisodeById(db: WeebScreenDatabase, episodeId: number): EpisodeWithProgress | null {
  const row = db
    .prepare(
      `SELECT
        e.id,
        e.show_id,
        e.real_episode_number,
        e.service_season_number,
        e.service_episode_number,
        e.service_episode_code,
        e.episode_title,
        e.filler_bucket,
        e.canon_filler_type,
        e.original_airdate,
        p.watched,
        p.watched_at
      FROM episodes e
      LEFT JOIN progress p ON p.episode_id = e.id AND p.profile_id = ?
      WHERE e.id = ?`,
    )
    .get(PROFILE_ID, episodeId) as EpisodeRow | undefined;

  return row ? mapEpisode(row) : null;
}

function getShow(db: WeebScreenDatabase, slug: string): Show | null {
  const row = db.prepare("SELECT * FROM shows WHERE slug = ?").get(slug) as ShowRow | undefined;
  return row ? mapShow(row) : null;
}

function getProgressSummary(db: WeebScreenDatabase, showId: number): ProgressSummary {
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN e.filler_bucket = 'No' AND COALESCE(p.watched, 0) = 1 THEN 1 ELSE 0 END), 0) AS canon_watched,
        COALESCE(SUM(CASE WHEN e.filler_bucket = 'No' THEN 1 ELSE 0 END), 0) AS canon_total,
        COALESCE(SUM(CASE WHEN COALESCE(p.watched, 0) = 1 THEN 1 ELSE 0 END), 0) AS all_watched,
        COUNT(e.id) AS all_total
      FROM episodes e
      LEFT JOIN progress p ON p.episode_id = e.id AND p.profile_id = ?
      WHERE e.show_id = ?`,
    )
    .get(PROFILE_ID, showId) as SummaryRow;

  return mapSummary(row);
}

function mapShow(row: ShowRow): Show {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    serviceName: row.service_name,
    totalRealEpisodes: row.total_real_episodes,
    seasonBoundarySourceUrl: row.season_boundary_source_url,
    notes: row.notes,
  };
}

function mapEpisode(row: EpisodeRow): EpisodeWithProgress {
  return {
    id: row.id,
    showId: row.show_id,
    realEpisodeNumber: row.real_episode_number,
    serviceSeasonNumber: row.service_season_number,
    serviceEpisodeNumber: row.service_episode_number,
    serviceEpisodeCode: row.service_episode_code,
    episodeTitle: row.episode_title,
    fillerBucket: row.filler_bucket,
    canonFillerType: row.canon_filler_type,
    originalAirdate: row.original_airdate,
    watched: row.watched === 1,
    watchedAt: row.watched_at,
  };
}

function mapSummary(row: SummaryRow): ProgressSummary {
  return {
    canonWatched: row.canon_watched ?? 0,
    canonTotal: row.canon_total ?? 0,
    allWatched: row.all_watched ?? 0,
    allTotal: row.all_total ?? 0,
  };
}

function mapImportJob(row: ImportJobRow): ImportJob {
  return {
    id: row.id,
    showId: row.show_id,
    filename: row.filename,
    format: row.format,
    showSlug: row.show_slug,
    status: row.status,
    rowsTotal: row.rows_total,
    rowsImported: row.rows_imported,
    rowsUpdated: row.rows_updated,
    rowsSkipped: row.rows_skipped,
    countsJson: row.counts_json,
    errorText: row.error_text,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
