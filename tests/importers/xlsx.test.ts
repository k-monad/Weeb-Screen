import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseXlsxImport } from "../../src/importers/xlsx.js";

const workbookPath = join(process.cwd(), "naruto_shippuden_netflix_episode_mapping.xlsx");

describe("XLSX importer", () => {
  it("reproduces the Naruto Shippuden oracle and source contract", async () => {
    const preview = await parseXlsxImport(readFileSync(workbookPath), {
      showTitle: "Naruto Shippuden",
      showSlug: "naruto-shippuden",
      serviceName: "Netflix",
    });

    expect(preview.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(preview.episodes).toHaveLength(500);
    expect(preview.counts.seasons).toBe(21);
    expect(preview.counts.fillerBuckets).toEqual({ No: 233, Mixed: 64, Yes: 203 });
    expect(preview.counts.canonFillerTypes).toEqual({
      "Anime Canon": 1,
      Filler: 203,
      "Manga Canon": 232,
      "Mixed Canon/Filler": 64,
    });

    expect(preview.episodes.every((episode) => episode.serviceEpisodeCode === `S${episode.serviceSeasonNumber}E${String(episode.serviceEpisodeNumber).padStart(2, "0")}`)).toBe(true);
    expect(preview.episodes.every((episode) => episode.episodeDataSourceUrl?.startsWith("https://"))).toBe(true);
    expect(preview.episodes.every((episode) => episode.seasonBoundarySourceUrl?.startsWith("https://"))).toBe(true);
  });

  it("converts Excel datetimes to ISO dates and accepts the S2E21 placeholder", async () => {
    const preview = await parseXlsxImport(readFileSync(workbookPath), {
      showTitle: "Naruto Shippuden",
      showSlug: "naruto-shippuden",
      serviceName: "Netflix",
    });

    expect(preview.episodes[0]).toMatchObject({
      realEpisodeNumber: 1,
      originalAirdate: "2007-02-15",
    });
    expect(preview.episodes[499]).toMatchObject({
      realEpisodeNumber: 500,
      originalAirdate: "2017-03-23",
    });

    const placeholder = preview.episodes.find((episode) => episode.serviceEpisodeCode === "S2E21");
    expect(placeholder?.episodeTitle).toBe("Title");
    expect(preview.issues).toContainEqual({
      level: "warning",
      row: 54,
      column: "Episode Title",
      message: "Placeholder title imported as-is.",
    });
  });

  it("round-trips verified Unicode titles without mojibake", async () => {
    const preview = await parseXlsxImport(readFileSync(workbookPath), {
      showTitle: "Naruto Shippuden",
      showSlug: "naruto-shippuden",
      serviceName: "Netflix",
    });

    const titles = preview.episodes.map((episode) => episode.episodeTitle);
    expect(titles).toContain("Neji’s Judgement");
    expect(titles).toContain("Kakashi: Shadow of the ANBU Black Ops – Coup D'État");
    expect(titles).toContain("Ninshū: The Ninja Creed");
    expect(Buffer.from("Ninshū: The Ninja Creed", "utf8").equals(Buffer.from(titles.find((title) => title.includes("Ninshū")) ?? "", "utf8"))).toBe(true);
  });
});

