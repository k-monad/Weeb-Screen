# Weeb-Screen — Spec-Init Planning Prompt

> Hand this file **together with `spec-init.md`** to a spec-authoring agent that has
> access to `C:\Projects\Filler-Begone`. The agent follows `spec-init.md` to produce
> (1) the Weeb-Screen spec document in the repo and (2) a kickoff prompt for an
> implementation agent. It should not write app code from this prompt.
>
> All paths referenced below were verified. The `naruto_shippuden_netflix_episode_mapping.xlsx`
> data shape below was read cell-by-cell from all four sheets.

---

Help me design a new spec for **Weeb-Screen** in `C:\Projects\Filler-Begone`, using
`C:\Projects\Filler-Begone\spec-init.md` as the spec-authoring playbook. This repo has
**no app implementation yet** — the spec designs the initial app and its homelab
deployment, then hands off a kickoff prompt. Follow `spec-init.md`: read the repo's
conventions, GROUND EVERY DESIGN CHOICE IN REAL FILES (re-open the workbook and the
Olympus inventories — do not invent columns, IPs, services, or guest IDs), write the
spec in the repo's documentation house style, make every open decision with a
recommendation, flag the security-sensitive surfaces (file upload + XLSX/CSV parsing,
new VM + firewall, backups, any new secret/env var), add the spec to whatever
index/location fits, then output a kickoff prompt and stop with a short summary. Do NOT
decompose into tickets or write code unless I say "continuous build" / "full handoff".

Suggested spec filename: `weeb-screen-spec.md` at the repo root (match the existing flat
`*.md` layout — `idea-draft.md`, `spec-init.md`, `olympus_*.md`), unless you find a
better convention.

## What it's about

A lean, self-hosted, internal-only web app ("Weeb-Screen") for tracking which anime
episodes a household has watched, with first-class **filler-skipping**. The first
dataset is Naruto Shippuden, but the app must be **multi-anime from day one**. It is
seeded from a spreadsheet that maps real episode numbers to a Netflix-style
season/episode layout with filler metadata.

## Context (verified against the repo)

### Seed workbook — `naruto_shippuden_netflix_episode_mapping.xlsx`

Read directly. **4 sheets:**

**`Mapping`** — 500 episode rows (+ header) × 10 columns. Exact headers, real types, and
the mapping to the proposed CSV:

| Workbook column       | Real type / sample                                   | Maps to CSV field            |
|-----------------------|------------------------------------------------------|------------------------------|
| `Real Episode #`      | int, global 1..500 (`1`)                             | `real_episode_number`        |
| `Netflix #`           | **service code string** (`S1E01`) — NOT a counter    | `service_episode_code`       |
| `Episode Title`       | text, contains **Unicode** (em-dash `—`, `・`, `!!`)  | `episode_title`              |
| `Filler?`             | enum: `No` / `Mixed` / `Yes`                          | `filler_bucket`              |
| `Canon/Filler Type`   | `Manga Canon` / `Anime Canon` / `Mixed Canon/Filler` / `Filler` | `canon_filler_type` |
| `Original Airdate`    | **Excel datetime** (e.g. 2007-02-15) — NOT a string  | `original_airdate` (→ ISO)   |
| `Netflix Season`      | int (`1`)                                            | `service_season_number`      |
| `Netflix Episode #`   | int, **resets per season**                           | `service_episode_number`     |
| `Episode Data Source` | **full URL** (`https://www.animefillerlist.com/shows/naruto-shippuden`) | `episode_data_source_url` |
| `Seasoning Source`    | **full URL** (`https://watch.plex.tv/show/naruto-shippuden/season/1`)   | `season_boundary_source_url` |

**`Season Boundaries`** — 21 season rows. Columns: `Netflix Season`, `Real Episode
Start`, `Real Episode End`, `Episode Count`, `First Netflix #`, `Start Episode Title`,
`Last Netflix #`, `End Episode Title`, `Boundary Source` (URL). E.g. S1 = real 1–32 (32
eps), S20 = real 414–479 (66 eps), S21 = real 480–500 (21 eps). Some `End Episode Title`
cells contain placeholder text like `Title` — the importer must not choke on
placeholders/blanks.

