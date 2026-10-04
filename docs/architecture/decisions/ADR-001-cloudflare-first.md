# ADR-001 — Cloudflare-first, one Worker with static assets (not Pages)

**Status:** Accepted · **Date:** 2026-10-02

## Context
The owner requires a Cloudflare-first architecture and described hosting as
"Cloudflare Pages". The repository already deploys **one Cloudflare Worker
with static assets** (`wrangler.toml` `[assets]`, `run_worker_first = ["/api/*"]`)
that serves the SPA from `dist/` and runs the API, two SQLite-backed Durable
Objects (`LiveShare`, `Reports`) and three rate-limiting bindings.

## Options
1. Cloudflare Pages (+ Pages Functions) for app and API.
2. Workers with static assets (current).
3. Pages for the app + a separate Worker for the API.
4. Non-Cloudflare hosting (Vercel, AWS, Firebase…).

## Decision
Keep **Workers with static assets** as the single deployable. Use other
Cloudflare products only when a written trigger occurs
([TARGET_ARCHITECTURE](../TARGET_ARCHITECTURE.md) §2). External services only
where Cloudflare cannot provide the capability (routing engine data, weather
models, map data), each recorded in its own ADR.

## Reason
- Cloudflare's migration guide: Workers has "a distinctly broader set of
  features… (including Durable Objects, Cron Triggers, and more comprehensive
  Observability)"; Durable Object classes, cron triggers, queue consumers and
  rate limiting are Workers features. The live-share relay and reports need DOs.
- Workers static assets support `_headers`/`_redirects` (our CSP lives in
  `public/_headers`), and static asset requests are not billed.
- One deployable = one version, one rollback, no CORS between app and API.

## Consequences
- "Pages" in the brief is satisfied in spirit (Cloudflare static hosting) but
  the product is a Worker; docs say so explicitly.
- Free plan: 100,000 Worker requests/day, 10 ms CPU per invocation, 50
  subrequests, 5 cron triggers per account. Static assets don't count. Public
  beta needs Workers Paid ($5/month minimum) — see COST_AND_SCALE.
- A custom domain is needed for WAF/zone rate-limiting rules and (probably) the
  Cache API.

## Alternatives rejected
- **Pages:** would need a second Worker anyway for Durable Objects; fewer features.
- **Split Pages + Worker:** two deployables, CORS/CSRF complexity, no benefit.
- **AWS/Vercel/Firebase:** no capability gap justifies leaving Cloudflare.
