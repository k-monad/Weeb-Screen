export const FILLER_BUCKETS = ["No", "Mixed", "Yes"] as const;

export type FillerBucket = (typeof FILLER_BUCKETS)[number];

export type ImportFormat = "csv";

export type ImportIssueLevel = "error" | "warning";

export type ImportIssue = {
  level: ImportIssueLevel;
  row?: number;
  column?: string;
  message: string;
};

export type ShowMetadataInput = {
  showTitle: string;
  showSlug: string;
  serviceName?: string;
};

export type ParsedShow = {
  title: string;
  slug: string;
  serviceName: string | null;
  notes: string | null;
  seasonBoundarySourceUrl: string | null;
};

export type EpisodeImportRow = {
  realEpisodeNumber: number;
  serviceEpisodeCode: string;
  episodeTitle: string;
  fillerBucket: FillerBucket;
  canonFillerType: string;
  originalAirdate: string | null;
  serviceSeasonNumber: number;
  serviceEpisodeNumber: number;
  episodeDataSourceUrl: string | null;
  seasonBoundarySourceUrl: string | null;
};

export type ImportCounts = {
  total: number;
  seasons: number;
  fillerBuckets: Record<FillerBucket, number>;
  canonFillerTypes: Record<string, number>;
};

export type ImportPreview = {
  format: ImportFormat;
  show: ParsedShow;
  episodes: EpisodeImportRow[];
  counts: ImportCounts;
  issues: ImportIssue[];
};

export type NarutoOracle = {
  total: 500;
  seasons: 21;
  fillerBuckets: {
    No: 233;
    Mixed: 64;
    Yes: 203;
  };
};

export const NARUTO_ORACLE: NarutoOracle = {
  total: 500,
  seasons: 21,
  fillerBuckets: {
    No: 233,
    Mixed: 64,
    Yes: 203,
  },
};