**`Summary`** — totals & assumptions: 500 total episodes; 21 service seasons; **No=233**
(Manga Canon 232 + Anime Canon 1), **Mixed=64**, **Yes=203**; filler ≈ **40.6%**.
Includes a "Canon/Filler Type Breakdown" and a "Quick Season Boundary Key". Use these
numbers as an import-correctness oracle in the acceptance criteria.

**`Sources`** — provenance: columns `Source`, `What it was used for`, `URL`, `Notes`
(AnimeFillerList, Plex season guide, Roku S20 page, etc.).

### Verified data quirks the data model and importer MUST handle

- **`Original Airdate` is an Excel datetime**, not text — the XLSX importer must convert
  to ISO `yyyy-mm-dd`; the CSV importer must accept ISO strings.
- **`Netflix #` is the service code (`S1E01`)**, not a global running number. There is no
  global service counter column to worry about.
- **Real vs service episode numbers diverge.** `real_episode_number` is global 1..500;
  `service_episode_number` (`Netflix Episode #`) **resets each season** (S1 = 1–32 maps
  real 1–32; S2 = 1–21 maps real 33–53; …). They only coincide in S1. The model must
  store both independently and never assume they align. `service_episode_code` encodes
  both.
- **Titles contain Unicode** (em-dashes, `・` U+30FB, `!!`). The entire import path,
  storage, and UI must be UTF-8 clean.
- Both source columns are already **full URLs** — no name→URL reconciliation needed, but
  per-row `Seasoning Source` (Plex season URL) overlaps with the per-season `Boundary
  Source` in the `Season Boundaries` sheet; decide which feeds `season_boundary_source_url`.

### Homelab target — verified in the Olympus inventories

- `zeus` = Dell PowerEdge R420, **Proxmox VE 9.1** (Debian 13 Trixie), LAN
  `192.168.0.113` on bridge `vmbr0`, Tailscale member of tailnet `egret-chimaera.ts.net`
  (MagicDNS on; HTTPS certs via `tailscale cert`).
- Hardware: **2× Intel Xeon E5-2470 (16c/32t), 120 GiB RAM, no compute GPU** — plenty of
  RAM/storage but **older, slower CPUs**, so the app must stay lightweight.
- Storage: ZFS `rpool` (boot mirror) + `zeus-datapool` (RAIDZ2 SSD). Datasets include
  `vms` (`recordsize=64K`, lz4 — Proxmox storage `vms`) and `personal` (`zstd`,
  SMB-shared, subdirs `claude/`, `gabby-backup/`, `notes/`).
- **Existing guests:** CT 110 `fileserver`, CT 120 `plex`, VM 200 `plane` (planned,
  undeployed), VM 201 `seafile`. Pick a **new unused** guest ID (e.g. VM 202) — do not
  reuse these or land on an existing service host.
- **Established Docker pattern (Seafile VM 201; planned Plane VM 200):** Ubuntu 24.04
  cloud-image **VM** running **Docker Engine + Compose**, app behind **Caddy** with a
  **Tailscale cert** (`tailscale cert`, mounted under `/etc/<svc>/tls/`), app bound to
  **localhost-only high ports**, a Tailscale **tag**, **msmtp** Gmail relay for alerts,
  **daily app-level backups** via cron (DB dump + data tarball, msmtp alert on failure),
  and a **per-VM Proxmox firewall** at `/etc/pve/firewall/<id>.fw` (default DROP in /
  ACCEPT out; allow tailnet `100.64.0.0/10` + ICMP, plus specific LAN ports when LAN
  access is wanted). LXCs follow `base-lxc-setup.md`, unprivileged, `nesting=1,keyctl=1`,
  UID shift +100000. On VMs, Docker runs via `sudo docker` (`k-admin` not in docker group).
- **Access posture precedent:** `seafile` is **Tailscale-only** (no LAN firewall rules);
  `plex` / `fileserver` are **LAN + tailnet**. Weeb-Screen wants **both LAN and
  Tailscale**, so follow the plex/fileserver firewall model.
- **Tailscale ACL conventions** live in `olympus_software_inventory.md` §6 (`tagOwners` +
  per-tag `ssh` accept rules); the spec should add a new tag the same way.

## Goal

