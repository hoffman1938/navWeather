# ADR-016 — All hosting on Cloudflare: Workers (not Pages) + R2 + D1 + Durable Objects + Queues + Cron + Containers; every part also runs on localhost

**Status:** Accepted · **Date:** 2026-10-04 · **Decision by:** owner
**Extends:** [ADR-001](ADR-001-cloudflare-first.md) (one Worker with static assets, not Pages) ·
**Implements the hosting part of:** [ADR-015](ADR-015-free-software-own-hosting.md) ·
**Revised accordingly:** [ADR-004](ADR-004-routing-engine.md), [ADR-006](ADR-006-map-stack.md), [ADR-007](ADR-007-data-storage.md),
[ADR-011](ADR-011-public-transport.md), [ADR-013](ADR-013-trip-planner.md) · **Plan:** [DEVELOPMENT_PLAN](../../DEVELOPMENT_PLAN.md) · **Catalogue:** [FREE_STACK_PLAN §6a](../../FREE_STACK_PLAN.md)

## Context
ADR-015 allows exactly one cost — hosting — and requires every third-party API and data source to be free forever.
On 2026-10-04 the owner asked whether the whole project (app **and** servers) can run on **Cloudflare Pages**, with
a custom domain connected later, and required that everything keeps working on **localhost** while it is deployed to
Workers for testing.

Facts verified 2026-10-04 (official docs; links in DEVELOPMENT_PLAN §12):
- **Pages vs Workers:** Workers has a "distinctly broader set of features". Not in Pages: Cron Triggers, Queue
  consumers, the rate-limiting binding, Workers Logs / Logpush / Tail Workers, gradual deployments, the Cloudflare
  Vite plugin; Durable Objects only through a separate Worker. Containers are bound through Workers/Durable Objects.
- **Workers runtime:** 128 MB memory per isolate; Free — 100,000 requests/day, 10 ms CPU, 20,000 static files per
  version; **Paid** — no daily request cap, CPU 30 s by default and up to 5 min, cron up to 15 min, 100,000 static
  files per version (25 MiB each); requests to static assets are free and unlimited on both.
- **Containers:** generally available since 2026-04-13; **Workers Paid only**; instance types up to 4 vCPU,
  12 GiB memory, 20 GB disk; **disk is ephemeral** (snapshots or FUSE to R2 for persistence); cold start ~1–3 s;
  billed only while running (scales to zero); account concurrency 1,500 vCPU / 6 TiB memory / 30 TB disk;
  egress $0.025/GB in North America/Europe (1 TB/month included). Local development: `wrangler dev` or `vite dev`
  builds and runs the containers with Docker.
- **D1:** 10 GB per database, 50,000 databases per account, FTS5 full-text search supported.
- **R2:** object storage with free egress (pay for storage and operations).
- **Cache API:** no effect on `*.workers.dev`; works on a custom domain.
- **Cloudflare Vite plugin:** runs the Worker inside workerd in the Vite dev server with real bindings (Durable
  Objects, D1, R2, KV, Queues emulated locally), builds static assets and SPAs.

## Options
1. Cloudflare Pages (+ Pages Functions) for everything.
2. **Cloudflare Workers with static assets + R2 + D1 + Durable Objects + Queues + Cron + Containers**.
3. Cloudflare for the app and real time, rented servers elsewhere for the heavy engines.

## Decision
Option 2, with option 3 kept only as a measured fallback (see Consequences).

1. **One Cloudflare account, one Worker project (not Pages)** serving the PWA from static assets and `/api/v1/*`.
   The custom domain is attached to this Worker when the owner buys it; until then `*.workers.dev`.
2. **Component → Cloudflare product** (details in FREE_STACK_PLAN §6a):
   - PWA, small regional tile sets, borders, static data → **static assets** (free, unlimited requests).
   - Map tiles for larger areas (PMTiles), places tiles, weather cells, imagery, terrain → **R2**, served by the
     Worker with range requests and, once the domain exists, the **Cache API**.
   - Live sharing, driver reports, push fan-out state → **Durable Objects** (SQLite), sharded by region.
   - Accounts, synced places/lists, places and geocoder indexes (FTS5) → **D1**, one database per region/country.
   - Data pipelines and refresh jobs → **Cron Triggers** + **Queues**; builds that need more than a Worker →
     **Containers** jobs or GitHub Actions (public repository).
   - Engines: Valhalla, MOTIS, LibreWXR (and Photon if the D1 geocoder is not enough) → **Containers**, one
     instance group per region, behind Worker routes with per-client rate limits.
   - Weather: model files are turned into per-cell forecast files in **R2** by a pipeline (not a long-running
     Open-Meteo server, which does not fit 20 GB of ephemeral disk with many models); the Worker serves cells.
   - Observability: **Workers Logs** (no coordinates), **Analytics Engine** for counters; **Turnstile** for abuse.
3. **Plans:** development and owner testing on **Workers Free** as long as no Containers are needed; **Workers
   Paid** ($5/month + usage) from the moment the first engine runs in Containers — the first hosting expense.
4. **Localhost parity (binding rule):** every feature must run on a developer machine with no Cloudflare account
   and no money: `npm run dev` = Vite + Cloudflare Vite plugin (Worker, Durable Objects, D1, R2, Queues emulated
   locally) + Docker for the same container images; local seed scripts load the regional data into local D1/R2;
   cron jobs are triggered locally on demand. The same Playwright suite runs against `http://localhost` and the
   preview Worker URL. A change that works only in one of the two is not done.
5. **Environments in `wrangler.toml`:** `dev` (local), `preview` (own Worker, Durable Object namespaces, D1, R2 —
   never production data), `production`. Secrets via `wrangler secret`, local ones in `.dev.vars` (git-ignored).

## Reason
Pages cannot host the real-time and scheduled parts, nor the engines; Workers can do everything Pages does and
more, on the same account, price and domain. Keeping all hosting on one platform gives one bill, one deployment,
one set of rate limits and logs, and the owner's requirement of "everything on Cloudflare" is met as far as the
platform's limits allow.

## Consequences
- **B-23** (Long Trip planner over 10 ms CPU) disappears on Workers Paid; moving the planner to the client stays
  useful for offline use. **B-22** (Cache API on `workers.dev`) disappears with the custom domain; until then
  shared data comes from R2/D1/static assets.
- PROJECT_REQUIREMENTS §6: REQ-CF-007 (Workers Paid), REQ-CF-011…018; §13: REQ-SEC-007 (WAF on the custom domain).
- **Scale risk:** one container is at most 4 vCPU / 12 GiB / 20 GB ephemeral disk. Regional engines fit
  (Georgia/Caucasus); a planet routing graph or a planet Photon index (≈95 GB disk, ≥64 GB RAM) does not fit one
  instance. Plan: region-sharded engines (one graph per region with overlap; Valhalla tiles loaded from R2 to be
  evaluated), D1/FTS5 geocoder per country. If the pilot (DEVELOPMENT_PLAN DP-5.6) shows the limits or the
  account concurrency (1,500 vCPU) are insufficient, the heavy engines move to rented servers (option 3) — still
  hosting, recorded in a new ADR.
- Ephemeral container disk → engine data (graphs, indexes, timetables) is baked into the image or pulled from R2
  at start; cold starts are part of capacity planning.
- Local development needs Docker; CI uses the same images.

## Alternatives rejected
- **Pages:** no cron, queues, rate-limiting binding or logs; Durable Objects only via a second Worker; no
  Containers — the engines and real time could not run.
- **Leave Cloudflare now:** the platform covers the regional launch; leaving is only justified by measured limits.
