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
- **Zero cost, free for users (ADR-014, owner, 2026-10-03):** never add a paid plan, key, hosting, domain,
  store account or paid feature; no ads or subscriptions. Free tiers only; the core must keep working when our
  Worker quota is exhausted. Work follows `docs/PRODUCTION_READINESS_PLAN.md`.
- Only real data: no source → "not available"; simulations labelled; driver
  reports are "reported", never fact. Weather wording: forecast vs derived
  estimate vs official warning (docs/architecture/WEATHER_ENGINE.md §6).
- No location history on the server; route history (if ever) is opt-in.
- No secrets in the client: `VITE_*` values are public.
- Respect provider terms (docs/legal/LICENSING_MATRIX.md): public OSRM ≤1
  req/s, Nominatim no autocomplete, Overpass light use, Open-Meteo free is
  non-commercial and <10k calls/day for the whole app, Transitous non-commercial
  + open source, attribution everywhere.
- Navigation and safety-critical calculations stay deterministic; AI may
  only explain or translate requests into deterministic calls.
- Engines (`src/algorithms`, `src/intelligence`, `src/navigation`, `src/types`)
  must not import React or the DOM — they are the future mobile core.

## Commands
```
npm run dev          # app on :5173
npm run dev:api      # Worker (live share, reports, whereami) on :8787 — the dev server proxies /api
npm test             # vitest (unit + scenarios)
npm run typecheck    # app + Worker
npm run build        # production build
npm run test:share   # Worker smoke (needs dev:api); API=/api for legacy paths
npm run test:reports
```

## Git workflow (owner's instruction, 2026-10-02)
Work on branch **`claude/navweather-dev`**; commit every finished change there
and push it. Commit messages: what and why; reference requirement IDs.

## Map of the docs
- Requirements: `docs/PROJECT_REQUIREMENTS.md` · Roadmap/MVP: `docs/ROADMAP.md`
- Decisions: `docs/architecture/decisions/` · Target architecture, weather
  engine, maps/routing/GIS: `docs/architecture/`
- API: `docs/api/API_V1.md` · Data: `docs/database/DATA_MODEL.md`, `database/migrations/`
- Security: `docs/security/SECURITY.md` · Privacy, licensing: `docs/legal/`
- Mobile/CarPlay/Android Auto: `docs/mobile/` · UX/SEO/analytics/i18n: `docs/product/`
- Cost & scale, CI/CD, testing, DR: `docs/operations/`
- Feature specs (source of truth per feature): `docs/features/` (Long Trip Mode)
- **Path to production: `docs/PRODUCTION_READINESS_PLAN.md`** (stages, tasks PR-x.y, release gates G1–G12)
- Latest audit: `docs/AUDIT/MASTER_AUDIT.md` (2026-10-03: status of every requirement, confirmed defects `B-xx`),
  with `docs/AUDIT/FEATURE_GAP_ANALYSIS.md` and `docs/AUDIT/IMPLEMENTATION_ROADMAP.md`;
  previous: `docs/AUDIT/2026-10-02-platform-audit.md`
- Product iteration log (Russian): `docs/PLAN.md`