A phone- and desktop-friendly, internal-only episode tracker where the household can
browse a library of imported anime, open a show, see episodes grouped by service season,
mark episodes watched/unwatched (persisted in a **database**, surviving browser refresh
*and* container restart), filter by canon/mixed/filler/unwatched, and **skip filler** —
including a "next episode" recommendation that respects skip-filler. Admins import new
anime (XLSX or CSV; **CSV is the going-forward standard**) from a settings → admin
section. Source/provenance is imported and stored but **hidden from the normal viewer**.
It runs on a **new dedicated VM/LXC on `zeus`** via Docker Compose, reachable from LAN
and Tailscale, never the public internet.

## Important principles the spec must honor

- **Mobile-first and desktop-usable.** A ~500-row episode list must stay fast and
  navigable on a phone.
- **Multi-anime by design.** Naruto Shippuden is just the first import; every show is
  displayed and tracked separately. No Naruto-specific hardcoding.
- **Database is the source of truth for progress** — never localStorage-only.
- **Household-level progress in v1, modeled for optional per-user later** without a schema
  rewrite.
- **Three-state canon classification**, not a boolean: pure **canon**, **mixed**
  canon/filler, and pure **filler** distinguishable everywhere (filters, badges, skip).
- **Provenance stored but invisible** in the normal viewing UI (admin-only).
- **Lightweight everything** — small image(s), low RAM, SQLite unless Postgres is truly
  justified, because `zeus` has old CPUs.
- **Internal-only** — no public exposure, no port-forwarding; LAN + Tailscale only.
- Honor existing homelab conventions (Tailscale tags, per-guest Proxmox firewall, Caddy +
  Tailscale cert, msmtp alerts, daily backups) rather than inventing new ones.

## The spec must cover

### 1. Product behavior
- **Library / show-list view:** every imported anime as a card/row with per-show watched
  progress (e.g. "X / Y canon watched"); empty state before anything is imported.
- **Anime detail page:** title, totals, episodes **grouped by service season**
  (collapsible) using `service_season_number` / `service_episode_number`.
- **Episode row/card behavior:** define both layouts — compact rows on desktop,
  tap-friendly cards on mobile. Each shows the service code (`S1E01`), title, a
  canon/mixed/filler badge, airdate, and a watched toggle. Provenance must NOT appear here.
- **Watched/unwatched controls:** per-episode toggle; bulk actions (mark a whole season;
  "mark up to here"); optimistic UI but persisted server-side.
- **Progress summaries** per show and per season (counts + %), with a **canon-only vs
  all-episodes** view since filler skews totals.
- **Filters:** All / Canon / Mixed / Filler / Unwatched (define how they combine).
- **Skip-filler behavior:** a skip-filler toggle (global and/or per-show), and a precise
  definition of how the **"next episode" recommendation** behaves under it — e.g. next
  unwatched episode whose `filler_bucket` is `No`. Decide whether `Mixed` counts as
  skippable (recommend **watch, not skip**, since Mixed contains canon — and note the data
  has 64 Mixed episodes). Define behavior at season boundaries and end-of-show.

### 2. Admin / import behavior
- **Admin section under Settings** (no login in v1 — decide how it's gated; see Open
  Decisions).
- **Upload XLSX or CSV**; CSV is the recommended standard. Define the canonical CSV
  template (below) and how the XLSX importer maps the workbook's sheets/columns onto it
  (including Excel-datetime → ISO and Unicode handling).
