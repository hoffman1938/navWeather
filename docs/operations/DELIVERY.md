# Delivery: environments, CI/CD, testing strategy, disaster recovery

> **Update 2026-10-04 ([ADR-016](../architecture/decisions/ADR-016-all-on-cloudflare-workers.md)):** environments become
> `dev` (localhost: Vite + Cloudflare Vite plugin with local Durable Objects/D1/R2 + Docker for engines), `preview`
> (own Worker, Durable Objects, D1, R2 — never production data) and `production`; one E2E suite must pass on localhost
> and on preview (REQ-DEV-001). Fallbacks come from our own engines
> (another regional instance) and stale caches. See [DEVELOPMENT_PLAN §2](../DEVELOPMENT_PLAN.md), tasks DP-2.x and DP-3.x.

## 1. Environments

| Env | How | Config | Data |
| --- | --- | --- | --- |
| local | `npm run dev` (Vite :5173 + wrangler dev :8787 in one command, local DO/D1 state in `.wrangler/`); `npm run seed:local` (our data), `npm run engines:up` (Valhalla in Docker — Colima or Docker Desktop); `npm run preview:worker` for the production build | `.env` (optional, public `VITE_*` only), `.dev.vars` (Worker secrets, git-ignored) | local |
| preview | `npm run deploy:preview` = `wrangler deploy --env preview` (or the Deploy workflow) → Worker `navweather-preview` on `*.workers.dev` | `[env.preview]` in `wrangler.toml` | its own Durable Objects (separate Worker), D1 `navweather-geo-preview`, R2 `navweather-weather-preview`, rate-limit namespaces 2001–2009 — never production data (DP-2.2) |
| production | `npm run deploy:production` = `wrangler deploy --env production` (or the Deploy workflow) → Worker `navweather` | `[env.production]` + `wrangler secret --env production` | real; D1 `navweather-geo-production`, R2 `navweather-weather-production`, namespaces 3001–3009 |

The top level of `wrangler.toml` is the local `dev` environment (Worker `navweather-dev`); a plain `wrangler deploy`
would create that separate Worker, never touch production. Bindings are repeated per environment (wrangler does not
inherit them); `npm run check:envs` (in CI) fails when the three drift apart or share a resource. Logs (DP-3.3):
observability on, **invocation logs off** (they would record request URLs: share ids, coordinates in `/weather` and
`/geocode` queries), query strings redacted from traces; the Worker writes no logs of its own.

Variables: `VITE_*` are compiled into the public bundle (documented in
`.env.example`, `docs/ENVIRONMENT.md`) — **never secrets**. Server secrets
(future: `OPEN_METEO_API_KEY`, email API key) via `wrangler secret put`, read
from `env` in the Worker only.

## 2. CI/CD (GitHub Actions)

`.github/workflows/ci.yml` — on every push and pull request:
```
npm ci → typecheck (app + Worker) → unit/scenario tests (vitest)
       → production build → wrangler dev (local) → share + reports smoke tests on /api/v1 and /api
```
`.github/workflows/deploy.yml` — manual (`workflow_dispatch`), choose
`preview` or `production`: environment check, typecheck, tests, our data (places tiles and search index for
Georgia), build, `wrangler deploy --env <target>`, the search index into that environment's D1, and — for preview,
when the repository variable `PREVIEW_URL` is set — every Worker smoke test against it (`BASE_URL`, DP-3.5; never
against production: they create shares and reports). Requires repository secrets `CLOUDFLARE_API_TOKEN` (Workers
Scripts, Durable Objects, D1, R2 edit; account read) and `CLOUDFLARE_ACCOUNT_ID`. Switch production to "on push to
main" once previews are routine.

`.github/workflows/weather.yml` — every hour: new ECMWF/GFS runs in the Open-Meteo archive → our forecast tiles
into production's R2 (`npm run data:weather -- --env production`; manual runs for preview). Ends at once without
credentials or new runs.

