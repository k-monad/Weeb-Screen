import { FILLER_BUCKETS, type EpisodeImportRow, type FillerBucket, type ImportCounts } from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXCEL_1900_EPOCH_UTC = Date.UTC(1899, 11, 30);

export function isFillerBucket(value: string): value is FillerBucket {
  return (FILLER_BUCKETS as readonly string[]).includes(value);
}

export function derivedServiceEpisodeCode(season: number, episode: number): string {
  return `S${season}E${String(episode).padStart(2, "0")}`;
}

export function toNonEmptyString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }

  return null;
}

export function parseIsoDateString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(EXCEL_1900_EPOCH_UTC + value * MS_PER_DAY).toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }

  return null;
}

export function isFullUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

export function emptyCounts(): ImportCounts {
  return {
    total: 0,
    seasons: 0,
    fillerBuckets: {
      No: 0,
      Mixed: 0,
      Yes: 0,
    },
    canonFillerTypes: {},
  };
}

export function computeCounts(episodes: EpisodeImportRow[]): ImportCounts {
  const counts = emptyCounts();
  const seasons = new Set<number>();

  for (const episode of episodes) {
    counts.total += 1;
    counts.fillerBuckets[episode.fillerBucket] += 1;
    counts.canonFillerTypes[episode.canonFillerType] = (counts.canonFillerTypes[episode.canonFillerType] ?? 0) + 1;
    seasons.add(episode.serviceSeasonNumber);
  }

  counts.seasons = seasons.size;
  return counts;
}

export function normalizeOptionalUrl(value: unknown): string | null {
  const text = toNonEmptyString(value);
  return text === null ? null : text;
}

