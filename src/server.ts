import formBody from "@fastify/formbody";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import type { FillerBucket } from "./domain/types.js";
import {
  countMissingEpisodesForImport,
  createPreviewImportJob,
  getImportPreviewFromJob,
  getSettingsSnapshot,
  listImportJobs,
  markImportJobCommitted,
  markImportJobFailed,
  getNextEpisode,
  getShowDetail,
  listShows,
  setEpisodeWatched,
  setSeasonWatched,
  setSetting,
  setShowPreference,
  setWatchedUpTo,
  upsertShowImport,
} from "./db/repositories.js";
import type { WeebScreenDatabase } from "./db/database.js";
import { parseCsvImport, parseXlsxImport, type ImportPreview, type ShowMetadataInput } from "./importers/index.js";
import { adminPage, importLogPage, importPreviewPage } from "./views/admin.js";
import { libraryPage, notFoundPage, redirectPage, showPage } from "./views/html.js";

type FormBody = Record<string, string | undefined>;
type SettingsBody = Record<string, string | boolean | undefined>;

export type ServerOptions = {
  adminToken?: string | null;
};

export async function buildServer(db: WeebScreenDatabase, options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const adminToken = options.adminToken ?? process.env.WEEBSCREEN_ADMIN_TOKEN ?? null;

  await app.register(cookie);
  await app.register(formBody);
  await app.register(multipart, {
    limits: {
      fileSize: 2 * 1024 * 1024,
      files: 1,
      fields: 6,
    },
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/", async (_request, reply) => {
    reply.type("text/html").send(libraryPage(listShows(db)));
  });

  app.get("/shows/:slug", async (request, reply) => {
    const params = request.params as { slug: string };
    const query = request.query as { bucket?: string; unwatched?: string };
    const bucket = parseBucket(query.bucket);
    const detail = getShowDetail(db, params.slug, {
      bucket,
      unwatched: query.unwatched === "1",
    });

    if (!detail) {
      reply.code(404).type("text/html").send(notFoundPage());
      return;
    }

    const next = getNextEpisode(db, detail.show.slug, detail.preferences.skipFiller);
    if (!next) {
      reply.code(404).type("text/html").send(notFoundPage());
      return;
    }

    reply.type("text/html").send(
      showPage(detail, next, {
        bucket,
        unwatched: query.unwatched === "1",
      }),
    );
  });

  app.get("/shows/:slug/next", async (request, reply) => {
    const params = request.params as { slug: string };
    const query = request.query as { skipFiller?: string };
    const result = getNextEpisode(db, params.slug, query.skipFiller === "true");
    if (!result) {
      reply.code(404).send({ error: "show_not_found" });
      return;
    }

    reply.send({
      next: result.next
        ? {
            real_episode_number: result.next.realEpisodeNumber,
            service_episode_code: result.next.serviceEpisodeCode,
            title: result.next.episodeTitle,
            filler_bucket: result.next.fillerBucket,
          }
        : null,
      reason: result.reason,
      filler_remaining: result.fillerRemaining,
    });
  });

  app.post("/shows/:slug/preferences", async (request, reply) => {
    const params = request.params as { slug: string };
    const body = request.body as FormBody;

    if (body.skip_filler !== undefined) {
      setShowPreference(db, params.slug, "skip_filler", body.skip_filler === "true");
    }
    if (body.season_details !== undefined) {
      setShowPreference(db, params.slug, "season_details", body.season_details === "true");
    }

    if (wantsJson(request)) {
      reply.send({ ok: true });
      return;
    }

    reply.type("text/html").send(redirectPage(`/shows/${params.slug}`));
  });

  app.get("/settings", async (_request, reply) => {
    reply.send(getSettingsSnapshot(db));
  });

  app.post("/settings", async (request, reply) => {
    if (!authorizeAdmin(request, reply, adminToken)) {
      return;
    }

    const body = request.body as SettingsBody;
    const skipFillerDefault = parseBooleanValue(body.skip_filler_default);
    const seasonDetailsDefault = parseBooleanValue(body.season_details_default);
    const progressViewRaw = toOptionalText(body.progress_view_default);
    const showSlug = toOptionalText(body.show_slug);
    const showSkipFiller = parseBooleanValue(body.skip_filler);
    const showSeasonDetails = parseBooleanValue(body.season_details);

    if (skipFillerDefault !== null) {
      setSetting(db, "skip_filler_default", String(skipFillerDefault));
    }

    if (seasonDetailsDefault !== null) {
      setSetting(db, "season_details_default", String(seasonDetailsDefault));
    }

    if (progressViewRaw !== null) {
      if (progressViewRaw !== "canon" && progressViewRaw !== "all") {
        reply.code(400).send({ error: "invalid_progress_view_default" });
        return;
      }
      setSetting(db, "progress_view_default", progressViewRaw);
    }

    if (showSlug !== null) {
      if (showSkipFiller !== null) {
        setShowPreference(db, showSlug, "skip_filler", showSkipFiller);
      }

      if (showSeasonDetails !== null) {
        setShowPreference(db, showSlug, "season_details", showSeasonDetails);
      }
    }

    reply.send(getSettingsSnapshot(db));
  });

  app.post("/shows/:slug/episodes/:realNum/watched", async (request, reply) => {
    const params = request.params as { slug: string; realNum: string };
    const body = request.body as FormBody | { watched?: boolean };
    const watched = parseWatched(body);
    const episode = setEpisodeWatched(db, params.slug, Number.parseInt(params.realNum, 10), watched);
    if (!episode) {
      reply.code(404).send({ error: "episode_not_found" });
      return;
    }

    reply.send({ ok: true, watched: episode.watched });
  });

  app.post("/shows/:slug/seasons/:seasonNum/watched", async (request, reply) => {
    const params = request.params as { slug: string; seasonNum: string };
    const body = request.body as FormBody | { watched?: boolean };
    const ok = setSeasonWatched(db, params.slug, Number.parseInt(params.seasonNum, 10), parseWatched(body));
    reply.code(ok ? 200 : 404).send(ok ? { ok: true } : { error: "show_not_found" });
  });

  app.post("/shows/:slug/watched/up-to/:realNum", async (request, reply) => {
    const params = request.params as { slug: string; realNum: string };
    const body = request.body as FormBody | { watched?: boolean };
    const ok = setWatchedUpTo(db, params.slug, Number.parseInt(params.realNum, 10), parseWatched(body));
    reply.code(ok ? 200 : 404).send(ok ? { ok: true } : { error: "show_not_found" });
  });

  app.get("/admin", async (request, reply) => {
    if (!authorizeAdmin(request, reply, adminToken)) {
      return;
    }

    reply.type("text/html").send(adminPage(listImportJobs(db)));
  });

  app.post("/admin/import/preview", async (request, reply) => {
    if (!authorizeAdmin(request, reply, adminToken)) {
      return;
    }

    const upload = await readImportUpload(request);
    if (!upload.ok) {
      const failedPreview = emptyFailedPreview(upload.message);
      const job = createPreviewImportJob(db, failedPreview, "upload");
      markImportJobFailed(db, job.id, upload.message);
      reply.code(400).type("text/html").send(adminPage(listImportJobs(db), upload.message));
      return;
    }

    const metadata: ShowMetadataInput = {
      showTitle: upload.fields.show_title ?? "",
      showSlug: upload.fields.show_slug ?? "",
    };
    if (upload.fields.service_name !== undefined) {
      metadata.serviceName = upload.fields.service_name;
    }

    const preview = parseUploadedImport(upload.file, upload.filename, metadata);
    const missingEpisodes = countMissingEpisodesForImport(
      db,
      preview.show.slug,
      preview.episodes.map((episode) => episode.realEpisodeNumber),
    );

    if (preview.episodes.length > 5000) {
      preview.issues.push({
        level: "error",
        message: "Import files are capped at 5000 episode rows.",
      });
    }

    if (missingEpisodes !== null) {
      preview.issues.push({
        level: "warning",
        message:
          missingEpisodes > 0
            ? `Re-import will update an existing show. ${missingEpisodes} episodes already in DB are not present in this file and will be skipped.`
            : "Re-import will update an existing show in place. No episodes are missing from this file.",
      });
    }

    const job = createPreviewImportJob(db, preview, upload.filename);
    reply.type("text/html").send(importPreviewPage(job.id, preview, listImportJobs(db)));
  });

  app.post("/admin/import/commit", async (request, reply) => {
    if (!authorizeAdmin(request, reply, adminToken)) {
      return;
    }

    const body = request.body as FormBody;
    const jobId = Number.parseInt(body.job_id ?? "", 10);
    const preview = Number.isInteger(jobId) ? getImportPreviewFromJob(db, jobId) : null;

    if (!preview) {
      reply.code(410).type("text/html").send(adminPage(listImportJobs(db), "Preview expired or missing. Re-run preview."));
      return;
    }

    const errors = preview.issues.filter((issue) => issue.level === "error");
    if (errors.length > 0) {
      markImportJobFailed(db, jobId, "Commit blocked because preview has validation errors.");
      reply.code(400).type("text/html").send(importPreviewPage(jobId, preview, listImportJobs(db)));
      return;
    }

    try {
      const result = upsertShowImport(db, preview);
      markImportJobCommitted(db, jobId, result.showId, result.inserted, result.updated, result.skipped);
      reply.type("text/html").send(adminPage(listImportJobs(db), "Import committed."));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import commit failed.";
      markImportJobFailed(db, jobId, message);
      reply.code(500).type("text/html").send(adminPage(listImportJobs(db), message));
    }
  });

  app.get("/admin/imports", async (request, reply) => {
    if (!authorizeAdmin(request, reply, adminToken)) {
      return;
    }

    reply.type("text/html").send(importLogPage(listImportJobs(db)));
  });

  return app;
}

