import { parse } from "csv-parse/sync";

import type { EpisodeImportRow, ImportIssue, ImportPreview, ShowMetadataInput } from "./types.js";
import {
  computeCounts,
  derivedServiceEpisodeCode,
  isFillerBucket,
  isFullUrl,
  parseInteger,
  parseIsoDateString,
  toNonEmptyString,
} from "./validation.js";

const REQUIRED_COLUMNS = [
  "real_episode_number",
  "service_season_number",
  "service_episode_number",
  "episode_title",
  "filler_bucket",
  "canon_filler_type",
] as const;

const OPTIONAL_COLUMNS = [
  "show_title",
  "show_slug",
  "service_name",
  "service_episode_code",
  "original_airdate",
  "episode_data_source_url",
  "season_boundary_source_url",
] as const;

const SHOW_COLUMNS = ["show_title", "show_slug", "service_name"] as const;

type CsvRecord = Record<string, string | undefined>;

export function parseCsvImport(csvText: string, metadata: ShowMetadataInput): ImportPreview {
  const issues: ImportIssue[] = [];
  const records = parse(csvText, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRecord[];

  validateHeaders(records, issues);
  validateShowColumns(records, metadata, issues);

  const episodes: EpisodeImportRow[] = [];
  const seenRealNumbers = new Set<number>();

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const episode = parseCsvRecord(record, rowNumber, issues);
    if (!episode) {
      return;
    }

    if (seenRealNumbers.has(episode.realEpisodeNumber)) {
      issues.push({
        level: "error",
        row: rowNumber,
        column: "real_episode_number",
        message: `Duplicate real episode number ${episode.realEpisodeNumber}.`,
      });
      return;
    }

    seenRealNumbers.add(episode.realEpisodeNumber);
    episodes.push(episode);
  });

  return {
    format: "csv",
    show: {
      title: metadata.showTitle,
      slug: metadata.showSlug,
      serviceName: metadata.serviceName ?? null,
      notes: null,
      seasonBoundarySourceUrl: episodes.find((episode) => episode.seasonBoundarySourceUrl)?.seasonBoundarySourceUrl ?? null,
    },
    episodes,
    counts: computeCounts(episodes),
    issues,
  };
}

function validateHeaders(records: CsvRecord[], issues: ImportIssue[]): void {
  const first = records[0];
  const headers = new Set(first ? Object.keys(first) : []);

  for (const column of REQUIRED_COLUMNS) {
    if (!headers.has(column)) {
      issues.push({
        level: "error",
        column,
        message: `Missing required CSV column "${column}".`,
      });
    }
  }

  const allowedHeaders = new Set([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);
  for (const header of headers) {
    if (!allowedHeaders.has(header as (typeof REQUIRED_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number])) {
      issues.push({
        level: "warning",
        column: header,
        message: "Unrecognized CSV column will be ignored.",
      });
    }
  }
}

function validateShowColumns(records: CsvRecord[], metadata: ShowMetadataInput, issues: ImportIssue[]): void {
  for (const column of SHOW_COLUMNS) {
    const values = uniquePresentValues(records.map((record) => record[column]));
    if (values.length === 0) {
      continue;
    }
    if (values.length > 1) {
      issues.push({
        level: "error",
        column,
        message: `CSV show-level column "${column}" must be constant across all rows.`,
      });
      continue;
    }

    const expected =
      column === "show_title" ? metadata.showTitle : column === "show_slug" ? metadata.showSlug : metadata.serviceName;

    if (expected !== undefined && expected !== values[0]) {
      issues.push({
        level: "error",
        column,
        message: `CSV ${column} "${values[0]}" does not match the admin form value "${expected}".`,
      });
    }
  }
}

function parseCsvRecord(record: CsvRecord, rowNumber: number, issues: ImportIssue[]): EpisodeImportRow | null {
  const realEpisodeNumber = requiredInteger(record, rowNumber, "real_episode_number", issues);
  const serviceSeasonNumber = requiredInteger(record, rowNumber, "service_season_number", issues);
  const serviceEpisodeNumber = requiredInteger(record, rowNumber, "service_episode_number", issues);
  const episodeTitle = requiredText(record, rowNumber, "episode_title", issues);
  const fillerBucketText = requiredText(record, rowNumber, "filler_bucket", issues);
  const canonFillerType = requiredText(record, rowNumber, "canon_filler_type", issues);

  if (
    realEpisodeNumber === null ||
    serviceSeasonNumber === null ||
    serviceEpisodeNumber === null ||
    episodeTitle === null ||
    fillerBucketText === null ||
    canonFillerType === null
  ) {
    return null;
  }

  if (!isFillerBucket(fillerBucketText)) {
    issues.push({
      level: "error",
      row: rowNumber,
      column: "filler_bucket",
      message: `Expected one of No, Mixed, Yes; received "${fillerBucketText}".`,
    });
    return null;
  }

  const serviceEpisodeCode = derivedServiceEpisodeCode(serviceSeasonNumber, serviceEpisodeNumber);
  const providedCode = toNonEmptyString(record.service_episode_code);
  if (providedCode !== null && providedCode !== serviceEpisodeCode) {
    issues.push({
      level: "error",
      row: rowNumber,
      column: "service_episode_code",
      message: `Expected ${serviceEpisodeCode} from season/episode numbers; received "${providedCode}".`,
    });
    return null;
  }

  const originalAirdate = parseIsoDateString(record.original_airdate);
  if (toNonEmptyString(record.original_airdate) !== null && originalAirdate === null) {
    issues.push({
      level: "error",
      row: rowNumber,
      column: "original_airdate",
      message: "Expected ISO yyyy-mm-dd date.",
    });
    return null;
  }

  const episodeDataSourceUrl = optionalUrl(record.episode_data_source_url, rowNumber, "episode_data_source_url", issues);
  const seasonBoundarySourceUrl = optionalUrl(
    record.season_boundary_source_url,
    rowNumber,
    "season_boundary_source_url",
    issues,
  );

  if (episodeTitle === "Title") {
    issues.push({
      level: "warning",
      row: rowNumber,
      column: "episode_title",
      message: "Placeholder title imported as-is.",
    });
  }

  return {
    realEpisodeNumber,
    serviceEpisodeCode,
    episodeTitle,
    fillerBucket: fillerBucketText,
    canonFillerType,
    originalAirdate,
    serviceSeasonNumber,
    serviceEpisodeNumber,
    episodeDataSourceUrl,
    seasonBoundarySourceUrl,
  };
}

function requiredInteger(record: CsvRecord, row: number, column: string, issues: ImportIssue[]): number | null {
  const value = parseInteger(record[column]);
  if (value === null) {
    issues.push({
      level: "error",
      row,
      column,
      message: "Expected an integer.",
    });
  }
  return value;
}

function requiredText(record: CsvRecord, row: number, column: string, issues: ImportIssue[]): string | null {
  const value = toNonEmptyString(record[column]);
  if (value === null) {
    issues.push({
      level: "error",
      row,
      column,
      message: "Expected a non-empty value.",
    });
  }
  return value;
}

function optionalUrl(value: string | undefined, row: number, column: string, issues: ImportIssue[]): string | null {
  const text = toNonEmptyString(value);
  if (text === null) {
    return null;
  }
  if (!isFullUrl(text)) {
    issues.push({
      level: "error",
      row,
      column,
      message: "Expected a full http(s) URL.",
    });
    return null;
  }
  return text;
}

function uniquePresentValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => toNonEmptyString(value)).filter((value): value is string => value !== null))];
}

