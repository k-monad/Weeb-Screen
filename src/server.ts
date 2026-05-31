import formBody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";

import type { FillerBucket } from "./domain/types.js";
import {
  getNextEpisode,
  getShowDetail,
  listShows,
  setEpisodeWatched,
  setSeasonWatched,
  setShowPreference,
  setWatchedUpTo,
} from "./db/repositories.js";
import type { WeebScreenDatabase } from "./db/database.js";
import { libraryPage, notFoundPage, redirectPage, showPage } from "./views/html.js";

type FormBody = Record<string, string | undefined>;

export async function buildServer(db: WeebScreenDatabase): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(formBody);

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

    reply.type("text/html").send(redirectPage(`/shows/${params.slug}`));
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

