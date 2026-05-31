---
status: draft_spec
authored_on: 2026-05-31
last_reviewed: 2026-05-31
depends_on: olympus_hardware_inventory.md, olympus_software_inventory.md, naruto_shippuden_netflix_episode_mapping.xlsx
security_review_required: true
open_followups: human ratification of decisions D1–D9; security read of file-upload/firewall/backups/secrets before deploy
---

# Weeb-Screen — Initial App + Homelab Deployment Spec

> Weeb-Screen is a lean, **internal-only** web app for a single household to track which
> anime episodes they have watched, with first-class **filler-skipping**. It is
> **multi-anime from day one** (Naruto Shippuden is merely the first import), the
> **database is the source of truth for progress**, and canon is a **three-state**
> classification (canon / mixed / filler) — never a boolean. **Filler status is the primary
> axis**: the default view is a flat, real-watch-order list that foregrounds canon/mixed/filler,
> and the service-season `S#E#` layout is an **optional, user-enabled** view (D9). Source/provenance is
> imported and stored but **hidden from the normal viewer**. It runs on a **new dedicated
> VM on `zeus`** via Docker Compose, reachable on **LAN + Tailscale only** — never the
> public internet.

**Read first:** `spec-init.md` (authoring playbook this spec follows), `weeb-screen-spec-prompt.md` (planning prompt), `olympus_hardware_inventory.md`, `olympus_software_inventory.md`.
**Depends on:** the seed workbook `naruto_shippuden_netflix_episode_mapping.xlsx` (data shape) and the Olympus Docker/Caddy/Tailscale/firewall/backup conventions (deployment).
**Blocks:** nothing yet — this is the initial spec for a repo with **no app implementation**. It unblocks the implementation kickoff.