- **Validate required columns**; show friendly, specific errors (which row, which column,
  what's wrong) — not stack traces.
- **Pre-import preview:** detected show, episode count, season breakdown, and
  canon/mixed/filler counts, shown for confirmation **before** committing. (Cross-check
  against the workbook's `Summary` totals: 500 eps, 21 seasons, No/Mixed/Yes = 233/64/203.)
- **Duplicate / re-import handling:** prevent accidental double-import and define
  update/replace semantics keyed on `show_slug` (see Open Decisions).
- **Store source URLs / provenance** on import, never surfaced in the normal viewer.
- **Import job/log** so a human can see what was imported, when, row counts, and errors.

### 3. Data model
- **`shows`**: id, title, slug (unique), service_name, optional show metadata, show-level
  provenance (e.g. season-boundary source URL), timestamps.
- **`episodes`**: id, show_id (FK), `real_episode_number`, `service_season_number`,
  `service_episode_number`, `service_episode_code`, `episode_title`, `original_airdate`
  (store ISO text to match source).
- **Filler metadata:** `filler_bucket` enum (`No` | `Mixed` | `Yes`) + `canon_filler_type`
  text. Make the three-state distinction first-class.
- **Provenance (admin-only):** per-episode `episode_data_source_url` and
  `season_boundary_source_url`; plus any show-level notes from the `Sources` sheet.
- **Household progress:** a `progress` table keyed by episode (+ watched flag /
  watched_at). Design so a future `profile_id` can be added without reworking rows —
  recommend either a nullable `profile_id` (NULL = household) or a `profiles` table with a
  seeded "Household" row that current progress points at.
- **Future user/profile model** sketched even though login is out of scope for v1.
- **Import job/log table** (filename, format, show, counts, status, errors, timestamp).
- Define indexes/uniqueness given real vs service numbers diverge — e.g. unique
  `(show_id, real_episode_number)` and `(show_id, service_season_number,
  service_episode_number)`.

### 4. Architecture
- **Lightweight Docker Compose** on a **new dedicated guest on `zeus`** (recommend the
  guest ID/placement following the seafile/plane VM pattern; justify VM vs LXC). Keep the
  stack minimal — ideally one app container (+ optional Caddy), no heavy DB server.
- **Database:** recommend **SQLite in a persistent Docker volume** for a single-household,
  low-concurrency app on old CPUs; state exactly what would push it to Postgres
  (concurrent writers, real multi-user). Justify it.
- **Persistent volumes** for the database AND for uploads / import history.
- **Backups:** nightly SQLite `.backup` + uploads tarball with msmtp alert on failure
  (mirror the `seafile-backup` cron pattern); note Proxmox `vzdump` of the guest; suggest
  where backups land (e.g. the `personal` dataset / fileserver share).
- **Internal exposure for LAN + Tailscale:** recommend Caddy + a Tailscale cert for
  tailnet HTTPS (and/or Tailscale Serve) plus a LAN allow rule to the app port —
  following the **plex/fileserver LAN+tailnet** model, not the Tailscale-only seafile
  model. App on localhost high ports behind the proxy.
- **Firewall:** a new `/etc/pve/firewall/<id>.fw` (default DROP in / ACCEPT out; allow
  tailnet `100.64.0.0/10`, LAN `192.168.0.0/16` to the app port, ICMP). New Tailscale
  **tag** added to ACL `tagOwners` + `ssh` accept rules like existing tags.
- Choose the app's tech stack as a decision — small x86 image, low memory (target is
  Xeon, not ARM); keep it boring and lightweight.

### 5. Non-goals (state explicitly)
- No public internet exposure / no port forwarding.
- No account login/authentication in v1.
- No streaming/video playback.
- No internet scraping of anime data in v1 (data comes only from uploads).
- No heavy media-server integration in v1.
- No Plex integration in v1 (future idea only).

### 6. Acceptance criteria (make them checkable)
- The Naruto Shippuden workbook imports successfully: 500 episodes, 21 seasons, filler
  buckets No/Mixed/Yes = 233/64/203, all provenance captured.
- The app displays Naruto Shippuden grouped by service season and episode.
- Household watched progress persists across **browser refresh and container restart**.
- Filler filtering works, and the **skip-filler "next episode"** recommendation behaves
  per the defined rules.
- Mobile and desktop layouts are both usable on a ~500-episode show.
- A **second anime** (a CSV using the template) imports and is tracked **separately**.
- Source URLs are stored but never visible in the normal user-facing UI.
- The deployment runs on a dedicated VM/LXC on `zeus` via Docker Compose, reachable on
  LAN and Tailscale, with persistent DB/uploads and a working backup.

## Recommended CSV template (stable, for future uploads)

Define a stable, documented, **UTF-8** CSV format. At minimum these columns (decide
required vs optional and validate accordingly):

```
show_title, show_slug, service_name, real_episode_number,
service_season_number, service_episode_number, service_episode_code,
episode_title, filler_bucket, canon_filler_type, original_airdate,
episode_data_source_url, season_boundary_source_url
```

- `filler_bucket` ∈ {`No`, `Mixed`, `Yes`}.
- `canon_filler_type` e.g. `Manga Canon`, `Anime Canon`, `Mixed Canon/Filler`, `Filler`.
- `original_airdate` ISO `yyyy-mm-dd` (XLSX importer converts the Excel datetime).
- `service_episode_code` e.g. `S1E01` (decide whether required or derived from
  season+episode).
- In the spec, restate each column's mapping to the workbook (table above) and the two
  verified nuances: real vs service numbering diverges, and `Original Airdate` is an Excel
  datetime.

**Decide where show-level metadata lives** (every CSV row vs a separate metadata section
vs an admin upload form); recommend the simplest reliable option. *Recommendation to
evaluate:* capture show-level fields (`show_title`, `show_slug`, `service_name`, source
URLs) in the **admin upload form**, keep the CSV as **pure per-episode rows**, and accept
the show-level columns as **optional** in the CSV — if present they must be constant
across rows and match the form. This avoids repeating show metadata on 500 rows and
fragile multi-section parsing, while keeping the CSV portable.

## Open decisions the spec should resolve (with a recommendation each)

1. **VM vs LXC on `zeus`** for Docker Compose — recommend one (the homelab runs Docker in
   Ubuntu VMs, e.g. seafile/plane; Docker-in-LXC is possible but fiddly). Pick a concrete
   unused guest ID and placement.
2. **SQLite vs Postgres** — recommend SQLite for v1; state Postgres trigger conditions.
3. **LAN + Tailscale exposure mechanism** — Caddy + Tailscale cert and/or Tailscale Serve
   for HTTPS, plus the LAN firewall allow; pick concrete approach and ports.
4. **How the admin section is gated** with no login in v1 (shared admin path/PIN,
   network-trust only, or a settings toggle) — recommend the least-friction safe option;
   note it's a security-sensitive surface (file upload + parsing).
5. **Re-import / duplicate semantics** on `show_slug` — recommend replace-in-place
   (re-import updates episodes, preserves household progress by matching on
   `real_episode_number`) vs versioned imports; define what happens to watched flags.
6. **`Mixed` in skip-filler** — recommend whether Mixed episodes are skipped or watched
   when "skip filler" is on (recommend watch, since they contain canon).
7. **`service_episode_code` required vs derived** from season + episode.
8. **App tech stack** — a lightweight stack with a small x86 image.

## Non-goals for THIS spec task
- Do not write application code.
- Do not deploy anything to `zeus`.
- Do not decompose into tickets or edit any decision log (unless I later say
  "continuous build" / "full handoff").

## Further context index (read in this order)

- `C:\Projects\Filler-Begone\idea-draft.md` — prompt-builder guidance (how this prompt was
  shaped; useful if you refine it).
- `C:\Projects\Filler-Begone\spec-init.md` — the spec-authoring & handoff playbook to
  follow when producing the spec + kickoff prompt.
- `C:\Projects\Filler-Begone\naruto_shippuden_netflix_episode_mapping.xlsx` — the seed
  workbook and real data shape. Re-open all four sheets.
- `C:\Projects\Filler-Begone\olympus_hardware_inventory.md` — `zeus` hardware, Proxmox,
  ZFS storage, network, guest IDs, constraints.
- `C:\Projects\Filler-Begone\olympus_software_inventory.md` — existing services, the
  Docker/Caddy/Tailscale/firewall/backup conventions, ACL patterns, deployment runbooks.

## How to work

Follow `spec-init.md`: learn the repo's conventions, GROUND THE DESIGN IN REAL FILES
(re-open the workbook and inventories — do not invent columns, IPs, services, or guest
IDs), write the spec in the repo's documentation house style, make every open decision
with a recommendation, flag the security-sensitive surfaces (file upload + XLSX/CSV
parsing, new VM + firewall, backups, any new secret/env var), add the spec to the
appropriate location, then output a kickoff prompt for an implementation agent and stop
with a short summary. Produce the spec + kickoff prompt only — do NOT decompose into
tickets or write code unless I say "continuous build" / "full handoff".
