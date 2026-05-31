import { parseCsvImport } from "../../src/importers/csv.js";

const metadata = {
  showTitle: "Demo Anime",
  showSlug: "demo-anime",
  serviceName: "ExampleTV",
};

describe("CSV importer", () => {
  it("parses the stable template and derives optional service episode code", () => {
    const preview = parseCsvImport(
      `real_episode_number,service_season_number,service_episode_number,episode_title,filler_bucket,canon_filler_type,original_airdate,episode_data_source_url,season_boundary_source_url
1,1,1,Start,No,Manga Canon,2026-01-01,https://example.com/episodes,https://example.com/seasons
2,1,2,Side Story,Yes,Filler,,,
3,1,3,Bridge,Mixed,Mixed Canon/Filler,2026-01-03,,`,
      metadata,
    );

    expect(preview.issues).toEqual([]);
    expect(preview.episodes.map((episode) => episode.serviceEpisodeCode)).toEqual(["S1E01", "S1E02", "S1E03"]);
    expect(preview.counts.fillerBuckets).toEqual({ No: 1, Mixed: 1, Yes: 1 });
  });

  it("validates provided service_episode_code when present", () => {
    const preview = parseCsvImport(
      `real_episode_number,service_season_number,service_episode_number,service_episode_code,episode_title,filler_bucket,canon_filler_type
1,2,3,S2E99,Start,No,Manga Canon`,
      metadata,
    );

    expect(preview.issues).toContainEqual({
      level: "error",
      row: 2,
      column: "service_episode_code",
      message: "Expected S2E03 from season/episode numbers; received \"S2E99\".",
    });
  });

  it("requires show-level CSV columns to be constant and match the admin form", () => {
    const preview = parseCsvImport(
      `show_title,show_slug,service_name,real_episode_number,service_season_number,service_episode_number,episode_title,filler_bucket,canon_filler_type
Demo Anime,demo-anime,ExampleTV,1,1,1,Start,No,Manga Canon
Other Anime,demo-anime,ExampleTV,2,1,2,Next,No,Manga Canon`,
      metadata,
    );

    expect(preview.issues).toContainEqual({
      level: "error",
      column: "show_title",
      message: "CSV show-level column \"show_title\" must be constant across all rows.",
    });
  });

  it("allows the placeholder title but reports it as a warning", () => {
    const preview = parseCsvImport(
      `real_episode_number,service_season_number,service_episode_number,episode_title,filler_bucket,canon_filler_type
1,2,21,Title,No,Manga Canon`,
      metadata,
    );

    expect(preview.issues).toContainEqual({
      level: "warning",
      row: 2,
      column: "episode_title",
      message: "Placeholder title imported as-is.",
    });
  });
});

