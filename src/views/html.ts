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
  const nextRealEpisodeNumber = next.next?.realEpisodeNumber ?? null;
  const lastRealNum = Math.max(detail.show.totalRealEpisodes ?? 0, ...detail.episodes.map((episode) => episode.realEpisodeNumber), 1);
  const { canonWatched, canonTotal, allWatched, allTotal } = detail.summary;
  const canonPercent = canonTotal === 0 ? 0 : Math.round((canonWatched / canonTotal) * 100);
  const allPercent = allTotal === 0 ? 0 : Math.round((allWatched / allTotal) * 100);
  const episodes = detail.preferences.seasonDetails
    ? renderSeasonGroups(detail.show.slug, detail.episodes, nextRealEpisodeNumber)
    : `<section class="episode-list" data-view-mode="flat">${
        detail.episodes.length === 0
          ? `<p class="empty-state">No episodes match this filter.</p>`
          : detail.episodes.map((episode) => episodeRow(detail.show.slug, episode, false, episode.realEpisodeNumber === nextRealEpisodeNumber)).join("")
      }</section>`;

  return layout(
    detail.show.title,
    `<main class="show-shell" data-show-slug="${escapeAttribute(detail.show.slug)}">
      <div class="sr-only" aria-live="polite" data-live-region></div>
      <header class="show-header">
        <a href="/" class="back-link">Library</a>
        <div class="show-header__top">
          <h1>${escapeHtml(detail.show.title)}</h1>
          <div class="bulk">
            <form method="post" action="/shows/${escapeAttribute(detail.show.slug)}/watched/up-to/${lastRealNum}" data-watch-form data-confirm="Mark all ${lastRealNum} episodes watched?" data-live-success="Marked all episodes watched." data-undo-action="/shows/${escapeAttribute(detail.show.slug)}/watched/up-to/1" data-undo-watched="false" data-undo-label="Marked all episodes unwatched.">
              <input type="hidden" name="watched" value="true">
              <button type="submit" class="btn btn--secondary">Mark all watched</button>
            </form>
            <form method="post" action="/shows/${escapeAttribute(detail.show.slug)}/watched/up-to/1" data-watch-form data-confirm="Unwatch all episodes?" data-live-success="Marked all episodes unwatched." data-undo-action="/shows/${escapeAttribute(detail.show.slug)}/watched/up-to/${lastRealNum}" data-undo-watched="true" data-undo-label="Marked all episodes watched.">
              <input type="hidden" name="watched" value="false">
              <button type="submit" class="btn btn--secondary">Unwatch all</button>
            </form>
          </div>
        </div>
        <div class="metrics">
          <div class="metric">
            <div class="metric__label">
              <span class="metric__term" title="Filler-free episodes - the canonical story." tabindex="0">Canon</span>
              <strong>${canonWatched} / ${canonTotal}</strong>
            </div>
            <div class="bar" role="img" aria-label="Canon: ${canonWatched} of ${canonTotal} watched">
              <i style="width:${canonPercent}%"></i>
            </div>
          </div>
          <div class="metric">
            <div class="metric__label">
              <span>All</span>
              <strong>${allWatched} / ${allTotal}</strong>
            </div>
            <div class="bar" role="img" aria-label="All: ${allWatched} of ${allTotal} watched">
              <i style="width:${allPercent}%"></i>
            </div>
          </div>
          <p class="sr-only">Canon counts only filler-free episodes; All counts every episode.</p>
        </div>
      </header>
      ${nextCard(detail.show.slug, next, detail.preferences.seasonDetails)}
      ${controls(detail, options)}
      ${episodes}
    </main>
    <div class="toast" data-toast hidden aria-hidden="true">
      <span class="toast__msg" data-toast-msg></span>
      <button type="button" class="btn btn--quiet btn--sm toast__undo" data-toast-undo hidden>Undo</button>
    </div>`,
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
    const nextLabel = `${showCode ? `${next.next.serviceEpisodeCode} ` : ""}${next.next.episodeTitle}`.trim();
    return `<section class="next-card">
      <span class="${badgeClass(next.next.fillerBucket)}">${bucketLabel(next.next.fillerBucket)}</span>
      <div class="next-card__body">
        <p class="eyebrow">Play next</p>
        <h2>${showCode ? `<span class="service-code">${escapeHtml(next.next.serviceEpisodeCode)}</span> ` : ""}${escapeHtml(next.next.episodeTitle)}</h2>
      </div>
      <div class="next-card__actions">
        <form method="post" action="/shows/${escapeAttribute(slug)}/episodes/${next.next.realEpisodeNumber}/watched" data-watch-form data-live-success="Marked ${escapeAttribute(nextLabel)} watched.">
          <input type="hidden" name="watched" value="true">
          <button type="submit" class="btn btn--primary">&#10003; Mark watched</button>
        </form>
        <a class="btn btn--quiet" href="#ep-${next.next.realEpisodeNumber}">Jump to list</a>
      </div>
    </section>`;
  }

  const message = next.reason === "only-filler-remaining"
    ? `No more canon - ${next.fillerRemaining} filler episodes remain. <a href="/shows/${escapeAttribute(slug)}?bucket=Yes">Show them?</a>`
    : next.reason === "all-canon-watched"
      ? "All canon watched"
      : "All caught up";

  return `<section class="next-card is-done"><h2>${message}</h2></section>`;
}

