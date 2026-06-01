import type { ImportJob } from "../db/repositories.js";
import type { ImportPreview } from "../importers/types.js";
import { escapeHtml } from "./html.js";

export function adminPage(jobs: ImportJob[], message?: string): string {
  return adminLayout(
    "Admin",
    `<main class="admin-shell">
      <h1>Admin</h1>
      ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
      <section class="panel">
        <h2>Import show</h2>
        <form method="post" action="/admin/import/preview" enctype="multipart/form-data">
          <label>Show title <input name="show_title" value="Naruto Shippuden" required></label>
          <label>Show slug <input name="show_slug" value="naruto-shippuden" required></label>
          <label>Service name <input name="service_name" value="Netflix"></label>
          <label>File <input type="file" name="file" accept=".csv,text/csv" required></label>
          <button type="submit">Preview import</button>
        </form>
      </section>
      ${importLog(jobs)}
    </main>`,
  );
}

export function importPreviewPage(jobId: number, preview: ImportPreview, jobs: ImportJob[]): string {
  const errors = preview.issues.filter((issue) => issue.level === "error");
  const warnings = preview.issues.filter((issue) => issue.level === "warning");
  const canCommit = errors.length === 0;

  return adminLayout(
    "Import Preview",
    `<main class="admin-shell">
      <h1>Import preview</h1>
      <section class="panel">
        <h2>${escapeHtml(preview.show.title)}</h2>
        <p>${preview.counts.total} episodes - ${preview.counts.seasons} seasons - No/Mixed/Yes = ${preview.counts.fillerBuckets.No}/${preview.counts.fillerBuckets.Mixed}/${preview.counts.fillerBuckets.Yes}</p>
        <p>Format: ${preview.format.toUpperCase()} - slug: ${escapeHtml(preview.show.slug)}</p>
        ${issueList("Errors", errors)}
        ${issueList("Warnings", warnings)}
        ${
          canCommit
            ? `<form method="post" action="/admin/import/commit"><input type="hidden" name="job_id" value="${jobId}"><button type="submit">Commit import</button></form>`
            : `<p class="error">Fix errors before committing.</p>`
        }
      </section>
      ${importLog(jobs)}
    </main>`,
  );
}

export function importLogPage(jobs: ImportJob[]): string {
  return adminLayout("Import Log", `<main class="admin-shell">${importLog(jobs)}</main>`);
}

function issueList(title: string, issues: ImportPreview["issues"]): string {
  if (issues.length === 0) {
    return "";
  }

  return `<section class="${title === "Errors" ? "errors" : "warnings"}">
    <h3>${title}</h3>
    <ul>${issues
      .map((issue) => {
        const where = issue.row ? `Row ${issue.row}${issue.column ? `, ${issue.column}` : ""}` : issue.column ?? "File";
        return `<li><strong>${escapeHtml(where)}:</strong> ${escapeHtml(issue.message)}</li>`;
      })
      .join("")}</ul>
  </section>`;
}

function importLog(jobs: ImportJob[]): string {
  return `<section class="panel">
    <h2>Import log</h2>
    ${
      jobs.length === 0
        ? "<p>No imports yet.</p>"
        : `<table>
          <thead><tr><th>When</th><th>Show</th><th>Status</th><th>Rows</th><th>Imported</th><th>Updated</th></tr></thead>
          <tbody>${jobs
            .map(
              (job) =>
                `<tr><td>${escapeHtml(job.createdAt)}</td><td>${escapeHtml(job.showSlug ?? "")}</td><td>${escapeHtml(job.status)}</td><td>${job.rowsTotal ?? ""}</td><td>${job.rowsImported ?? ""}</td><td>${job.rowsUpdated ?? ""}</td></tr>`,
            )
            .join("")}</tbody>
        </table>`
    }
  </section>`;
}

function adminLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f7f7f4; color: #1d211f; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    .admin-shell { width: min(1040px, calc(100% - 24px)); margin: 0 auto; padding: 24px 0; }
    .panel { background: #fff; border: 1px solid #d9ddd6; border-radius: 8px; padding: 16px; margin: 0 0 14px; }
    form { display: grid; gap: 12px; }
    label { display: grid; gap: 5px; }
    input, button { font: inherit; border: 1px solid #aeb7af; border-radius: 6px; padding: 8px 10px; }
    button { background: #f8faf7; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid #e4e8e2; padding: 8px; }
    .error, .errors { color: #8a2424; }
    .warnings { color: #77520a; }
    .notice { background: #e3f5ec; border: 1px solid #9bd3bb; padding: 10px; border-radius: 6px; }
  </style>
</head>
<body>${body}</body>
</html>`;
}