> **Grounding note (honesty about what is and isn't verified).** This repo is greenfield —
> there is no existing application code to ground API signatures against. Per `spec-init.md`,
> the "ground every contract in real code" rule is applied where real artifacts exist:
> the **data contract** is verified cell-by-cell against the workbook, and the **deployment
> contract** is verified against the two Olympus inventories. The **app HTTP/DB contracts
> below are net-new** and defined by this spec; they are labelled as proposals, not as
> existing code.

---

## 0. Hard rules (carried from the planning prompt — honor these)

1. **Ground every contract in real files.** No invented columns, API signatures, IPs,
   services, runbook names, or Proxmox guest IDs. The workbook and Olympus inventories
   were re-opened to confirm everything in §3 and §7.
2. **Honor the verified data quirks** (§2.3): Excel-datetime airdate → ISO; `Netflix #`
   is the service code `S1E01` (not a counter); real vs service episode numbers diverge;
   titles carry non-ASCII Unicode (UTF-8 end-to-end); source columns are already full URLs.
3. **Resolve every open decision with a recommendation + alternative** (§11, D1–D9).
4. **Follow existing Olympus deployment conventions** (§7): new unused guest ID on `zeus`,
   Docker Compose, Caddy + Tailscale cert, per-guest Proxmox firewall on the
   **plex/fileserver LAN+tailnet model** (not seafile's Tailscale-only model), msmtp alerts,
   daily backups.
5. **Keep product principles intact** (§2): mobile-first + desktop-usable, multi-anime,
   DB is source of truth, three-state canon/mixed/filler, provenance stored-but-hidden,
   internal-only.
6. **Flag security-sensitive surfaces for a human read** (§12): file upload + XLSX/CSV
   parsing, the new VM + firewall rules, backups, any new secret/env var.

---

## 1. Goal

A phone- and desktop-friendly, internal-only episode tracker where the household can:

- Browse a **library** of imported anime, each with per-show watched progress.
- Open a **show** and see episodes in a **filler-first flat list** (real watch order) with the
  canon/mixed/filler state front and center; optionally enable **"Season details"** to regroup
  by service season (`S#E#`) — that layout is opt-in (D9).
- **Mark episodes watched/unwatched** — persisted in a database, surviving browser refresh
  **and** container restart.
- **Filter** by canon / mixed / filler / unwatched.
- **Skip filler**, including a "next episode" recommendation that respects skip-filler.
- (Admin) **Import** new anime from XLSX or CSV (CSV is the going-forward standard) from a
  Settings → Admin section, with a pre-commit preview and an import log.

"Done" = the eight acceptance criteria in §9 all pass.

---

## 2. Principles / constraints this spec honors

- **Mobile-first and desktop-usable.** A ~500-row episode list stays fast on a phone (the
  default flat list virtualizes/paginates as needed, and the opt-in season view collapses
  seasons to keep the rendered DOM small; see §6).
- **Multi-anime by design.** Every show is displayed and tracked separately. **No
  Naruto-specific hardcoding** anywhere — Naruto Shippuden is row data, not code.
- **Database is the source of truth for progress.** Never localStorage-only. Toggles may
  be optimistic in the UI but are always persisted server-side.
- **Household-level progress in v1, modeled for optional per-user later** without a schema
  rewrite (see `profiles` table, §4).
- **Three-state canon classification** — `No` (canon), `Mixed`, `Yes` (filler) — is
  first-class everywhere: filters, badges, skip logic, progress.
- **Provenance stored but invisible** in the normal viewing UI (admin-only).
- **Lightweight everything.** Small x86 image, low RAM, SQLite unless Postgres is truly
  justified — `zeus` has older, slower Xeon CPUs (§7).
- **Internal-only.** No public exposure, no port-forwarding; LAN + Tailscale only.
- **Honor existing homelab conventions** rather than inventing new ones (§7).

---

## 3. The verified data contract (the seed workbook)

> Re-opened `naruto_shippuden_netflix_episode_mapping.xlsx` with `openpyxl` and read all
> four sheets cell-by-cell. The numbers below are an **import-correctness oracle** for §9.

### 3.1 Sheets present

| Sheet | Shape | Role in import |
|---|---|---|
| `Mapping` | 500 data rows × 10 cols (header row 1) | **The episode source.** Each row → one `episodes` row. |
| `Season Boundaries` | 21 data rows × 9 cols | **Validation oracle only** (derivable from `Mapping`). Not a separate import target. |
| `Summary` | totals & breakdown | **Validation oracle** (counts cross-check). |
| `Sources` | provenance notes | Show-level `notes` (admin-only). |

### 3.2 `Mapping` column → CSV field → DB column (exact)

| Workbook column (`Mapping`) | Real type / verified sample | CSV field | DB column |
|---|---|---|---|
| `Real Episode #` | int, **global 1..500 in row order** (verified) | `real_episode_number` | `episodes.real_episode_number` |
| `Netflix #` | str service **code** `S1E01` (not a counter) | `service_episode_code` | `episodes.service_episode_code` |
| `Episode Title` | text, **UTF-8 / non-ASCII** (see §3.3); placeholders allowed | `episode_title` | `episodes.episode_title` |
| `Filler?` | enum `No` / `Mixed` / `Yes` | `filler_bucket` | `episodes.filler_bucket` |
| `Canon/Filler Type` | `Manga Canon` / `Anime Canon` / `Mixed Canon/Filler` / `Filler` | `canon_filler_type` | `episodes.canon_filler_type` |
| `Original Airdate` | **Excel datetime** (e.g. `2007-02-15 00:00:00`) → ISO | `original_airdate` | `episodes.original_airdate` (ISO text) |
| `Netflix Season` | int (`1`..`21`) | `service_season_number` | `episodes.service_season_number` |
| `Netflix Episode #` | int, **resets per season** | `service_episode_number` | `episodes.service_episode_number` |
| `Episode Data Source` | **full URL** (always `animefillerlist.com` here) | `episode_data_source_url` | `episodes.episode_data_source_url` |
| `Seasoning Source` | **full URL**, varies by season (see §3.4) | `season_boundary_source_url` | `episodes.season_boundary_source_url` |

### 3.3 Verified Unicode reality (UTF-8 end to end)

The only non-ASCII codepoints in the 500 titles are:

| Codepoint | Char | Count | Example title |
|---|---|---:|---|
| U+2019 RIGHT SINGLE QUOTATION MARK | `’` | 14 | `Naruto’s Vow` |
| U+2013 EN DASH | `–` | 13 | `Kakashi: Shadow of the ANBU Black Ops – A Mask That Hides the Heart` |
| U+00C9 LATIN CAPITAL LETTER E WITH ACUTE | `É` | 1 | `… – Coup D’État` |
| U+016B LATIN SMALL LETTER U WITH MACRON | `ū` | 1 | `Ninshū: The Ninja Creed` |

> **Refinement vs the planning prompt:** the prompt cited an em-dash (U+2014) and `・`
> (U+30FB). The actual title dash is an **en dash (U+2013)**, and `・` appears only in the
> **`Sources`** sheet note ("Naruto・Hinata"), not in any episode title. `!!` is plain
> ASCII. The principle is unchanged — **the entire import path, storage, and UI must be
> UTF-8 clean** and never mojibake these characters.

### 3.4 Verified `Seasoning Source` / `Boundary Source` reality

`Seasoning Source` (per-row, `Mapping`) is **not** uniformly a Plex URL:

| Domain | Seasons | Rows |
|---|---|---:|
| `watch.plex.tv` | S1–S19 | 413 |
| `therokuchannel.roku.com` | S20 | 66 |
| `www.rottentomatoes.com` | S21 | 21 |

It is **constant within each season** and **identical** to that season's `Boundary Source`
in the `Season Boundaries` sheet (0 mismatches across all 500 rows). → **Decision D-prov:**
the per-row `Seasoning Source` feeds `episodes.season_boundary_source_url`; the importer
reads episodes from `Mapping` only, and does **not** need the `Season Boundaries` sheet for
data (it is used only as a validation oracle).

### 3.5 Other verified quirks the importer MUST handle

- **`service_episode_code` is exactly derivable**: `S{service_season_number}E{service_episode_number:02d}`
  matched all 500 `Netflix #` cells (0 mismatches). → see D7.
- **One placeholder title in `Mapping`**: real ep 53 / `S2E21` has `Episode Title = "Title"`.
  The `Season Boundaries` S2 `End Episode Title` is also `"Title"`. The importer must
  **accept placeholders/blanks without choking** (store as-is; flag in preview, do not error).
- **Excel-datetime airdate** must be converted to ISO `yyyy-mm-dd` text on XLSX import; the
  CSV importer accepts ISO strings. Verified range 2007-02-15 → 2017-03-23.
- **Real vs service numbering diverge** — store both independently, never assume they align
  (they coincide only in S1). Ordering for "next episode" uses `real_episode_number` (§5.3).

### 3.6 The oracle numbers (used in §9 acceptance criteria)

`Total = 500`, `service seasons = 21`, `Filler? No/Mixed/Yes = 233/64/203`,
`Canon/Filler Type = Manga Canon 232 / Anime Canon 1 / Mixed Canon/Filler 64 / Filler 203`,
filler ≈ `40.6%`, `Σ(Season Boundaries Episode Count) = 500`.

---

## 4. Data model / schema (SQLite — proposed, net-new)

> Dialect: SQLite. Store timestamps and airdates as **ISO-8601 text** (matches source).
> All text is UTF-8. `PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;`.

```sql
-- A tracked anime. Naruto Shippuden is just the first row.
CREATE TABLE shows (
  id                          INTEGER PRIMARY KEY,
  title                       TEXT    NOT NULL,
  slug                        TEXT    NOT NULL UNIQUE,        -- e.g. 'naruto-shippuden'
  service_name                TEXT,                            -- e.g. 'Netflix'
  total_real_episodes         INTEGER,                         -- denormalized convenience
  season_boundary_source_url  TEXT,                            -- show-level primary src (optional; admin-only)
  notes                       TEXT,                            -- from `Sources` sheet (admin-only)
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);

-- One row per episode. Real and service numbers are stored independently.
CREATE TABLE episodes (
  id                          INTEGER PRIMARY KEY,
  show_id                     INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  real_episode_number         INTEGER NOT NULL,                -- global 1..N, canonical order
  service_season_number       INTEGER NOT NULL,                -- e.g. 1..21
  service_episode_number      INTEGER NOT NULL,                -- resets per season
  service_episode_code        TEXT    NOT NULL,                -- 'S1E01' (derived/validated, D7)
  episode_title               TEXT    NOT NULL,                -- UTF-8; placeholders allowed
  filler_bucket               TEXT    NOT NULL
                                CHECK (filler_bucket IN ('No','Mixed','Yes')),
  canon_filler_type           TEXT    NOT NULL,                -- free text; 4 known values
  original_airdate            TEXT,                            -- ISO 'yyyy-mm-dd' or NULL
  episode_data_source_url     TEXT,                            -- admin-only provenance
  season_boundary_source_url  TEXT,                            -- admin-only provenance (per-row Seasoning Source)
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (show_id, real_episode_number),
  UNIQUE (show_id, service_season_number, service_episode_number)
);
CREATE INDEX idx_episodes_show_season ON episodes(show_id, service_season_number, service_episode_number);
CREATE INDEX idx_episodes_show_real   ON episodes(show_id, real_episode_number);
CREATE INDEX idx_episodes_show_bucket ON episodes(show_id, filler_bucket);

-- Future-proofing for per-user later WITHOUT a schema rewrite (D-profile).
-- v1 seeds exactly one row: the Household.
CREATE TABLE profiles (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  is_household  INTEGER NOT NULL DEFAULT 0,   -- 1 for the seeded Household row
  created_at    TEXT NOT NULL
);
-- seed: INSERT INTO profiles(id,name,is_household,created_at) VALUES (1,'Household',1, <now>);

-- Progress is keyed by (profile, episode). v1 always uses profile_id = 1.
CREATE TABLE progress (
  id          INTEGER PRIMARY KEY,
  profile_id  INTEGER NOT NULL DEFAULT 1 REFERENCES profiles(id) ON DELETE CASCADE,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  watched     INTEGER NOT NULL DEFAULT 0,    -- 0/1
  watched_at  TEXT,                          -- ISO timestamp when set watched, else NULL
  updated_at  TEXT NOT NULL,
  UNIQUE (profile_id, episode_id)
);
CREATE INDEX idx_progress_profile_episode ON progress(profile_id, episode_id);

-- Audit/log of every import attempt (preview and commit).
CREATE TABLE import_jobs (
  id             INTEGER PRIMARY KEY,
  show_id        INTEGER REFERENCES shows(id) ON DELETE SET NULL,
  filename       TEXT,
  format         TEXT CHECK (format IN ('xlsx','csv')),
  show_slug      TEXT,
  status         TEXT NOT NULL
                   CHECK (status IN ('preview','committed','failed')),
  rows_total     INTEGER,
  rows_imported  INTEGER,   -- new episode rows created
  rows_updated   INTEGER,   -- existing episode rows updated (re-import)
  rows_skipped   INTEGER,
  counts_json    TEXT,      -- {"No":233,"Mixed":64,"Yes":203,"seasons":21} for the oracle check
  error_text     TEXT,
  created_at     TEXT NOT NULL,
  finished_at    TEXT
);

-- Small key/value for server-persisted app settings (source of truth, not localStorage).
CREATE TABLE app_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
-- seeds: ('skip_filler_default','false'), ('progress_view_default','canon'),
--        ('season_details_default','false')   -- filler-first list is the default; S#E# is opt-in (D9)
-- optional per-show overrides: ('skip_filler:<slug>','true'|'false'),
--                              ('season_details:<slug>','true'|'false')
```

**Index/uniqueness rationale (because real ≠ service numbering):** `UNIQUE(show_id,
real_episode_number)` is the **stable identity** used to preserve progress across
re-import (D5). `UNIQUE(show_id, service_season_number, service_episode_number)` guards the
service layout. The `service_episode_code` is derived, so it is **not** uniquely indexed on
its own (it is redundant with the season+episode pair).

---

## 5. Behavioral semantics (exact)

### 5.1 Three-state classification
`filler_bucket` is the canonical state used by filters, badges, and skip:
`No` = **Canon** (badge: "Canon"), `Mixed` = **Mixed** (badge: "Mixed"), `Yes` = **Filler**
(badge: "Filler"). `canon_filler_type` is shown only as a secondary detail (and only in
admin where useful); it never replaces the three-state bucket.

### 5.2 Filters (how they combine)
- **Bucket filter** (mutually exclusive, segmented control): **All** | **Canon** (`No`) |
  **Mixed** (`Mixed`) | **Filler** (`Yes`).
- **Unwatched** (independent toggle): when on, ANDs `progress.watched = 0` with the bucket
  filter. Example: *Canon + Unwatched* = `filler_bucket='No' AND NOT watched`.
- Filters affect display only; they never change the "next episode" computation, which has
  its own rule (§5.3).

### 5.3 Skip-filler & "next episode" recommendation (precise)
Ordering is always by **`real_episode_number` ascending** (global canonical order), never by
service code — because service episode numbers reset per season. This makes the
recommendation cross season boundaries correctly with no special case.

- **skip-filler OFF:** `next` = the unwatched episode with the smallest `real_episode_number`
  (any bucket).
- **skip-filler ON:** `next` = the unwatched episode with the smallest `real_episode_number`
  whose `filler_bucket ∈ {No, Mixed}`. **Mixed is watched, not skipped** (it contains canon;
  there are 64 such episodes) — see D6. Only pure `Yes` filler (203 episodes) is skipped.
- **End-of-show:** if no episode matches, `next = null`. UI shows "All caught up" (skip-filler
  off) or "All canon watched" (skip-filler on).
- **Only filler remaining (skip-filler on):** if the sole remaining unwatched episodes are all
  `Yes`, `next = null` and the UI offers: "No more canon — N filler episodes remain. Show them?"

The **skip-filler toggle** is server-persisted (`app_settings`), with a global default and an
optional per-show override (`skip_filler:<slug>`). It survives refresh and restart (source of
truth = DB).

### 5.4 Watched toggles & bulk actions
- **Per-episode toggle** upserts `progress(profile_id=1, episode_id)` setting `watched` and
  `watched_at`. Optimistic in UI, persisted server-side; on failure the UI reverts.
- **Mark whole season:** sets `watched=1` for every episode in `(show, service_season_number)`.
- **Mark up to here:** sets `watched=1` for every episode with `real_episode_number ≤ target`
  in that show (by canonical order). Provide an "unwatch" inverse for both.
- All bulk actions run in a single transaction.

### 5.5 Progress summaries
Computed per show and per season, in two modes:
- **Canon** (default headline): `watched among filler_bucket='No'` / `total filler_bucket='No'`
  — e.g. the library card shows "X / Y canon watched".
- **All:** `watched among all` / `total all`.
- Mixed is excluded from the **canon** headline (strict manga/anime-canon completion) but
  included in **All**. Rationale: the canon headline measures canon completion; skip-filler
  (§5.3) is about *what to play next* and therefore keeps Mixed. The two metrics serve
  different purposes; both are exposed. (A future "story = No+Mixed" metric is out of scope.)

### 5.6 Re-import / duplicate semantics (D5)
Keyed on `show_slug`:
- **New slug** → create the show + all episodes (first import).
- **Existing slug** → the preview step requires explicit **"update existing"** confirmation,
  then **replace-in-place**: upsert episodes matched on `(show_id, real_episode_number)`,
  updating mutable fields (title, codes, buckets, type, airdate, provenance). Episode rows are
  **updated, never deleted+recreated**, so `episodes.id` is stable and **household progress is
  preserved** (progress FKs survive). New episodes are inserted; episodes absent from the new
  file are **kept by default** (not deleted) to avoid silent progress loss — surfaced in the
  preview as "N episodes in DB not in file" with an optional admin "prune" choice.

### 5.7 Display mode — filler-first by default; **season details (S#E#) are opt-in** (D9)
The **primary axis is filler status**, not the service-season layout. This applies generically
to every show (no Naruto-specific hardcoding); Naruto Shippuden is just the motivating example.

- **Default (season details OFF):** the detail page is a **single flat list in real watch
  order** (`real_episode_number` ascending — the global canonical order, §5.3). Each episode's
  **canon/mixed/filler state is the prominent element** (badge + optional bucket filter +
  skip-filler). **No season headers, and the `S#E##` service code is hidden** (or shown only as
  faint secondary text — see §6.3). Watched position is conveyed by the flat real-order list and
  the "next" card.
- **Season details ON (user-enabled):** episodes regroup into **collapsible service seasons**
  using `service_season_number` / `service_episode_number`, and the **`S#E##` code becomes
  visible** on each row. This is the previously-default layout, now opt-in.
- The toggle is **server-persisted** in `app_settings`, with a global default
  (`season_details_default`, seeded `false`) and an **optional per-show override**
  (`season_details:<slug>`), mirroring the skip-filler pattern. It survives refresh and restart
  (source of truth = DB), per the product principle.
- Ordering is identical in both modes — `real_episode_number` ascending — so toggling never
  reorders episodes; ON merely inserts season group headers and reveals the code. (Within a
  season, real order and service order coincide.)
- Filters (§5.2), skip-filler/"next" (§5.3), and progress (§5.5) are **independent of display
  mode** and behave the same whether season details are on or off.

---

## 6. UI flows (mobile-first, desktop-usable)

### 6.1 Library / show list (`GET /`)
- Each imported anime as a **card** (mobile) / **row** (desktop) showing: title,
  service_name, and **per-show canon progress** ("X / Y canon watched") with a small
  percentage bar. A toggle flips the card metric between **Canon** and **All**.
- **Empty state** (nothing imported): a friendly "No anime yet — import your first show in
  Settings → Admin" with a button to the admin import (token-gated, §11 D4).

### 6.2 Anime detail (`GET /shows/:slug`)
- Header: title, totals (canon & all), the **skip-filler** toggle (reflects global/per-show),
  the **bucket filter** segmented control, the **Unwatched** toggle, and a **"Season details
  (S#E#)" toggle** (reflects global/per-show; default OFF — D9, §5.7).
- A prominent **"Play next: <title>"** card driven by §5.3 (or the caught-up state), with the
  filler state shown; the `S#E##` code appears on this card only when season details are ON.
- **Default (season details OFF):** a **single flat list in real watch order** with the
  canon/mixed/filler badge prominent — no season headers, code hidden. A "Mark up to here"
  action is available per episode, and a single "Mark all watched / unwatch" bulk control
  covers the show.
- **Season details ON:** episodes **regroup into collapsible service seasons** (using
  `service_season_number` / `service_episode_number`); collapse all except the season
  containing "next" — this keeps the rendered DOM small on a phone even at 500 rows. Each
  per-season header shows season progress (canon & all) and **bulk** actions ("Mark season
  watched / unwatch").
- In both modes the flat-vs-grouped switch only adds/removes season headers and the code; it
  never reorders episodes (§5.7).

### 6.3 Episode row/card
The **canon/mixed/filler badge is the primary signal** in every layout. The `S#E##` service
code is shown **only when season details are ON** (otherwise hidden, or rendered as faint
secondary text — implementer's choice, but never the dominant element).
- **Desktop:** compact row — canon/mixed/filler **badge** + title (primary), airdate, watched
  checkbox, and an overflow "⋯ → Mark up to here"; service code shown when season details ON.
- **Mobile:** tap-friendly card — title + **badge** (primary), airdate (secondary), a large
  watched toggle, long-press / overflow for "Mark up to here"; service code shown when season
  details ON.
- **Provenance (source URLs) MUST NOT appear here** or anywhere in the normal viewer.

### 6.4 Settings & Admin
- `GET /settings`: skip-filler default, progress-view default, **season-details default
  (S#E# layout, default OFF — D9)**. All persisted server-side.
- `GET /admin` (token-gated, D4): upload XLSX/CSV → **preview** (detected show, episode
  count, season breakdown, No/Mixed/Yes counts, cross-checked against §3.6 oracle, placeholder
  rows flagged, "new vs update" indication) → **commit**. Plus the **import log** (job
  history with counts/status/errors). Friendly per-row/per-column validation errors — never
  stack traces.

---

## 7. Architecture & homelab deployment (verified against the inventories)

### 7.1 Guest placement — **VM 202 `weeb-screen`** (D1)
- **VM**, Ubuntu 24.04 Noble cloud image, **new guest ID `202`** — `110 fileserver`,
  `120 plex`, `200 plane` (planned), `201 seafile` are taken; **202** is the next free ID.
- Disk on Proxmox storage `vms` (`zeus-datapool/vms`, `recordsize=64K`, lz4).
- Tailnet name `weeb-screen.egret-chimaera.ts.net`; Tailscale **`tag:weebscreen`**; key
  expiry disabled (headless), matching seafile/plex.
- LAN IP via DHCP, **pinned at the router** (matches the fileserver/plex/seafile convention).
- This mirrors the **established Docker-in-VM pattern** (seafile VM 201; planned plane VM 200).
  Docker runs via **`sudo docker`** (`k-admin` is not in the docker group).

### 7.2 Stack — lightweight Docker Compose under `/opt/weeb-screen/`
Two small containers:
1. **app** (the Weeb-Screen server, D8: Node.js LTS + Fastify + better-sqlite3 + server-
   rendered HTML + htmx). Bound to **`127.0.0.1:8787`** (localhost-only high port, matching
   the seafile "app on localhost behind proxy" pattern).
2. **caddy** (reverse proxy + TLS), serving the **Tailscale cert** for
   `weeb-screen.egret-chimaera.ts.net` mounted at `/etc/weebscreen/tls/`, listening on
   `:443` (and `:80` → HTTPS redirect) on all interfaces.

No separate DB server container (SQLite, D2).

### 7.3 Database — **SQLite in a persistent volume** (D2)
- SQLite file in a named Docker volume (e.g. `weebscreen-db:/data`), WAL mode.
- Single-household, low-concurrency, ~500-row tables, old Xeons → SQLite is ideal and
  spares CPU/RAM. **Postgres trigger conditions** (state these, do not adopt now): genuine
  concurrent writers (real multi-profile simultaneous writes at scale), multi-tenant use, or
  datasets growing into millions of rows.

### 7.4 Persistent volumes
- `weebscreen-db` → the SQLite database.
- `weebscreen-data` → uploaded files + import history artifacts.

### 7.5 Exposure — Caddy + Tailscale cert, **LAN + tailnet** (D3)
- Follow the **plex/fileserver LAN+tailnet** model (not seafile's Tailscale-only model).
- Tailnet members reach `https://weeb-screen.egret-chimaera.ts.net` (MagicDNS, valid cert).
- LAN reachability via the firewall allow on `:443`/`:80`. Household devices are already on
  the tailnet, so the MagicDNS name is the recommended day-to-day path on LAN too (valid
  cert). **Caveat to document:** a pure-LAN-by-bare-IP client gets a cert-name mismatch
  (the Tailscale cert is for the MagicDNS name); the mitigation is to use the tailnet name.
- Cert lifecycle mirrors seafile: `/etc/cron.monthly/weebscreen-cert-renew` (renew +
  msmtp alert on failure) and `/etc/cron.daily/weebscreen-cert-expiry-check` (watchdog).

### 7.6 Per-VM Proxmox firewall — `/etc/pve/firewall/202.fw`
Default **DROP in / ACCEPT out**, allow:
- tailnet `100.64.0.0/10`,
- LAN `192.168.0.0/16` → **TCP 443** (and **80** for redirect),
- ICMP.

This is the **plex/fileserver shape** (LAN allow rules present), not seafile's (no LAN rules).

### 7.7 Tailscale ACL additions (same form as existing tags)
Add to `tagOwners`: `"tag:weebscreen": ["autogroup:admin"]`, and an `ssh` accept rule
`{ "action": "accept", "src": ["autogroup:admin"], "dst": ["tag:weebscreen"], "users": ["k-admin"] }`
— mirroring the fileserver/seafile/plex entries.

### 7.8 Alerts — msmtp
Install `msmtp` with the same Gmail App Password relay used on `zeus`/`seafile`; cron jobs
send failure alerts through it.

### 7.9 Backups (mirror the `seafile-backup` cron)
- `/etc/cron.daily/weebscreen-backup`: SQLite **online `.backup`** (WAL-safe) of the DB +
  tarball of `weebscreen-data`; **msmtp alert on failure**. Backups land on the **`personal`**
  dataset via the fileserver SMB share (e.g. a `weebscreen-backup/` subdir, analogous to the
  existing `gabby-backup/`).
- Proxmox **`vzdump`** of VM 202 nightly (guest-level), alongside the app-level backup.

### 7.10 LXC alternative (noted, rejected — D1)
An unprivileged LXC per `base-lxc-setup.md` (`nesting=1,keyctl=1`, UID shift +100000) would
use less overhead on the old CPUs, but Docker-in-unprivileged-LXC is fiddly and breaks from
the established Docker-in-VM pattern. Rejected for consistency and operational simplicity.

---

## 8. API / contracts (proposed, net-new)

> Server-rendered pages + htmx partials; JSON for actions. All mutating routes are
> idempotent where possible. Admin routes require the admin token (D4).

**Viewer (ungated):**
- `GET /` → library page.
- `GET /shows/:slug` → detail page. Honors filter/skip query params and a
  `seasonDetails=<bool>` param (D9, §5.7); default is the persisted setting (flat filler-first
  list when off, season-grouped S#E# when on). The route returns the appropriate layout.
- `GET /shows/:slug/next?skipFiller=<bool>` → JSON `{ next: {real_episode_number, service_episode_code, title} | null, reason }`.
- `POST /shows/:slug/episodes/:realNum/watched` → body `{ watched: bool }`; upserts progress; returns updated row partial/JSON.
- `POST /shows/:slug/seasons/:seasonNum/watched` → body `{ watched: bool }`; bulk season.
- `POST /shows/:slug/watched/up-to/:realNum` → body `{ watched: bool }`; "mark up to here".
- `GET /settings` / `POST /settings` → skip-filler default, progress-view default,
  **season-details default**, and per-show overrides (skip-filler, season-details). Persisted.

**Admin (token-gated, D4):**
- `GET /admin` → admin/import page + import log.
- `POST /admin/import/preview` → multipart file upload (XLSX/CSV); parses, validates, returns
  the preview (detected show, counts, season breakdown, oracle cross-check, placeholder flags,
  new-vs-update); writes an `import_jobs` row with `status='preview'`. **Does not commit.**
- `POST /admin/import/commit` → body `{ job_id }`; commits the previewed job in a transaction;
  updates the `import_jobs` row to `committed`/`failed`.
- `GET /admin/imports` → import log (JSON/partial).

**Token middleware:** all `/admin/*` and `/settings` mutations require header
`X-Weebscreen-Admin-Token` (or a signed admin cookie set after entering the PIN). Missing/wrong
token → `403` (no stack trace).

---

## 9. Acceptance criteria (checkable)

1. **Naruto import is exact:** importing the workbook yields **500 episodes, 21 seasons**,
   `filler_bucket No/Mixed/Yes = 233/64/203`, and the preview's oracle cross-check passes
   (§3.6). All provenance URLs captured on the episode rows.
2. The app **displays Naruto Shippuden as a filler-first flat list by default** (real watch
   order, canon/mixed/filler badge prominent, `S#E##` hidden); **enabling "Season details"
   (D9, §5.7) regroups the same episodes into collapsible service seasons** using
   `service_season_number` / `service_episode_number` with correct `S#E##` codes. The toggle
   is server-persisted (survives refresh and container restart) and never reorders episodes.
3. **Household watched progress persists across browser refresh AND container restart**
   (verified by toggling, restarting the container, re-loading).
4. **Filler filtering works**, and the **skip-filler "next episode"** behaves per §5.3
   (Mixed watched not skipped; correct boundary-crossing; correct end-of-show / only-filler
   states).
5. **Mobile and desktop layouts are both usable** on a ~500-episode show — in both the default
   filler-first flat list and the opt-in season-grouped view (collapsible seasons; no jank).
6. A **second anime** (a CSV using the §10 template) imports and is **tracked separately**
   (its own show, progress, and "next").
7. **Source URLs are stored but never visible** in the normal viewer (present only in
   admin/import surfaces and the DB).
8. The deployment runs on **VM 202 on `zeus`** via Docker Compose, reachable on **LAN and
   Tailscale**, with persistent DB/uploads and a **working daily backup** (test run succeeds).

Data-integrity invariants also checked: `service_episode_code == S{season}E{episode:02d}` for
every row; placeholder title (`S2E21 = "Title"`) imports without error; airdates stored as ISO;
Unicode titles round-trip byte-exact (no mojibake).

---

## 10. Recommended CSV template (stable, UTF-8, going-forward standard)

**Per-episode columns** (header row; UTF-8, no BOM required but tolerated):

```
show_title, show_slug, service_name, real_episode_number,
service_season_number, service_episode_number, service_episode_code,
episode_title, filler_bucket, canon_filler_type, original_airdate,
episode_data_source_url, season_boundary_source_url
```

**Required vs optional (D-csv, builds on D7 and the show-metadata recommendation):**

| Column | Required? | Rules |
|---|---|---|
| `real_episode_number` | **required** | int, unique within show |
| `service_season_number` | **required** | int |
| `service_episode_number` | **required** | int |
| `episode_title` | **required** | UTF-8; placeholders/blanks tolerated |
| `filler_bucket` | **required** | ∈ `{No, Mixed, Yes}` |
| `canon_filler_type` | **required** | free text (recommend the 4 known values) |
| `service_episode_code` | **optional** | **derived** if absent; if present must equal `S{season}E{episode:02d}` (D7) |
| `original_airdate` | optional (recommended) | ISO `yyyy-mm-dd` if present |
| `episode_data_source_url` | optional | admin-only provenance |
| `season_boundary_source_url` | optional | admin-only provenance |
| `show_title`, `show_slug`, `service_name` | **optional in CSV** | come from the **admin upload form**; if present in CSV they must be **constant across all rows** and **match the form** (else a friendly error) |

**Where show-level metadata lives (recommended):** capture `show_title`, `show_slug`,
`service_name`, and source URLs in the **admin upload form**; keep the CSV as **pure
per-episode rows**. This avoids repeating show metadata on 500 rows and avoids fragile
multi-section parsing, while keeping the CSV portable.

**XLSX importer mapping:** read the `Mapping` sheet only (per §3.2), convert `Original Airdate`
Excel datetime → ISO, validate `Netflix #` equals the derived code, carry `Episode Data Source`
and `Seasoning Source` into the two provenance columns, and use `Season Boundaries` + `Summary`
purely as the §3.6 oracle. The `Sources` sheet → `shows.notes` (admin-only). Restate to the
user the two nuances: **real vs service numbering diverge** and **`Original Airdate` is an Excel
datetime**.

---

## 11. Decisions (ADR-lite; proposed — awaiting human ratification)

> Format follows `spec-init.md` §4. **Not** written to any decision log (none exists; this is
> not a full handoff). Listed as **proposed**.

### D1 — Deploy on a new **VM 202 `weeb-screen`** (VM, not LXC)
**Context:** Need a Docker Compose host on `zeus` following homelab convention.
**Decision:** Ubuntu 24.04 VM, **guest ID 202** (next free after 110/120/200/201),
`sudo docker`, behind Caddy. **Recommendation.**
**Alternative:** unprivileged LXC (`base-lxc-setup.md`, `nesting=1,keyctl=1`) — lighter but
Docker-in-LXC is fiddly and off-pattern. Rejected.

### D2 — **SQLite** (not Postgres) for v1
**Context:** Single household, low concurrency, old Xeons.
**Decision:** SQLite in a persistent volume, WAL. **Recommendation.**
**Alternative:** Postgres container — adopt only on the trigger conditions in §7.3. Rejected
for v1.

### D3 — **Caddy + Tailscale cert**, LAN + tailnet exposure
**Context:** Reachable on LAN and Tailscale, internal-only.
**Decision:** Caddy serves the Tailscale cert for the MagicDNS name on `:443`/`:80`; firewall
opens `:443`/`:80` to LAN + tailnet (plex/fileserver model); app on `127.0.0.1:8787`.
**Recommendation.**
**Alternative:** Tailscale Serve (tailnet-only HTTPS, zero cert management) + plain Caddy on
LAN — rejected to keep one unified TLS path matching seafile.

### D4 — Admin gating with **no login**: shared admin token/PIN + network trust
**Context:** v1 has no accounts, but the admin section exposes **file upload + parsing** — a
security-sensitive surface — and shouldn't be casually triggerable.
**Decision:** Network trust (firewall + tailnet) **plus** a shared admin token (env
`WEEBSCREEN_ADMIN_TOKEN`) required for all `/admin/*` actions and config mutations; viewer
watched-toggles stay ungated (household-shared). **Recommendation.** **Security-sensitive —
flag for human read (§12).**
**Alternatives:** network-trust only (simplest, but upload open to anyone on LAN/tailnet) —
rejected; full login/auth — out of scope v1.

### D5 — **Replace-in-place re-import** keyed on `show_slug`, progress preserved
**Context:** Re-importing a show must not wipe watched flags.
**Decision:** Upsert episodes on `(show_id, real_episode_number)`; update in place (stable
`episodes.id`); preserve progress; never delete missing episodes by default (flag + optional
prune); existing slug requires explicit "update existing" confirmation in preview.
**Recommendation.**
**Alternative:** versioned imports (new show per import) — fragments progress. Rejected.

### D6 — **Mixed is watched, not skipped** under skip-filler
**Context:** 64 `Mixed` episodes contain canon.
**Decision:** skip-filler skips only `Yes`; `next` includes `{No, Mixed}`. **Recommendation.**
**Alternative:** skip Mixed too (more aggressive) — loses canon. Rejected (could be a future
per-show option).

### D7 — **`service_episode_code` derived** (validated), optional in CSV
**Context:** Verified `code == S{season}E{episode:02d}` for all 500 rows.
**Decision:** Derive canonically; in CSV it is optional; if supplied it must equal the derived
value; XLSX validates `Netflix #` against the derived value. Store the value for fast display.
**Recommendation.**
**Alternative:** require it explicitly — redundant and typo-prone. Rejected.

### D8 — **App stack: Node.js LTS + Fastify + better-sqlite3 + server-rendered HTML + htmx**
**Context:** Small x86 image, low memory, fast on old Xeons, boring.
**Decision:** Single app container, slim/alpine image; synchronous better-sqlite3 (no DB
server); server-rendered pages with htmx partials for toggles (keeps the 500-row mobile list
light). **Recommendation.**
**Alternatives:** (a) **Go single binary** — leanest image / best on old CPUs, higher build
cost; (b) **Python + FastAPI + SQLModel + Jinja** — equally valid, slightly heavier runtime.
Both noted; either is acceptable if the implementer prefers, provided it stays a single small
x86 image with SQLite.

### D9 — **Filler-first default view; season details (S#E#) are opt-in**
**Context:** The household's main interest is whether an episode is filler or canon, not the
service-season layout. Per user direction, filler status is the primary axis and the `S#E#`
season layout should be an optional view the user can enable.
**Decision:** The detail page defaults to a **flat list in real watch order with the
canon/mixed/filler badge prominent and the `S#E##` code hidden**; a server-persisted
**"Season details" toggle** (global default OFF + optional per-show override, in
`app_settings`) regroups episodes into collapsible service seasons and reveals the code.
Toggling never reorders episodes. Applies generically to all shows (no Naruto hardcoding).
**Recommendation.**
**Alternative:** keep season-grouping as the always-on primary layout (the original draft) —
rejected; it foregrounds the service layout over filler status, contrary to the product focus.
A further option (season details ON by default) is available by changing the seeded
`season_details_default`.

---

## 12. Security-sensitive surfaces — **human read required before deploy**

1. **File upload + XLSX/CSV parsing** (`POST /admin/import/preview`): untrusted file parsing.
   Mitigations to implement and review: enforce a **max upload size** and **row cap**; reject
   `.xlsm`/macros; parse XLSX **read-only with formula evaluation disabled** (zip-bomb / XXE
   safe libs); treat all cell text as data and **HTML-escape on output** (titles carry Unicode
   and could carry markup → XSS); validate types/enums per row with friendly errors; run the
   commit in a **bounded transaction**; gate the whole surface behind the admin token (D4).
2. **New VM + Proxmox firewall** (`/etc/pve/firewall/202.fw`) **+ Tailscale ACL change**
   (`tag:weebscreen` + ssh accept): verify default-DROP-in, that only `:443`/`:80` are opened
   to LAN, and the ACL diff before applying.
3. **Backups** (`weebscreen-backup` cron): a full DB copy leaves the VM and lands on the
   `personal` dataset — confirm destination, permissions, and retention; verify the msmtp
   failure alert fires.
4. **New secret / env var** `WEEBSCREEN_ADMIN_TOKEN`: store in a `600`-perm `.env` (like
   seafile's `/opt/seafile/.env`), **never** commit it, and rotate if exposed. Any session
   secret follows the same handling.

---

## 13. Files Owned (proposed — created by the implementation, not this spec task)

> This spec task creates **only** `weeb-screen-spec.md`. The list below is what the
> **implementation** kickoff will create. All **NEW**.

```
weeb-screen-spec.md                       # NEW: this spec (created now)
app/                                      # NEW: Fastify server, routes, views (htmx), importer
app/db/schema.sql                         # NEW: §4 schema + seeds (profiles Household, app_settings)
app/importer/{xlsx,csv}.*                 # NEW: importers (datetime→ISO, code validate, oracle)
Dockerfile                                # NEW: slim x86 app image
docker-compose.yml                        # NEW: app (127.0.0.1:8787) + caddy (:80/:443) + volumes
Caddyfile                                 # NEW: Tailscale cert at /etc/weebscreen/tls/, reverse_proxy
.env.example                              # NEW: WEEBSCREEN_ADMIN_TOKEN (no real secret committed)
deploy/202.fw                             # NEW: Proxmox firewall (mirror plex/fileserver)
deploy/cron/weebscreen-backup             # NEW: SQLite .backup + data tarball + msmtp alert
deploy/cron/weebscreen-cert-renew         # NEW: monthly Tailscale cert renew (mirror seafile)
deploy/cron/weebscreen-cert-expiry-check  # NEW: daily cert watchdog
deploy/RUNBOOK.md                         # NEW: provision VM 202, ACL, firewall, compose up, backup test
```

### Cross-boundary touch points (flagged, deferred to deploy time — not edited now)
Deploying will require updating **owned inventory docs** (do **not** edit during this spec
task):
- `olympus_hardware_inventory.md` — add the **VM 202 `weeb-screen`** row to the Containers/VMs
  table.
- `olympus_software_inventory.md` — add a **new host section** for VM 202, add `tag:weebscreen`
  to the **ACL `tagOwners` + `ssh`** block, and add the device to the **Devices** table.

These are deliberate crossings to perform during deployment, called out here rather than done
silently.

---

## 14. Tests (surfaces that need coverage)

- **XLSX importer:** datetime→ISO; `Netflix #` == derived code; Unicode round-trip
  (U+2019/U+2013/U+00C9/U+016B byte-exact); placeholder title (`S2E21="Title"`) accepted;
  oracle counts 233/64/203, 21 seasons, 500 total.
- **CSV importer:** template parsing; optional `service_episode_code` derived/validated;
  show-level columns optional but, if present, constant + matching the form; friendly
  per-row/column errors.
- **Re-import:** progress preserved across replace-in-place (toggle, re-import, assert watched
  intact); missing-episode flagging; "update existing" confirmation required.
- **Skip-filler `next`:** Mixed included, Yes excluded; correct season-boundary crossing;
  end-of-show null; only-filler-remaining state.
- **Filters:** bucket × unwatched combination logic.
- **Display mode (D9):** default is the flat filler-first list with the badge prominent and the
  `S#E##` code hidden; enabling "Season details" regroups by service season and reveals the
  code; the same episodes appear in the same real-watch order in both modes (no reordering); the
  toggle is server-persisted (global default + per-show override) and survives restart.
- **Progress:** canon vs all counts per show and per season.
- **Provenance hiding:** source URLs absent from all viewer routes/markup; present in admin/DB.
- **Persistence (integration):** progress survives container restart.
- **Auth:** `/admin/*` rejects missing/wrong token (403, no stack trace).
- **Multi-anime:** a second show is tracked fully independently.

---

## 15. Out of scope (non-goals — stated explicitly)

- No public internet exposure / no port forwarding.
- No account login/authentication in v1 (admin is token-gated only, D4).
- No streaming / video playback.
- No internet scraping of anime data in v1 (data comes only from uploads).
- No heavy media-server integration in v1.
- No Plex integration in v1 (future idea only).
- No per-user profiles in v1 (schema is profile-ready; only the seeded Household is used).
- This spec task does **not** write app code, deploy to `zeus`, decompose into tickets, or
  edit any decision log / inventory doc.
```