function controls(detail: ShowDetail, options: ShowPageOptions): string {
  const filterAction = `/shows/${escapeAttribute(detail.show.slug)}`;
  return `<section class="controls">
    <form method="get" action="${filterAction}" class="control-form" data-filter-form>
      <fieldset class="filter-group">
        <legend class="controls__label">Filter</legend>
        <div class="seg" role="radiogroup" aria-label="Filter by filler bucket">
          ${segmentOption("All", "All", options.bucket)}
          ${segmentOption("No", "Canon", options.bucket)}
          ${segmentOption("Mixed", "Mixed", options.bucket)}
          ${segmentOption("Yes", "Filler", options.bucket)}
        </div>
      </fieldset>
      <label class="chip" aria-pressed="${options.unwatched ? "true" : "false"}">
        <input type="checkbox" name="unwatched" value="1"${options.unwatched ? " checked" : ""}>
        Unwatched only
      </label>
      <button type="submit" class="btn btn--primary apply-button">Apply</button>
    </form>
    <div class="controls__spacer"></div>
    <form method="post" action="/shows/${escapeAttribute(detail.show.slug)}/preferences" data-preference-form data-live-success="${detail.preferences.skipFiller ? "Filler shown." : "Filler hidden."}">
      <input type="hidden" name="skip_filler" value="${detail.preferences.skipFiller ? "false" : "true"}">
      <button type="submit" class="switch" aria-pressed="${detail.preferences.skipFiller ? "true" : "false"}">
        <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span> Hide filler
      </button>
    </form>
    <form method="post" action="/shows/${escapeAttribute(detail.show.slug)}/preferences" data-preference-form data-live-success="${detail.preferences.seasonDetails ? "Season details off." : "Season details on."}">
      <input type="hidden" name="season_details" value="${detail.preferences.seasonDetails ? "false" : "true"}">
      <button type="submit" class="switch" aria-pressed="${detail.preferences.seasonDetails ? "true" : "false"}">
        <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span> Season details
      </button>
    </form>
  </section>`;
}

function segmentOption(value: string, label: string, selected: string): string {
  return `<label class="seg__item">
    <input type="radio" name="bucket" value="${escapeAttribute(value)}"${value === selected ? " checked" : ""}>
    <span class="seg__btn">${escapeHtml(label)}</span>
  </label>`;
}

function renderSeasonGroups(showSlug: string, episodes: EpisodeWithProgress[], nextRealEpisodeNumber: number | null): string {
  if (episodes.length === 0) {
    return '<section class="episode-list season-mode" data-view-mode="season"><p class="empty-state">No episodes match this filter.</p></section>';
  }

  const groups = new Map<number, EpisodeWithProgress[]>();
  for (const episode of episodes) {
    groups.set(episode.serviceSeasonNumber, [...(groups.get(episode.serviceSeasonNumber) ?? []), episode]);
  }

  const nextSeasonNumber = nextRealEpisodeNumber === null
    ? null
    : episodes.find((episode) => episode.realEpisodeNumber === nextRealEpisodeNumber)?.serviceSeasonNumber ?? null;

  return `<section class="episode-list season-mode" data-view-mode="season">${[...groups.entries()]
    .map(([season, seasonEpisodes]) => {
      const watched = seasonEpisodes.filter((episode) => episode.watched).length;
      const seasonConfirm = seasonEpisodes.length > 5 ? ` data-confirm="Mark all ${seasonEpisodes.length} episodes in Season ${season} watched?"` : "";
      return `<details class="season"${season === nextSeasonNumber ? " open" : ""}>
        <summary>
          <span class="caret" aria-hidden="true">&#9656;</span>
          Season ${season}
          <span class="season__progress">${watched} / ${seasonEpisodes.length} watched</span>
          <span class="season__bulk">
            <form method="post" action="/shows/${escapeAttribute(showSlug)}/seasons/${season}/watched" data-watch-form data-live-success="Marked season ${season} watched." data-undo-action="/shows/${escapeAttribute(showSlug)}/seasons/${season}/watched" data-undo-watched="false" data-undo-label="Season ${season} reverted."${seasonConfirm}>
              <input type="hidden" name="watched" value="true">
              <button type="submit" class="btn btn--secondary btn--sm">Mark season watched</button>
            </form>
          </span>
        </summary>
        ${seasonEpisodes.map((episode) => episodeRow(showSlug, episode, true, episode.realEpisodeNumber === nextRealEpisodeNumber)).join("")}
      </details>`;
    })
    .join("")}</section>`;
}

