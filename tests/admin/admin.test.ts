import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getNextEpisode, setEpisodeWatched } from "../../src/db/repositories.js";
import { buildServer } from "../../src/server.js";
import { createTempDatabase } from "../helpers/db.js";

const token = "test-admin-token";
const workbook = readFileSync(join(process.cwd(), "naruto_shippuden_netflix_episode_mapping.xlsx"));

describe("admin import flow", () => {
  it("rejects missing or wrong admin tokens", async () => {
    const { db, cleanup } = createTempDatabase();
    const app = await buildServer(db, { adminToken: token });
    try {
      expect((await app.inject({ method: "GET", url: "/admin" })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/admin", headers: { "x-weebscreen-admin-token": "wrong" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/admin", headers: { "x-weebscreen-admin-token": token } })).statusCode).toBe(200);
    } finally {
      await app.close();
      cleanup();
    }
  });

  it("previews and commits the Naruto workbook through token-gated admin routes", async () => {
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
        }, "naruto_shippuden_netflix_episode_mapping.xlsx", workbook),
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain("500 episodes");
      expect(preview.body).toContain("No/Mixed/Yes = 233/64/203");
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
      expect(db.prepare("SELECT status, rows_imported, rows_updated FROM import_jobs WHERE id = ?").get(jobId)).toEqual({
        status: "committed",
        rows_imported: 500,
        rows_updated: 0,
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
      const firstJob = await previewWorkbook(app);
      await commitJob(app, firstJob);
      setEpisodeWatched(db, "naruto-shippuden", 1, true);

      const secondJob = await previewWorkbook(app);
      await commitJob(app, secondJob);

      expect(getNextEpisode(db, "naruto-shippuden", false)?.next?.realEpisodeNumber).toBe(2);
      expect(db.prepare("SELECT rows_imported, rows_updated FROM import_jobs WHERE id = ?").get(secondJob)).toEqual({
        rows_imported: 0,
        rows_updated: 500,
      });
    } finally {
      await app.close();
      cleanup();
    }
  });
});

async function previewWorkbook(app: Awaited<ReturnType<typeof buildServer>>): Promise<number> {
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
    }, "naruto_shippuden_netflix_episode_mapping.xlsx", workbook),
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
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    ),
  );
  chunks.push(file);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

