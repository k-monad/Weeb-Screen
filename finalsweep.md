# Final Production Sweep

## Deploy Readiness

Status: deployable after fixes. I found and fixed one major functional bug during the sweep, then removed the vulnerable XLSX upload parser surface. I did not find any remaining critical app/runtime issue in lint, typecheck, tests, build, compose rendering, or Docker runtime smoke.

## Major Issue Fixed

- Fixed `getShowDetail` binding SQLite parameters in the wrong order.
  - Impact before fix: once more than one show existed, `/shows/:slug` for a non-first show could render the first show's episode rows under the requested show's header. This was masked by tests because `show.id` and `profile_id` were both `1`.
  - Fix: `src/db/repositories.ts` now binds `PROFILE_ID` before `show.id`, matching the SQL placeholder order.
  - Regression: `tests/viewer/viewer.test.ts` now covers multiple shows and verifies the requested show's episode rows are rendered.

## High-Risk Item Fixed

- Removed `xlsx@0.18.5`, which had two high-severity production advisories:
  - Prototype Pollution in SheetJS, advisory `GHSA-4r6h-8v6p-xvw6`.
  - SheetJS ReDoS, advisory `GHSA-5pgg-2g8v-p4x9`.
- Disabled spreadsheet uploads in `/admin/import/preview`; `.xlsx` and `.xlsm` now fail with an explicit CSV export message.
- Admin imports are CSV-only in the UI, parser exports, import format type, and new-install schema.

## Validation Run

- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- `pnpm test`: pass, 4 files / 22 tests.
- `pnpm build`: pass.
- `pnpm audit --prod`: pass after removing `xlsx`.
- Compiled runtime smoke: pass; `/healthz` OK, `/admin` rejects missing token, `/admin` accepts header token.
- `docker compose config`: pass with expected app, Caddy, volume, env, and loopback app port wiring.
- `docker build -t weeb-screen-finalsweep .`: pass.
- Container runtime smoke from rebuilt image: pass; `/healthz` OK, `/admin` rejects missing token, `/admin` accepts header token.

## Non-Blocking Notes

- Admin preview UI dot-separator encoding artifact was replaced with ASCII separators.
- Removed unused `src/admin/importSessions.ts`.
- Local sweep cannot verify VM-only steps: Tailscale cert issuance/renewal, Proxmox firewall installation, cron installation, backup destination permissions, or msmtp alert delivery. Those should still be checked during the human deploy runbook.
