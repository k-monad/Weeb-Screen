import * as XLSX from "xlsx";

import {
  NARUTO_ORACLE,
  type EpisodeImportRow,
  type ImportIssue,
  type ImportPreview,
  type ShowMetadataInput,
} from "./types.js";
import {
  computeCounts,
  derivedServiceEpisodeCode,
  isFillerBucket,
  isFullUrl,
  normalizeOptionalUrl,
  parseInteger,
  parseIsoDateString,
  toNonEmptyString,
} from "./validation.js";

const MAPPING_HEADERS = [
  "Real Episode #",
  "Netflix #",
  "Episode Title",
  "Filler?",
  "Canon/Filler Type",
  "Original Airdate",
  "Netflix Season",
  "Netflix Episode #",
  "Episode Data Source",
  "Seasoning Source",
] as const;

type MappingHeader = (typeof MAPPING_HEADERS)[number];

type HeaderIndexes = Record<MappingHeader, number>;

export function parseXlsxImport(file: Buffer, metadata: ShowMetadataInput): ImportPreview {
  const workbook = XLSX.read(file, {
    cellDates: true,
    cellText: false,
    cellFormula: false,
    type: "buffer",
  });

  const issues: ImportIssue[] = [];
  const mapping = workbook.Sheets.Mapping;
  if (!mapping) {
    return emptyXlsxPreview(metadata, [{ level: "error", message: "Missing required Mapping sheet." }]);
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(mapping, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });

  const headers = readHeaderIndexes(rows[0], issues);
  if (!headers) {
    return emptyXlsxPreview(metadata, issues);
  }

  const episodes: EpisodeImportRow[] = [];
  const seenRealNumbers = new Set<number>();

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (rowIsEmpty(row)) {
      return;
    }

    const episode = parseMappingRow(row, rowNumber, headers, issues);
    if (!episode) {
      return;
    }

    if (seenRealNumbers.has(episode.realEpisodeNumber)) {
      issues.push({
        level: "error",
        row: rowNumber,
        column: "Real Episode #",
        message: `Duplicate real episode number ${episode.realEpisodeNumber}.`,
      });
      return;
    }

    seenRealNumbers.add(episode.realEpisodeNumber);
    episodes.push(episode);
  });

  const counts = computeCounts(episodes);
  addNarutoOracleErrors(counts, issues);

  return {
    format: "xlsx",
    show: {
      title: metadata.showTitle,
      slug: metadata.showSlug,
      serviceName: metadata.serviceName ?? null,
      notes: extractSourcesNotes(workbook),
      seasonBoundarySourceUrl: firstNonNull(episodes.map((episode) => episode.seasonBoundarySourceUrl)),
    },
    episodes,
    counts,
    issues,
  };
}

function emptyXlsxPreview(metadata: ShowMetadataInput, issues: ImportIssue[]): ImportPreview {
  return {
    format: "xlsx",
    show: {
      title: metadata.showTitle,
      slug: metadata.showSlug,
      serviceName: metadata.serviceName ?? null,
      notes: null,
      seasonBoundarySourceUrl: null,
    },
    episodes: [],
    counts: computeCounts([]),
    issues,
  };
}

function readHeaderIndexes(headerRow: unknown[] | undefined, issues: ImportIssue[]): HeaderIndexes | null {
  if (!headerRow) {
    issues.push({ level: "error", row: 1, message: "Mapping sheet is empty." });
    return null;
  }

  const indexes = {} as Partial<HeaderIndexes>;
  for (let index = 0; index < MAPPING_HEADERS.length; index += 1) {
    const expected = MAPPING_HEADERS[index];
    if (!expected) {
      continue;
    }

    const actual = toNonEmptyString(headerRow[index]);
    if (actual !== expected) {
      issues.push({
        level: "error",
        row: 1,
        column: expected,
        message: `Expected column ${index + 1} to be "${expected}", received "${actual ?? ""}".`,
      });
      return null;
    }

    indexes[expected] = index;
  }

  return indexes as HeaderIndexes;
}