function parseBucket(value: string | undefined): FillerBucket | "All" {
  return value === "No" || value === "Mixed" || value === "Yes" ? value : "All";
}

function parseWatched(body: FormBody | { watched?: boolean }): boolean {
  if (typeof body.watched === "boolean") {
    return body.watched;
  }
  return body.watched === "true" || body.watched === "1" || body.watched === "on";
}

function parseBooleanValue(value: string | boolean | undefined): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "off") {
      return false;
    }
  }

  return null;
}

function toOptionalText(value: string | boolean | undefined): string | null {
  if (typeof value === "boolean" || value === undefined) {
    return null;
  }

  const text = value.trim();
  return text.length > 0 ? text : null;
}

function wantsJson(request: FastifyRequest): boolean {
  return String(request.headers.accept ?? "").includes("application/json");
}

function authorizeAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  adminToken: string | null,
): boolean {
  if (!adminToken) {
    reply.code(503).send({ error: "admin_token_not_configured" });
    return false;
  }

  const headerToken = request.headers["x-weebscreen-admin-token"];
  const provided = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  const cookieToken = (request as FastifyRequest & { cookies: Record<string, string | undefined> }).cookies
    .weebscreen_admin_token;
  const token = provided ?? cookieToken;

  if (token !== adminToken) {
    reply.code(403).send({ error: "forbidden" });
    return false;
  }

  return true;
}

