import type { EpisodeWithProgress, NextEpisodeResult, ShowDetail, ShowSummary } from "../domain/types.js";

export type ShowPageOptions = {
  bucket: string;
  unwatched: boolean;
};

export function libraryPage(shows: ShowSummary[]): string {
  const body =
    shows.length === 0
      ? `<section class="empty"><h1>No anime yet</h1><p>Import your first show in Settings/Admin.</p><a class="button" href="/admin">Admin</a></section>`
      : `<section class="library">${shows.map(showCard).join("")}</section>`;

  return layout("Weeb-Screen", body);
}

export function showPage(detail: ShowDetail, next: NextEpisodeResult, options: ShowPageOptions): string {
  const episodes = detail.preferences.seasonDetails
    ? renderSeasonGroups(detail.show.slug, detail.episodes)
    : `<section class="episode-list" data-view-mode="flat">${detail.episodes.map((episode) => episodeRow(detail.show.slug, episode, false)).join("")}</section>`;

  return layout(
    detail.show.title,
    `<main class="show-shell" data-show-slug="${escapeAttribute(detail.show.slug)}">
      <header class="show-header">
        <a href="/" class="back-link">Library</a>
        <h1>${escapeHtml(detail.show.title)}</h1>
        <p>${detail.summary.canonWatched} / ${detail.summary.canonTotal} canon watched &middot; ${detail.summary.allWatched} / ${detail.summary.allTotal} all watched</p>
      </header>
      ${nextCard(detail.show.slug, next, detail.preferences.seasonDetails)}
      ${controls(detail, options)}
      ${episodes}
    </main>`,
  );
}

export function notFoundPage(): string {
  return layout("Not Found", `<main class="empty"><h1>Not found</h1><a class="button" href="/">Back to library</a></main>`);
}

export function redirectPage(path: string): string {
  return `<!doctype html><meta http-equiv="refresh" content="0; url=${escapeAttribute(path)}"><a href="${escapeAttribute(path)}">Continue</a>`;
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${css()}</style>
</head>
<body>${body}</body>
<script>${clientScript()}</script>
</html>`;
}

function showCard(show: ShowSummary): string {
  const watched = show.progressMode === "all" ? show.allWatched : show.canonWatched;
  const total = show.progressMode === "all" ? show.allTotal : show.canonTotal;
  const percent = total === 0 ? 0 : Math.round((watched / total) * 100);

  return `<article class="show-card">
    <div>
      <h2><a href="/shows/${escapeAttribute(show.slug)}">${escapeHtml(show.title)}</a></h2>
      <p>${escapeHtml(show.serviceName ?? "Unknown service")}</p>
    </div>
    <div class="progress">
      <strong>${watched} / ${total}</strong>
      <span>${show.progressMode} watched</span>
      <div class="bar"><i style="width:${percent}%"></i></div>
    </div>
  </article>`;
}

function nextCard(slug: string, next: NextEpisodeResult, showCode: boolean): string {
  if (next.next) {
    return `<section class="next-card">
      <span class="${badgeClass(next.next.fillerBucket)}">${bucketLabel(next.next.fillerBucket)}</span>
      <div>
        <p>Play next</p>
        <h2>${showCode ? `<span class="service-code">${escapeHtml(next.next.serviceEpisodeCode)}</span> ` : ""}${escapeHtml(next.next.episodeTitle)}</h2>
      </div>
    </section>`;
  }

  const message =
    next.reason === "only-filler-remaining"
      ? `No more canon - ${next.fillerRemaining} filler episodes remain. Show them?`
      : next.reason === "all-canon-watched"
        ? "All canon watched"
        : "All caught up";

  return `<section class="next-card is-done"><h2>${escapeHtml(message)}</h2></section>`;
}

function controls(detail: ShowDetail, options: ShowPageOptions): string {
  const filterAction = `/shows/${escapeAttribute(detail.show.slug)}`;
  return `<section class="controls">
    <form method="get" action="${filterAction}" class="control-form" data-filter-form>
      <label>Filter
        <select name="bucket">
          ${selectOption("All", "All", options.bucket)}
          ${selectOption("No", "Canon", options.bucket)}
          ${selectOption("Mixed", "Mixed", options.bucket)}
          ${selectOption("Yes", "Filler", options.bucket)}
        </select>
      </label>
      <label class="check"><input type="checkbox" name="unwatched" value="1"${options.unwatched ? " checked" : ""}> Unwatched</label>
      <button type="submit" class="apply-button">Apply</button>
    </form>
    <form method="post" action="/shows/${escapeAttribute(detail.show.slug)}/preferences" class="toggle-row" data-preference-form>
      <input type="hidden" name="skip_filler" value="${detail.preferences.skipFiller ? "false" : "true"}">
      <button type="submit" aria-pressed="${detail.preferences.skipFiller ? "true" : "false"}">${detail.preferences.skipFiller ? "Filler hidden" : "Hide filler"}</button>
    </form>
    <form method="post" action="/shows/${escapeAttribute(detail.show.slug)}/preferences" class="toggle-row" data-preference-form>
      <input type="hidden" name="season_details" value="${detail.preferences.seasonDetails ? "false" : "true"}">
      <button type="submit">Season details ${detail.preferences.seasonDetails ? "on" : "off"}</button>
    </form>
  </section>`;
}

function selectOption(value: string, label: string, selected: string): string {
  return `<option value="${escapeAttribute(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function renderSeasonGroups(showSlug: string, episodes: EpisodeWithProgress[]): string {
  const groups = new Map<number, EpisodeWithProgress[]>();
  for (const episode of episodes) {
    groups.set(episode.serviceSeasonNumber, [...(groups.get(episode.serviceSeasonNumber) ?? []), episode]);
  }

  return `<section class="episode-list season-mode" data-view-mode="season">${[...groups.entries()]
    .map(([season, seasonEpisodes]) => {
      const watched = seasonEpisodes.filter((episode) => episode.watched).length;
      return `<details class="season" open>
        <summary>Season ${season} <span>${watched} / ${seasonEpisodes.length} watched</span></summary>
        ${seasonEpisodes.map((episode) => episodeRow(showSlug, episode, true)).join("")}
      </details>`;
    })
    .join("")}</section>`;
}

