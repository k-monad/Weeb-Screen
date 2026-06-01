import { getNextEpisode, setEpisodeWatched } from "../../src/db/repositories.js";
import { buildServer } from "../../src/server.js";
import { createTempDatabase } from "../helpers/db.js";

const token = "test-admin-token";
const csvImport = Buffer.from(
  `real_episode_number,service_season_number,service_episode_number,episode_title,filler_bucket,canon_filler_type,original_airdate,episode_data_source_url,season_boundary_source_url
1,1,1,Start,No,Manga Canon,2007-02-15,https://example.com/episodes,https://example.com/seasons
2,1,2,Filler Beach,Yes,Filler,2007-02-22,https://example.com/episodes,https://example.com/seasons
3,1,3,Bridge,Mixed,Mixed Canon/Filler,2007-03-01,https://example.com/episodes,https://example.com/seasons
`,
  "utf8",
);

describe("admin import flow", () => {
  it("rejects missing or wrong admin tokens", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db, { adminToken: token });
    try {
      expect((await app.inject({ method: "GET", url: "/admin" })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/admin", headers: { "x-weebscreen-admin-token": "wrong" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: `/admin?token=${token}` })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/admin", headers: { "x-weebscreen-admin-token": token } })).statusCode).toBe(200);
    } finally {
      await app.close();
      cleanup();
    }
  });

  it("previews and commits a CSV import through token-gated admin routes", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db, { adminToken: token });
    try {
      const preview = await app.inject({
        method: "POST",
        url: "/admin/import/preview",
        headers: {
          "x-weebscreen-admin-token": token,
          ...multipartHeaders("test-boundary"),
        },
        payload: multipartBody("test-boundary", {
          show_title: "Naruto Shippuden",
          show_slug: "naruto-shippuden",
          service_name: "Netflix",
        }, "naruto_shippuden_netflix_episode_mapping.csv", csvImport),
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain("3 episodes");
      expect(preview.body).toContain("No/Mixed/Yes = 1/1/1");
      const jobId = Number.parseInt(preview.body.match(/name="job_id" value="(\d+)"/)?.[1] ?? "", 10);
      expect(jobId).toBeGreaterThan(0);

      const commit = await app.inject({
        method: "POST",
        url: "/admin/import/commit",
        headers: {
          "x-weebscreen-admin-token": token,
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: `job_id=${jobId}`,
      });

      expect(commit.statusCode).toBe(200);
      expect(commit.body).toContain("Import committed.");
      expect(getNextEpisode(db, "naruto-shippuden", false)?.next?.realEpisodeNumber).toBe(1);
      expect(db.prepare("SELECT status, rows_imported, rows_updated, rows_skipped FROM import_jobs WHERE id = ?").get(jobId)).toEqual({
        status: "committed",
        rows_imported: 3,
        rows_updated: 0,
        rows_skipped: 0,
      });
    } finally {
      await app.close();
      cleanup();
    }
  });

  it("re-imports by replacing episodes in place while preserving progress", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db, { adminToken: token });
    try {
      const firstJob = await previewCsv(app);
      await commitJob(app, firstJob);
      setEpisodeWatched(db, "naruto-shippuden", 1, true);

      const secondJob = await previewCsv(app);
      await commitJob(app, secondJob);

      expect(getNextEpisode(db, "naruto-shippuden", false)?.next?.realEpisodeNumber).toBe(2);
      expect(db.prepare("SELECT rows_imported, rows_updated, rows_skipped FROM import_jobs WHERE id = ?").get(secondJob)).toEqual({
        rows_imported: 0,
        rows_updated: 3,
        rows_skipped: 0,
      });
    } finally {
      await app.close();
      cleanup();
    }
  });

  it("commits a preview after restart by loading preview JSON from import_jobs", async () => {
    const { db, cleanup } = createTempDatabase();
    const appA = await buildServer(db, { adminToken: token });

    let jobId = 0;
    try {
      jobId = await previewCsv(appA);
    } finally {
      await appA.close();
    }

    const appB = await buildServer(db, { adminToken: token });
    try {
      await commitJob(appB, jobId);

      expect(db.prepare("SELECT status, rows_imported FROM import_jobs WHERE id = ?").get(jobId)).toEqual({
        status: "committed",
        rows_imported: 3,
      });
    } finally {
      await appB.close();
      cleanup();
    }
  });

  it("exposes settings and requires admin token for settings mutations", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db, { adminToken: token });

    try {
      const initial = await app.inject({ method: "GET", url: "/settings" });
      expect(initial.statusCode).toBe(200);
      expect(JSON.parse(initial.body)).toEqual({
        defaults: {
          skipFiller: false,
          progressView: "canon",
          seasonDetails: false,
        },
        showOverrides: [],
      });

      const denied = await app.inject({
        method: "POST",
        url: "/settings",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "skip_filler_default=true",
      });
      expect(denied.statusCode).toBe(403);

      const updated = await app.inject({
        method: "POST",
        url: "/settings",
        headers: {
          "x-weebscreen-admin-token": token,
          "content-type": "application/x-www-form-urlencoded",
        },
        payload:
          "skip_filler_default=true&season_details_default=true&progress_view_default=all&show_slug=naruto-shippuden&skip_filler=false&season_details=true",
      });

      expect(updated.statusCode).toBe(200);
      expect(JSON.parse(updated.body)).toEqual({
        defaults: {
          skipFiller: true,
          progressView: "all",
          seasonDetails: true,
        },
        showOverrides: [
          {
            showSlug: "naruto-shippuden",
            skipFiller: false,
            seasonDetails: true,
          },
        ],
      });
    } finally {
      await app.close();
      cleanup();
    }
  });

  it("rejects spreadsheet uploads in production-safe CSV-only mode", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db, { adminToken: token });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/admin/import/preview",
        headers: {
          "x-weebscreen-admin-token": token,
          ...multipartHeaders("xlsx-boundary"),
        },
        payload: multipartBody("xlsx-boundary", {
          show_title: "Naruto Shippuden",
          show_slug: "naruto-shippuden",
          service_name: "Netflix",
        }, "naruto_shippuden_netflix_episode_mapping.xlsx", Buffer.from("not really xlsx", "utf8")),
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("Spreadsheet imports are disabled for production. Export the mapping as CSV.");
    } finally {
      await app.close();
      cleanup();
    }
  });
});