type ImportUpload =
  | {
      ok: true;
      fields: Record<string, string | undefined>;
      filename: string;
      file: Buffer;
    }
  | {
      ok: false;
      message: string;
    };

type MultipartPart =
  | {
      type: "file";
      fieldname: string;
      filename: string;
      toBuffer: () => Promise<Buffer>;
    }
  | {
      type: "field";
      fieldname: string;
      value: unknown;
    };

async function readImportUpload(request: FastifyRequest): Promise<ImportUpload> {
  const fields: Record<string, string | undefined> = {};
  let file: Buffer | null = null;
  let filename = "";

  const parts = (request as FastifyRequest & { parts: () => AsyncIterable<MultipartPart> }).parts();
  for await (const part of parts) {
    if (part.type === "file") {
      if (part.fieldname !== "file") {
        continue;
      }
      filename = part.filename;
      file = await part.toBuffer();
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }

  if (!file || filename.length === 0) {
    return { ok: false, message: "Choose an XLSX or CSV file to import." };
  }

  if (!fields.show_title || !fields.show_slug) {
    return { ok: false, message: "Show title and show slug are required." };
  }

  if (filename.toLowerCase().endsWith(".xlsm")) {
    return { ok: false, message: "Macro-enabled .xlsm files are not accepted." };
  }

  return {
    ok: true,
    fields,
    filename,
    file,
  };
}

function parseUploadedImport(
  file: Buffer,
  filename: string,
  metadata: ShowMetadataInput,
): ImportPreview {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    return parseXlsxImport(file, metadata);
  }
  if (lower.endsWith(".csv")) {
    return parseCsvImport(file.toString("utf8"), metadata);
  }

  return emptyFailedPreview("Unsupported import file type. Use .xlsx or .csv.");
}

function emptyFailedPreview(message: string): ImportPreview {
  return {
    format: "csv",
    show: {
      title: "",
      slug: "",
      serviceName: null,
      notes: null,
      seasonBoundarySourceUrl: null,
    },
    episodes: [],
    counts: {
      total: 0,
      seasons: 0,
      fillerBuckets: {
        No: 0,
        Mixed: 0,
        Yes: 0,
      },
      canonFillerTypes: {},
    },
    issues: [{ level: "error", message }],
  };
}
