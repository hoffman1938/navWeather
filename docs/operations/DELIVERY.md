# Delivery: environments, CI/CD, testing strategy, disaster recovery

> **Update 2026-10-04 ([ADR-016](../architecture/decisions/ADR-016-all-on-cloudflare-workers.md)):** environments become
> `dev` (localhost: Vite + Cloudflare Vite plugin with local Durable Objects/D1/R2 + Docker for engines), `preview`
> (own Worker, Durable Objects, D1, R2 — never production data) and `production`; one E2E suite must pass on localhost
> and on preview (REQ-DEV-001). Fallbacks come from our own engines
> (another regional instance) and stale caches. See [DEVELOPMENT_PLAN §2](../DEVELOPMENT_PLAN.md), tasks DP-2.x and DP-3.x.

## 1. Environments

| Env | How | Config | Data |
| --- | --- | --- | --- |
| local | `npm run dev` (Vite :5173) + `npm run dev:api` (wrangler dev :8787, local DO state in `.wrangler/`) | `.env` (optional, public `VITE_*` only), `.dev.vars` (Worker secrets, git-ignored) | local |
| PR preview | `wrangler versions upload` → preview URL (deploy workflow, manual) | same as production unless `--env preview` is added | production DO namespaces — **add `[env.preview]` with its own bindings before previews touch real users' shares** |
| staging | `wrangler deploy --env staging` (to add) | own D1/KV ids when they exist | synthetic |
| production | `wrangler deploy` (manual or `deploy.yml`) | `wrangler.toml` + `wrangler secret` | real |

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
`preview` (versions upload, no traffic) or `production` (deploy). Requires
repository secrets `CLOUDFLARE_API_TOKEN` (scoped: Workers Scripts edit,
Durable Objects, account read) and `CLOUDFLARE_ACCOUNT_ID`; runs the same
checks first. Switch production to "on push to main" once previews are routine.

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
