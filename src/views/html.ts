import type { EpisodeWithProgress, NextEpisodeResult, ShowDetail, ShowSummary } from "../domain/types.js";

export type ShowPageOptions = {
  bucket: string;
  unwatched: boolean;
};

export function libraryPage(shows: ShowSummary[]): string {
  const body =
    shows.length === 0
      ? `<section class="empty"><h1>No anime yet</h1><p>Import your first show in Settings/Admin.</p><a class="btn btn--primary" href="/admin">Admin</a></section>`
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
  return layout("Not Found", `<main class="empty"><h1>Not found</h1><a class="btn btn--primary" href="/">Back to library</a></main>`);
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
  return `<article class="ep${episode.watched ? " is-watched" : ""}" data-real="${episode.realEpisodeNumber}">
    <span class="${badgeClass(episode.fillerBucket)}">${bucketLabel(episode.fillerBucket)}</span>
    <div class="ep__main">
      <h3>${showCode ? `<span class="service-code">${escapeHtml(episode.serviceEpisodeCode)}</span> ` : ""}${escapeHtml(episode.episodeTitle)}</h3>
      <p class="ep__meta">Episode ${episode.realEpisodeNumber}${episode.originalAirdate ? ` &middot; ${escapeHtml(episode.originalAirdate)}` : ""}</p>
    </div>
    <div class="ep__actions">
      ${episode.watched ? '<span class="watched-flag">&#10003; Watched</span>' : ""}
      <form method="post" action="/shows/${escapeAttribute(showSlug)}/episodes/${episode.realEpisodeNumber}/watched" data-watch-form>
        <input type="hidden" name="watched" value="${episode.watched ? "false" : "true"}">
        <button type="submit" class="btn ${episode.watched ? "btn--quiet" : "btn--primary"} btn--sm">${episode.watched ? "Undo" : "Mark watched"}</button>
      </form>
    </div>
  </article>`;
}

function badgeClass(bucket: string): string {
  if (bucket === "No") return "badge badge--canon";
  if (bucket === "Yes") return "badge badge--filler";
  return "badge badge--mixed";
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
:root {
  color-scheme: light;
  --bg:#f7f7f4;
  --surface:#ffffff;
  --surface-sunk:#f1f3ee;
  --watched-tint:#f2f5f1;
  --text:#1d211f;
  --text-muted:#596159;
  --border:#d9ddd6;
  --border-strong:#aeb7af;
  --primary:#25745b;
  --primary-hover:#1d5a47;
  --primary-soft:#e3f5ec;
  --primary-text:#ffffff;
  --focus:#0b5cab;
  --badge-canon-bg:#e3f5ec;
  --badge-canon-fg:#0d5d43;
  --badge-mixed-bg:#fff0cc;
  --badge-mixed-fg:#77520a;
  --badge-filler-bg:#f8dddd;
  --badge-filler-fg:#8a2424;
  --track:#e4e8e2;
  --space-1:4px;
  --space-2:8px;
  --space-3:12px;
  --space-4:16px;
  --space-5:24px;
  --space-6:32px;
  --radius-sm:6px;
  --radius-md:8px;
  --radius-lg:12px;
  --radius-pill:999px;
  --font-sans:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --text-xs:0.82rem;
  --text-sm:0.9rem;
  --text-base:1rem;
  --text-lg:1.15rem;
  --text-h1:1.6rem;
  --control-min:44px;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-sans); }
a { color: inherit; }
button, select, input { font: inherit; }

.library, .show-shell { width: min(1040px, calc(100% - 24px)); margin: 0 auto; padding: 24px 0; }
.show-card, .next-card, .controls, .season, .ep { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); }
.show-card { display: flex; justify-content: space-between; gap: var(--space-4); padding: var(--space-4); margin-bottom: var(--space-3); align-items: center; }
.show-card h2, .show-header h1, .next-card h2, .ep__main h3 { margin: 0; letter-spacing: 0; }
.show-card p, .show-header p, .next-card p, .ep__meta { color: var(--text-muted); margin: 4px 0 0; }
.progress { min-width: 170px; }
.progress span { display: block; color: var(--text-muted); font-size: var(--text-sm); }
.bar { height: 8px; background: var(--track); border-radius: var(--radius-pill); margin-top: var(--space-2); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--primary); }
.back-link { color: var(--text-muted); display: inline-block; margin-bottom: var(--space-2); text-decoration: none; }
.back-link:hover { text-decoration: underline; }
.show-header { padding: 20px 0 16px; }

:where(a, button, select, input, summary, [role="radio"]):focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

.btn, .button {
  min-height: var(--control-min);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  line-height: 1;
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
}
.btn:hover, .button:hover { background: var(--surface-sunk); }
.btn--primary { background: var(--primary); border-color: var(--primary); color: var(--primary-text); font-weight: 600; }
.btn--primary:hover { background: var(--primary-hover); }
.btn--quiet { background: transparent; border-color: transparent; color: var(--text-muted); }
.btn--quiet:hover { background: var(--surface-sunk); color: var(--text); }
.btn--sm { min-height: var(--control-min); padding: 0 10px; font-size: var(--text-sm); }

.next-card { display: flex; gap: 14px; align-items: center; padding: 16px; margin-bottom: 12px; }
.next-card.is-done { display: block; }

.controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  padding: 12px;
  margin-bottom: 14px;
}
.control-form { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.check { min-height: var(--control-min); display: inline-flex; gap: 8px; align-items: center; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); background: var(--surface); }
.toggle-row { margin: 0; }
.toggle-row button, .control-form select, .apply-button { min-height: var(--control-min); padding: 0 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }

.episode-list { display: grid; gap: 8px; }
.ep {
  position: relative;
  display: grid;
  grid-template-columns: 84px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 12px;
}
.ep__main { min-width: 0; }
.ep__main h3 { font-size: var(--text-base); overflow-wrap: anywhere; }
.ep__meta { font-size: var(--text-sm); }
.ep__actions { display: flex; gap: var(--space-2); align-items: center; justify-content: flex-end; }

.badge {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  border-radius: var(--radius-pill);
  padding: 5px 9px;
  font-size: var(--text-xs);
  font-weight: 750;
  justify-self: start;
}
.badge--canon { background: var(--badge-canon-bg); color: var(--badge-canon-fg); }
.badge--mixed { background: var(--badge-mixed-bg); color: var(--badge-mixed-fg); }
.badge--filler { background: var(--badge-filler-bg); color: var(--badge-filler-fg); }
.service-code { color: var(--text-muted); font-size: 0.9em; font-weight: 650; }

.ep.is-watched { background: var(--watched-tint); box-shadow: inset 3px 0 0 var(--primary); }
.ep.is-watched .ep__main h3 { color: var(--text-muted); }
.watched-flag { display: inline-flex; align-items: center; gap: 6px; color: var(--badge-canon-fg); font-weight: 700; font-size: var(--text-sm); }

.season { padding: 8px; }
.season summary { cursor: pointer; font-weight: 750; padding: 6px 4px 12px; }
.season summary span { color: var(--text-muted); font-weight: 500; margin-left: 8px; }
.empty { width: min(640px, calc(100% - 24px)); margin: 15vh auto; text-align: center; }

@media (max-width: 680px) {
  .show-card, .next-card, .ep { grid-template-columns: 1fr; display: grid; }
  .progress { min-width: 0; width: 100%; }
  .controls, .control-form { display: grid; width: 100%; }
  .toggle-row, .toggle-row button, .control-form select, .apply-button { width: 100%; }
  .ep__actions { justify-content: stretch; }
  .ep__actions .btn { flex: 1; }
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