async function previewCsv(app: Awaited<ReturnType<typeof buildServer>>): Promise<number> {
  const response = await app.inject({
    method: "POST",
    url: "/admin/import/preview",
    headers: {
      "x-weebscreen-admin-token": token,
      ...multipartHeaders("reimport-boundary"),
    },
    payload: multipartBody("reimport-boundary", {
      show_title: "Naruto Shippuden",
      show_slug: "naruto-shippuden",
      service_name: "Netflix",
    }, "naruto_shippuden_netflix_episode_mapping.csv", csvImport),
  });

  expect(response.statusCode).toBe(200);
  return Number.parseInt(response.body.match(/name="job_id" value="(\d+)"/)?.[1] ?? "", 10);
}

async function commitJob(app: Awaited<ReturnType<typeof buildServer>>, jobId: number): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/admin/import/commit",
    headers: {
      "x-weebscreen-admin-token": token,
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: `job_id=${jobId}`,
  });
  expect(response.statusCode).toBe(200);
}

function multipartHeaders(boundary: string): { "content-type": string } {
  return { "content-type": `multipart/form-data; boundary=${boundary}` };
}

function multipartBody(fields: Record<string, string>, filename: string, file: Buffer): Buffer;
function multipartBody(boundary: string, fields: Record<string, string>, filename: string, file: Buffer): Buffer;
function multipartBody(
  boundaryOrFields: string | Record<string, string>,
  maybeFields?: Record<string, string> | string,
  maybeFilename?: string | Buffer,
  maybeFile?: Buffer,
): Buffer {
  const boundary = typeof boundaryOrFields === "string" ? boundaryOrFields : "boundary";
  const fields = typeof boundaryOrFields === "string" ? (maybeFields as Record<string, string>) : boundaryOrFields;
  const filename = typeof maybeFilename === "string" ? maybeFilename : (maybeFields as string);
  const file = maybeFile ?? (maybeFilename as Buffer);
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }

  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n`,
    ),
  );
  chunks.push(file);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}