function episodeRow(showSlug: string, episode: EpisodeWithProgress, showCode: boolean, isNext = false): string {
  const episodeLabel = `${showCode ? `${episode.serviceEpisodeCode} ` : ""}${episode.episodeTitle}`.trim();
  const upToConfirm = episode.realEpisodeNumber > 5
    ? ` data-confirm="Mark all ${episode.realEpisodeNumber} episodes up to here watched?"`
    : "";
  return `<article class="ep${episode.watched ? " is-watched" : ""}${isNext ? " is-next" : ""}" id="ep-${episode.realEpisodeNumber}" data-real="${episode.realEpisodeNumber}">
    <span class="${badgeClass(episode.fillerBucket)}">${bucketLabel(episode.fillerBucket)}</span>
    <div class="ep__main">
      <h3>${showCode ? `<span class="service-code">${escapeHtml(episode.serviceEpisodeCode)}</span> ` : ""}${escapeHtml(episode.episodeTitle)}${isNext ? ' <span class="up-next-tag">Up next</span>' : ""}</h3>
      <p class="ep__meta">Episode ${episode.realEpisodeNumber}${episode.originalAirdate ? ` &middot; ${escapeHtml(episode.originalAirdate)}` : ""}</p>
    </div>
    <div class="ep__actions">
      ${
        episode.watched
          ? `<span class="watched-flag">&#10003; Watched</span>
      <form method="post" action="/shows/${escapeAttribute(showSlug)}/episodes/${episode.realEpisodeNumber}/watched" data-watch-form data-live-success="Marked ${escapeAttribute(episodeLabel)} unwatched.">
        <input type="hidden" name="watched" value="false">
        <button type="submit" class="btn btn--quiet btn--sm">Undo</button>
      </form>`
          : `<form method="post" action="/shows/${escapeAttribute(showSlug)}/episodes/${episode.realEpisodeNumber}/watched" data-watch-form data-live-success="Marked ${escapeAttribute(episodeLabel)} watched.">
        <input type="hidden" name="watched" value="true">
        <button type="submit" class="btn btn--primary btn--sm">Mark watched</button>
      </form>
      <form method="post" action="/shows/${escapeAttribute(showSlug)}/watched/up-to/${episode.realEpisodeNumber}" data-watch-form data-live-success="Marked episodes up to ${episode.realEpisodeNumber} watched."${upToConfirm}>
        <input type="hidden" name="watched" value="true">
        <button type="submit" class="btn btn--quiet btn--sm">Mark up to here</button>
      </form>`
      }
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
  --shadow-2:0 8px 24px rgba(20,50,35,.14);
  --z-toast:50;
  --danger-fg:#8a2424;
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
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.progress { min-width: 170px; }
.progress span { display: block; color: var(--text-muted); font-size: var(--text-sm); }
.bar { height: 8px; background: var(--track); border-radius: var(--radius-pill); margin-top: var(--space-2); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--primary); }
.back-link { color: var(--text-muted); display: inline-block; margin-bottom: var(--space-2); text-decoration: none; }
.back-link:hover { text-decoration: underline; }
.show-header { padding: 20px 0 16px; }
.show-header__top { display: flex; gap: var(--space-4); align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
.bulk { display: flex; gap: var(--space-1); }
.metrics { margin-top: var(--space-2); display: grid; gap: var(--space-2); }
.metric { display: grid; gap: 6px; }
.metric__label { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); color: var(--text-muted); font-size: var(--text-sm); }
.metric__label strong { color: var(--text); font-size: var(--text-base); }
.metric .bar { margin-top: 0; }
.metric__term { text-decoration: underline dotted; text-underline-offset: 2px; cursor: help; }

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
.btn--secondary { background: var(--surface); border-color: var(--border-strong); color: var(--text); }
.btn--secondary:hover { background: var(--surface-sunk); }
.btn--quiet { background: transparent; border-color: transparent; color: var(--text-muted); }
.btn--quiet:hover { background: var(--surface-sunk); color: var(--text); }
.btn--sm { min-height: var(--control-min); padding: 0 10px; font-size: var(--text-sm); }

.next-card {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 16px;
  border-left: 4px solid var(--primary);
  margin-bottom: 12px;
}
.next-card .eyebrow { margin: 0; color: var(--text-muted); font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.06em; }
.next-card h2 { margin: 2px 0 0; font-size: var(--text-lg); }
.next-card__body { flex: 1; min-width: 0; }
.next-card__actions { display: flex; gap: var(--space-2); align-items: center; }
.next-card.is-done { justify-content: center; text-align: center; border-left-color: var(--border); }

.controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  padding: 12px;
  margin-bottom: 14px;
}
.control-form { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; flex: 1; }
.filter-group { margin: 0; padding: 0; border: 0; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.controls__label { color: var(--text-muted); font-size: var(--text-sm); padding: 0; margin: 0; }
.controls__spacer { flex: 1; }
.apply-button { min-height: var(--control-min); }
.js .apply-button { display: none; }

.seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-md); overflow: hidden; }
.seg__item { position: relative; display: inline-flex; }
.seg__item input { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
.seg__btn {
  min-height: var(--control-min);
  padding: 0 14px;
  border-right: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.seg__item:last-child .seg__btn { border-right: 0; }
.seg__item input:checked + .seg__btn { background: var(--primary); color: var(--primary-text); font-weight: 600; }

.chip {
  min-height: var(--control-min);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.chip input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.chip[aria-pressed="true"], .chip:has(input:checked) { background: var(--primary-soft); border-color: var(--primary); color: var(--badge-canon-fg); font-weight: 600; }

.switch {
  min-height: var(--control-min);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.switch__track { width: 34px; height: 20px; border-radius: 999px; background: #c7cfc6; position: relative; flex: none; }
.switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
.switch[aria-pressed="true"] { border-color: var(--primary); background: var(--primary-soft); }
.switch[aria-pressed="true"] .switch__track { background: var(--primary); }
.switch[aria-pressed="true"] .switch__thumb { left: 16px; }

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
.ep.is-next { box-shadow: inset 3px 0 0 var(--primary), 0 0 0 1px var(--primary); }
.ep.is-next .up-next-tag {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--primary);
  color: #fff;
  font-size: var(--text-xs);
  font-weight: 700;
  vertical-align: middle;
}

.season { padding: 8px; margin-bottom: 8px; }
.season > summary {
  cursor: pointer;
  font-weight: 750;
  padding: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  list-style: none;
}
.season > summary::-webkit-details-marker { display: none; }
.season[open] > summary .caret { transform: rotate(90deg); }
.season__progress { color: var(--text-muted); font-weight: 500; }
.season__bulk { margin-left: auto; display: flex; gap: var(--space-1); }
.season .ep { margin-top: 8px; }
.empty-state { margin: 0; padding: var(--space-4); color: var(--text-muted); background: var(--surface); border: 1px dashed var(--border-strong); border-radius: var(--radius-md); }
.empty { width: min(640px, calc(100% - 24px)); margin: 15vh auto; text-align: center; }
.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translate(-50%, 12px);
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  max-width: min(560px, calc(100% - 32px));
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2);
  z-index: var(--z-toast);
  opacity: 0;
  pointer-events: none;
}
.toast.is-visible {
  opacity: 1;
  transform: translate(-50%, 0);
  pointer-events: auto;
}
.toast__msg {
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}
.toast__undo {
  min-height: 32px;
  color: var(--text);
}

@media (prefers-reduced-motion: no-preference) {
  .btn { transition: background 0.12s ease; }
  .switch__track, .switch__thumb { transition: all 0.15s ease; }
  .season > summary .caret { transition: transform 0.15s ease; }
  .toast { transition: opacity 0.18s ease, transform 0.18s ease; }
}

@media (max-width: 680px) {
  .show-card, .next-card, .ep { grid-template-columns: 1fr; display: grid; }
  .progress { min-width: 0; width: 100%; }
  .bulk { width: 100%; flex-wrap: wrap; }
  .bulk form { flex: 1; min-width: 200px; }
  .controls { gap: 8px; }
  .control-form { display: grid; width: 100%; }
  .filter-group { display: grid; width: 100%; }
  .seg, .seg__item, .seg__btn, .switch, .chip, .apply-button { width: 100%; }
  .seg { flex-wrap: wrap; }
  .controls__spacer { display: none; }
  .show-header__top { align-items: flex-start; }
  .ep__actions { justify-content: stretch; }
  .ep__actions .btn { flex: 1; }
  .next-card { flex-wrap: wrap; }
  .next-card__actions { width: 100%; }
  .next-card__actions .btn { flex: 1; }
  .toast { left: 16px; right: 16px; bottom: 16px; transform: translateY(12px); max-width: none; }
  .toast.is-visible { transform: translateY(0); }
}
`;
}