`.github/dependabot.yml` — weekly npm and Actions updates.

Planned: ESLint step (REQ-CI-003); Lighthouse CI on the preview URL; license
check before commercial release; D1 migrations step (`wrangler d1 migrations
apply --remote` before deploy) when D1 exists — migrations must be backward
compatible with the running version (expand → migrate → contract).

Rollback: `wrangler rollback` to the previous version; DO storage is not
rolled back (protocols are versioned and additive for that reason).

## 3. Testing strategy

| Layer | Tooling | Exists | Next |
| --- | --- | --- | --- |
| Unit (engines, utils, protocols) | vitest | 65 files, 586 tests (2026-10-03) | keep ≥ current coverage for every engine change |
| Scenario / integration (store end-to-end with fake providers, Tbilisi → Batumi fixtures) | vitest + harness | yes | more international/timezone fixtures |
| API (Worker) | `scripts/*-smoke.mjs` against wrangler dev | share 7 checks, reports 5 checks, both prefixes | add to CI (done) |
| Live providers | `npm run test:live` (opt-in) | partial | run weekly in CI with a budget |
| E2E browser | — | none | Playwright: search → route → simulate → arrive; transit plan; offline |
| Accessibility | axe-core (manual run 2026-10-02) | 0 violations | automate in Playwright (DP-11.4) |
| Performance | — | none | Lighthouse CI on preview |
| Security | review rounds (code audits) | yes | dependency audit in CI (DP-11.6); security review DP-11.9; WAF on the domain (DP-12.1) |
| Mobile | — | — | device lab / real devices before public beta (REQ-TEST-004) |

**Special cases** (REQ-TEST-003) and where they stand:

| Case | Covered by |
| --- | --- |
| Route crosses a time zone | `timezone.test.ts`, timeline/sun tests — add a full Georgia→Turkey scenario |
| Weather provider failure | `WeatherService.test.ts` (stale fallback), store tests |
| Route recalculation | `store.test.ts`, `roads.test.ts` |
| GPS drift / bad signal / tunnel | deviation + progress tests (accuracy gating, persistence) — add tunnel (no fixes for 2 min) scenario |
| Offline mode | manual (2026-10-02) — automate in Playwright (DP-11.3) |
| Duplicate alerts | `weatherAlerts.test.ts`, `driverAlerts.test.ts` |
| Forecast update during a drive | store refresh tests (model-update reason) |
| Long route (>1,000 km) | sampling budget tests — add an end-to-end fixture |
| International route | — (add) |
| Public transport timetable | `TransitousProvider.test.ts` (recorded Tbilisi answer), `travelModes.test.ts` |
| Rate limiting of public routers | `OSRMProvider.test.ts` |

## 4. Disaster recovery

| Asset | What Cloudflare does | What we must do |
| --- | --- | --- |
| Worker code | keeps previous versions; `wrangler rollback` | tag releases in git; CI builds are reproducible from `package-lock.json` |
| Live shares (DO) | durable storage, replicated by Cloudflare | none — data expires within 24 h by design |
| Reports (DO) | durable | none — expires within hours; losing it degrades a feature only |
| D1 (future) | **Time Travel**: restore to any minute within 7 days (Free) / 30 days (Paid) | weekly export to R2 (Cron) for longer retention; test a restore quarterly |
| KV / Cache (future) | caches — rebuildable | none |
| Configuration | in git (`wrangler.toml`, `_headers`, `.env.example`) | secrets listed (names only) in `docs/ENVIRONMENT.md`; re-create from the providers' consoles |
| Engines and data | Containers restart; R2/D1 are durable | another regional instance; stale weather cells with a label; OpenFreeMap tile fallback; pipelines rebuild data |

Incident response: SECURITY §7. A Cloudflare-wide outage takes the app down
for new visits; installed PWAs open from the shell cache but need the network
for routes and forecasts — this is accepted and stated.