function episodeRow(showSlug: string, episode: EpisodeWithProgress, showCode: boolean): string {
  return `<article class="episode-row${episode.watched ? " is-watched" : ""}" data-real="${episode.realEpisodeNumber}">
    <span class="${badgeClass(episode.fillerBucket)}">${bucketLabel(episode.fillerBucket)}</span>
    <div class="episode-main">
      <h3>${showCode ? `<span class="service-code">${escapeHtml(episode.serviceEpisodeCode)}</span> ` : ""}${escapeHtml(episode.episodeTitle)}</h3>
      <p>Episode ${episode.realEpisodeNumber}${episode.originalAirdate ? ` &middot; ${escapeHtml(episode.originalAirdate)}` : ""}</p>
    </div>
    <form method="post" action="/shows/${escapeAttribute(showSlug)}/episodes/${episode.realEpisodeNumber}/watched" data-watch-form>
      <input type="hidden" name="watched" value="${episode.watched ? "false" : "true"}">
      <button type="submit">${episode.watched ? "Watched" : "Mark watched"}</button>
    </form>
  </article>`;
}

function badgeClass(bucket: string): string {
  return `badge badge-${bucket.toLowerCase()}`;
}

function bucketLabel(bucket: string): string {
  if (bucket === "No") {
    return "Canon";
  }
  if (bucket === "Yes") {
    return "Filler";
  }
  return "Mixed";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function css(): string {
  return `
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f4; color: #1d211f; }
* { box-sizing: border-box; }
body { margin: 0; }
a { color: inherit; }
button, select { font: inherit; }
.library, .show-shell { width: min(1040px, calc(100% - 24px)); margin: 0 auto; padding: 24px 0; }
.show-card, .next-card, .controls, .episode-row, .season { background: #fff; border: 1px solid #d9ddd6; border-radius: 8px; }
.show-card { display: flex; justify-content: space-between; gap: 16px; padding: 16px; margin-bottom: 12px; align-items: center; }
.show-card h2, .show-header h1, .next-card h2, .episode-row h3 { margin: 0; letter-spacing: 0; }
.show-card p, .show-header p, .next-card p, .episode-row p { color: #596159; margin: 4px 0 0; }
.progress { min-width: 170px; }
.progress span { display: block; color: #596159; font-size: 0.9rem; }
.bar { height: 8px; background: #e4e8e2; border-radius: 999px; margin-top: 8px; overflow: hidden; }
.bar i { display: block; height: 100%; background: #25745b; }
.back-link { color: #596159; display: inline-block; margin-bottom: 8px; }
.show-header { padding: 20px 0 16px; }
.next-card { display: flex; gap: 14px; align-items: center; padding: 16px; margin-bottom: 12px; }
.next-card.is-done { display: block; }
.controls { display: flex; gap: 10px; flex-wrap: wrap; padding: 12px; margin-bottom: 12px; align-items: center; }
.control-form { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.check { display: inline-flex; gap: 6px; align-items: center; }
.toggle-row { margin: 0; }
.apply-button { display: none; }
button, select, .button { border: 1px solid #aeb7af; background: #f8faf7; border-radius: 6px; padding: 8px 10px; text-decoration: none; }
.episode-list { display: grid; gap: 8px; }
.episode-row { display: grid; grid-template-columns: 82px 1fr auto; align-items: center; gap: 12px; padding: 12px; }
.episode-main { min-width: 0; }
.episode-main h3 { font-size: 1rem; overflow-wrap: anywhere; }
.badge { display: inline-flex; justify-content: center; border-radius: 999px; padding: 5px 9px; font-size: 0.82rem; font-weight: 750; }
.badge-no { background: #e3f5ec; color: #0d5d43; }
.badge-mixed { background: #fff0cc; color: #77520a; }
.badge-yes { background: #f8dddd; color: #8a2424; }
.service-code { color: #596159; font-size: 0.9em; font-weight: 650; }
.is-watched { opacity: 0.62; }
.season { padding: 8px; }
.season summary { cursor: pointer; font-weight: 750; padding: 6px 4px 12px; }
.season summary span { color: #596159; font-weight: 500; margin-left: 8px; }
.empty { width: min(640px, calc(100% - 24px)); margin: 15vh auto; text-align: center; }
@media (max-width: 680px) {
  .show-card, .next-card, .episode-row { grid-template-columns: 1fr; display: grid; }
  .progress { min-width: 0; width: 100%; }
  .badge { justify-self: start; }
  .controls, .control-form { display: grid; width: 100%; }
  button, select { width: 100%; }
}
`;
}

function clientScript(): string {
  return `
(() => {
  const shellSelector = ".show-shell";

  function currentShell() {
    return document.querySelector(shellSelector);
  }

  async function refreshShow(url = window.location.href, push = false) {
    const shell = currentShell();
    if (!shell) return;

    const response = await fetch(url, { headers: { "X-Requested-With": "fetch" } });
    if (!response.ok) throw new Error("Refresh failed");

    const text = await response.text();
    const doc = new DOMParser().parseFromString(text, "text/html");
    const nextShell = doc.querySelector(shellSelector);
    if (!nextShell) throw new Error("Show content missing");

    shell.replaceWith(nextShell);
    if (push) window.history.pushState({}, "", url);
    bindShowControls();
  }

  function filterUrl(form) {
    const url = new URL(form.action, window.location.origin);
    const data = new FormData(form);
    const bucket = String(data.get("bucket") || "All");
    if (bucket !== "All") url.searchParams.set("bucket", bucket);
    if (data.get("unwatched") === "1") url.searchParams.set("unwatched", "1");
    return url;
  }

  function bindShowControls() {
    document.querySelectorAll("[data-watch-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await fetch(form.action, {
          method: "POST",
          body: new URLSearchParams(new FormData(form)),
          headers: { Accept: "application/json" },
        });
        await refreshShow();
      });
    });

    document.querySelectorAll("[data-preference-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await fetch(form.action, {
          method: "POST",
          body: new URLSearchParams(new FormData(form)),
          headers: { Accept: "application/json" },
        });
        await refreshShow();
      });
    });

    document.querySelectorAll("[data-filter-form]").forEach((form) => {
      const applyFilter = async () => refreshShow(filterUrl(form).toString(), true);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void applyFilter();
      });
      form.querySelectorAll("select, input").forEach((input) => {
        input.addEventListener("change", () => void applyFilter());
      });
    });
  }

  if (!window.__weebScreenBound) {
    window.__weebScreenBound = true;
    window.addEventListener("popstate", () => void refreshShow(window.location.href));
  }

  bindShowControls();
})();
`;
}