function clientScript(): string {
  return `
(() => {
  document.body.classList.add("js");
  const shellSelector = ".show-shell";
  const liveRegionSelector = "[data-live-region]";
  const saveFailureMessage = "Couldn't save - try again.";
  const filterFailureMessage = "Couldn't apply filter - try again.";
  let toastTimer;
  let toastHideTimer;

  function currentShell() {
    return document.querySelector(shellSelector);
  }

  function announce(message) {
    if (!message) return;
    const liveRegion = document.querySelector(liveRegionSelector);
    if (!liveRegion) return;
    liveRegion.textContent = "";
    liveRegion.textContent = message;
  }

  function hideToast() {
    const toast = document.querySelector("[data-toast]");
    if (!toast) return;
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    toast.classList.remove("is-visible");
    toastHideTimer = setTimeout(() => {
      if (!toast.classList.contains("is-visible")) toast.hidden = true;
    }, 220);
  }

  function showToast(message, undo) {
    const toast = document.querySelector("[data-toast]");
    if (!toast || !message) return;
    const messageNode = toast.querySelector("[data-toast-msg]");
    const undoButton = toast.querySelector("[data-toast-undo]");
    if (!(messageNode instanceof HTMLElement) || !(undoButton instanceof HTMLButtonElement)) return;

    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    messageNode.textContent = message;

    if (undo) {
      undoButton.hidden = false;
      undoButton.onclick = async () => {
        hideToast();
        try {
          const response = await fetch(undo.action, {
            method: "POST",
            body: new URLSearchParams({ watched: undo.watched }),
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error("Undo failed");
          const undoMessage = undo.label || "Undone.";
          await refreshShow(window.location.href, false, undoMessage);
          showToast(undoMessage);
        } catch {
          announce(saveFailureMessage);
        }
      };
    } else {
      undoButton.hidden = true;
      undoButton.onclick = null;
    }

    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    toastTimer = setTimeout(hideToast, undo ? 8000 : 4000);
  }

  function successMessage(form, fallback, submitEvent) {
    const submitter = submitEvent && submitEvent.submitter instanceof HTMLElement ? submitEvent.submitter : null;
    return (
      (submitter ? submitter.getAttribute("data-live-success") : null) ||
      form.getAttribute("data-live-success") ||
      fallback
    );
  }

  function filterAnnouncement(form) {
    const data = new FormData(form);
    const bucket = String(data.get("bucket") || "All");
    const label =
      bucket === "No"
        ? "Canon"
        : bucket === "Mixed"
          ? "Mixed"
          : bucket === "Yes"
            ? "Filler"
            : "All";
    const unwatched = data.get("unwatched") === "1";
    return unwatched ? "Filter updated: " + label + ", unwatched only." : "Filter updated: " + label + ".";
  }

  async function refreshShow(url = window.location.href, push = false, message = "") {
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
    announce(message);
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
        const confirmText = form.getAttribute("data-confirm");
        if (confirmText && !window.confirm(confirmText)) {
          return;
        }
        try {
          const response = await fetch(form.action, {
            method: "POST",
            body: new URLSearchParams(new FormData(form)),
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error("Save failed");
          const message = successMessage(form, "Saved.", event);
          const undo = form.dataset.undoAction
            ? { action: form.dataset.undoAction, watched: form.dataset.undoWatched, label: form.dataset.undoLabel }
            : null;
          await refreshShow(window.location.href, false, message);
          showToast(message, undo);
        } catch {
          announce(saveFailureMessage);
        }
      });
    });

    document.querySelectorAll("[data-preference-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          const response = await fetch(form.action, {
            method: "POST",
            body: new URLSearchParams(new FormData(form)),
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error("Preference failed");
          const message = successMessage(form, "Preferences updated.", event);
          await refreshShow(window.location.href, false, message);
          showToast(message);
        } catch {
          announce(saveFailureMessage);
        }
      });
    });

    document.querySelectorAll("[data-filter-form]").forEach((form) => {
      const applyFilter = async () => {
        try {
          const message = filterAnnouncement(form);
          await refreshShow(filterUrl(form).toString(), true, message);
          showToast(message);
        } catch {
          announce(filterFailureMessage);
        }
      };
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void applyFilter();
      });
      form.querySelectorAll("input, select").forEach((input) => {
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
