# Working on navWeather (for AI assistants and new engineers)

navWeather is a **navigation + route + time + weather + prediction + alerts**
platform: for every part of the actual route it works out where you will be,
when, and the forecast there at that time, and warns before significant
weather. It is not "a map site" or "a weather site" — keep that direction.

## Session start protocol (every session, before significant work)
1. **Read** [docs/PROJECT_REQUIREMENTS.md](docs/PROJECT_REQUIREMENTS.md) — the
   single source of truth for what the system *should* be.
2. Read the relevant [ADRs](docs/architecture/decisions/README.md) and
   architecture docs ([current](docs/ARCHITECTURE.md), [target](docs/architecture/TARGET_ARCHITECTURE.md)).
3. Inspect the implementation and its tests — the code is the truth for what
   the system *currently is*.
4. Write down CURRENT STATE → TARGET STATE → GAP for the task, and a short plan.
5. Check the change against: requirements, Cloudflare-first (ADR-001),
   API compatibility (ADR-009), future iOS/Android/CarPlay/Android Auto,
   privacy, security, licensing (docs/legal), performance, cost, scalability.
   If any answer is "no" or unclear, stop and resolve it before coding.

## Change control
- New/changed requirement → update PROJECT_REQUIREMENTS **first**; an ADR if
  architecturally significant (new provider, table, endpoint, Cloudflare
  service, auth method, caching layer); then code, tests, docs.
- Never silently change architecture. If this file, the requirements and a
  request conflict: name the conflict, find which is newer, update the docs,
  then continue.
- Update requirement **status** columns in the same commit as the code.
- End of task: requirements still accurate? ADR needed? API/DB/env/licence
  docs updated? tests present? debt recorded?

## Rules that must not be broken
- **Only hosting is paid; free for users (ADR-015, owner, 2026-10-04):**
  the owner pays for hosting (compute, storage, bandwidth, CDN, domain) and nothing else. Never add a paid API
  plan, key, per-request fee, paid data, store account or paid feature; no ads or subscriptions; no sponsors,
  grants or credits. Every third-party component is free software or open data with its licence recorded, and it
  must be **free always, at any scale, in development too**: only our own instances of free software, open data
  files downloaded on a fixed schedule, or services with no limit and no paid tier (OpenFreeMap fallback, browser
  capabilities). Never add a free tier with a request limit, a key with a quota, a trial or a public demo server —
  not even "for now" or "in development" (FREE_STACK_PLAN §1.1). Development runs the stack locally in Docker at $0.
  Target scale: Google-Maps-class. Work follows **`docs/DEVELOPMENT_PLAN.md`** (tasks `DP-x.y`; driver safety first).
- **Hosting = Cloudflare Workers, not Pages (ADR-016):** static assets, R2, D1, Durable Objects, Queues, Cron,
  Containers in one Worker project; `wrangler.toml` environments `dev` / `preview` / `production`.
- **Localhost parity (REQ-DEV-001):** every feature must work on `http://localhost` with no Cloudflare account and
  no money (Vite + Cloudflare Vite plugin with local bindings, Docker for engine containers, local seed data) **and**
  on the preview Worker. A change verified in only one of the two is not done.
- Only real data: no source → "not available"; simulations labelled; driver
  reports are "reported", never fact. Weather wording: forecast vs derived
  estimate vs official warning (docs/architecture/WEATHER_ENGINE.md §6).
- No location history on the server; route history (if ever) is opt-in.
- No secrets in the client: `VITE_*` values are public.
- Respect provider terms (docs/legal/LICENSING_MATRIX.md) while the current code still calls public
  services (until DEVELOPMENT_PLAN stage 6 removes them): public OSRM ≤1 req/s, Nominatim no autocomplete, Overpass
  light use, Open-Meteo free is non-commercial and <10k calls/day for the whole app, Transitous non-commercial +
  open source, attribution everywhere. Never add new calls to such services.
- Navigation and safety-critical calculations stay deterministic; AI may
  only explain or translate requests into deterministic calls.
- Engines (`src/algorithms`, `src/intelligence`, `src/navigation`, `src/types`)
  must not import React or the DOM — they are the future mobile core.

## Commands
```
npm run dev          # app on :5173 + Worker on :8787 (one command; the dev server proxies /api)
npm run dev:web      # only the app        npm run dev:api   # only the Worker (live share, reports, whereami, trips)
npm run preview:worker   # production build served by the Worker on :8787 (as deployed)
npm test             # vitest (unit + scenarios)
npm run typecheck    # app + Worker
npm run build        # production build
npm run test:share   # Worker smoke (needs the Worker on :8787); API=/api for legacy paths
npm run test:reports
```

## Git workflow (owner's instruction, 2026-10-02)
Work on branch **`claude/navweather-dev`**; commit every finished change there
and push it. Commit messages: what and why; reference requirement IDs.

## Map of the docs (only current documents; history lives in git)
- Requirements: `docs/PROJECT_REQUIREMENTS.md`
- **The single work plan: `docs/DEVELOPMENT_PLAN.md`** (stages 0–13, tasks DP-x.y with localhost and Workers checks,
  release gates G1–G13, risks, owner decisions) — ADR-015, ADR-016
- Catalogue of free replacements, Google Maps gaps and Cloudflare placement: `docs/FREE_STACK_PLAN.md` (§1.1 "always
  free" rule, §6a Cloudflare)
- Defect register `B-xx`: `docs/AUDIT/DEFECTS.md` · documentation audit and cleanup: `docs/AUDIT/2026-10-04-docs-audit.md`
- Decisions: `docs/architecture/decisions/` · Target architecture, weather engine, maps/routing/GIS: `docs/architecture/`
- Current implementation: `docs/ARCHITECTURE.md` · Environment: `docs/ENVIRONMENT.md` · Testing: `docs/TESTING.md`
- API: `docs/api/API_V1.md` · Data: `docs/database/DATA_MODEL.md`, `database/migrations/`
- Security: `docs/security/SECURITY.md` · Privacy, licensing: `docs/legal/`
- Mobile/CarPlay/Android Auto: `docs/mobile/` · UX/SEO/analytics/i18n: `docs/product/`
- Cost & scale, CI/CD, DR: `docs/operations/`
- Feature specs (source of truth per feature): `docs/features/` (Long Trip Mode)
- Language: ADRs and technical specs in English; plans, audits and the catalogue in Russian.