function parseMappingRow(
  row: unknown[],
  rowNumber: number,
  headers: HeaderIndexes,
  issues: ImportIssue[],
): EpisodeImportRow | null {
  const realEpisodeNumber = requiredInteger(row, rowNumber, headers, "Real Episode #", issues);
  const serviceSeasonNumber = requiredInteger(row, rowNumber, headers, "Netflix Season", issues);
  const serviceEpisodeNumber = requiredInteger(row, rowNumber, headers, "Netflix Episode #", issues);
  const episodeTitle = requiredText(row, rowNumber, headers, "Episode Title", issues);
  const fillerBucketText = requiredText(row, rowNumber, headers, "Filler?", issues);
  const canonFillerType = requiredText(row, rowNumber, headers, "Canon/Filler Type", issues);
  const workbookCode = requiredText(row, rowNumber, headers, "Netflix #", issues);
  const originalAirdate = parseIsoDateString(row[headers["Original Airdate"]]);
  const episodeDataSourceUrl = normalizeOptionalUrl(row[headers["Episode Data Source"]]);
  const seasonBoundarySourceUrl = normalizeOptionalUrl(row[headers["Seasoning Source"]]);

  if (
    realEpisodeNumber === null ||
    serviceSeasonNumber === null ||
    serviceEpisodeNumber === null ||
    episodeTitle === null ||
    fillerBucketText === null ||
    canonFillerType === null ||
    workbookCode === null
  ) {
    return null;
  }

  if (!isFillerBucket(fillerBucketText)) {
    issues.push({
      level: "error",
      row: rowNumber,
      column: "Filler?",
      message: `Expected one of No, Mixed, Yes; received "${fillerBucketText}".`,
    });
    return null;
  }

  if (originalAirdate === null && toNonEmptyString(row[headers["Original Airdate"]]) !== null) {
    issues.push({
      level: "error",
      row: rowNumber,
      column: "Original Airdate",
      message: "Expected an Excel date or ISO yyyy-mm-dd value.",
    });
    return null;
  }

  validateUrl(rowNumber, "Episode Data Source", episodeDataSourceUrl, issues);
  validateUrl(rowNumber, "Seasoning Source", seasonBoundarySourceUrl, issues);

  const serviceEpisodeCode = derivedServiceEpisodeCode(serviceSeasonNumber, serviceEpisodeNumber);
  if (workbookCode !== serviceEpisodeCode) {
    issues.push({
      level: "error",
      row: rowNumber,
      column: "Netflix #",
      message: `Expected ${serviceEpisodeCode} from season/episode numbers; received "${workbookCode}".`,
    });
    return null;
  }

  if (episodeTitle === "Title") {
    issues.push({
      level: "warning",
      row: rowNumber,
      column: "Episode Title",
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

function requiredInteger(
  row: unknown[],
  rowNumber: number,
  headers: HeaderIndexes,
  column: MappingHeader,
  issues: ImportIssue[],
): number | null {
  const value = parseInteger(row[headers[column]]);
  if (value === null) {
    issues.push({
      level: "error",
      row: rowNumber,
      column,
      message: "Expected an integer.",
    });
  }
  return value;
}

function requiredText(
  row: unknown[],
  rowNumber: number,
  headers: HeaderIndexes,
  column: MappingHeader,
  issues: ImportIssue[],
): string | null {
  const value = toNonEmptyString(row[headers[column]]);
  if (value === null) {
    issues.push({
      level: "error",
      row: rowNumber,
      column,
      message: "Expected a non-empty value.",
    });
  }
  return value;
}

function validateUrl(row: number, column: string, value: string | null, issues: ImportIssue[]): void {
  if (value !== null && !isFullUrl(value)) {
    issues.push({
      level: "error",
      row,
      column,
      message: "Expected a full http(s) URL.",
    });
  }
}

function rowIsEmpty(row: unknown[]): boolean {
  return row.every((value) => value === null || value === undefined || String(value).trim().length === 0);
}

function extractSourcesNotes(workbook: XLSX.WorkBook): string | null {
  const sheet = workbook.Sheets.Sources;
  if (!sheet) {
    return null;
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });

  const lines = rows
    .map((row) => row.map((value) => toNonEmptyString(value)).filter((value): value is string => value !== null))
    .filter((cells) => cells.length > 0)
    .map((cells) => cells.join(" | "));

  return lines.length > 0 ? lines.join("\n") : null;
}

function addNarutoOracleErrors(counts: ReturnType<typeof computeCounts>, issues: ImportIssue[]): void {
  const looksLikeNarutoWorkbook = counts.total === NARUTO_ORACLE.total || counts.seasons === NARUTO_ORACLE.seasons;
  if (!looksLikeNarutoWorkbook) {
    return;
  }

  if (
    counts.total !== NARUTO_ORACLE.total ||
    counts.seasons !== NARUTO_ORACLE.seasons ||
    counts.fillerBuckets.No !== NARUTO_ORACLE.fillerBuckets.No ||
    counts.fillerBuckets.Mixed !== NARUTO_ORACLE.fillerBuckets.Mixed ||
    counts.fillerBuckets.Yes !== NARUTO_ORACLE.fillerBuckets.Yes
  ) {
    issues.push({
      level: "error",
      message: "Workbook failed the Naruto Shippuden oracle: expected 500 episodes, 21 seasons, No/Mixed/Yes = 233/64/203.",
    });
  }
}

function firstNonNull(values: Array<string | null>): string | null {
  return values.find((value): value is string => value !== null) ?? null;
}

