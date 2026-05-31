export type FillerBucket = "No" | "Mixed" | "Yes";

export type Show = {
  id: number;
  title: string;
  slug: string;
  serviceName: string | null;
  totalRealEpisodes: number | null;
  seasonBoundarySourceUrl: string | null;
  notes: string | null;
};

export type EpisodeWithProgress = {
  id: number;
  showId: number;
  realEpisodeNumber: number;
  serviceSeasonNumber: number;
  serviceEpisodeNumber: number;
  serviceEpisodeCode: string;
  episodeTitle: string;
  fillerBucket: FillerBucket;
  canonFillerType: string;
  originalAirdate: string | null;
  watched: boolean;
  watchedAt: string | null;
};

export type ProgressSummary = {
  canonWatched: number;
  canonTotal: number;
  allWatched: number;
  allTotal: number;
};

export type ShowSummary = Show &
  ProgressSummary & {
    progressMode: "canon" | "all";
  };

export type ShowDetail = {
  show: Show;
  summary: ProgressSummary;
  episodes: EpisodeWithProgress[];
  preferences: {
    skipFiller: boolean;
    seasonDetails: boolean;
  };
};

export type NextEpisodeResult = {
  next: EpisodeWithProgress | null;
  reason: "next" | "all-caught-up" | "all-canon-watched" | "only-filler-remaining";
  fillerRemaining: number;
};

