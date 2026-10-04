# Platform audit — 2026-10-02

Scope: the whole repository (`hoffman1938/navWeather`, branch
`claude/navweather-dev` from `main` @ 92cf604), its Cloudflare configuration,
docs (README, ARCHITECTURE, AUDIT, PLAN, TESTING, ENVIRONMENT), and every
external dependency's current terms. External facts were verified against
official sources on 2026-10-02; anything not verifiable is marked **REQUIRES
VERIFICATION**. This report is the entry point; detail lives in the linked
documents, which together form the project's permanent documentation.

---

## 1. Executive summary

navWeather is already a capable, well-tested web navigator whose core — the
forecast **at each place at your arrival time**, along every road option, with
deduplicated alerts — is implemented as pure TypeScript engines (548 tests).
Architecture quality is high: provider interfaces, privacy by design, no
server-side location history, honest labelling of estimates and reports.

The gaps are not features. They are **terms, operations and scale**:
1. It runs on free public services whose terms are non-commercial and/or
   fair-use (OSRM demo, FOSSGIS, Overpass, Nominatim, Photon, Transitous,
   Open-Meteo free). Fine for development; **not for a public launch**.
2. The **Open-Meteo free tier is exceeded at the application level at ~30
   daily users** (≈350 weighted calls per active user per day) — earlier than
   anyone would expect. A shared edge cache with a paid key is the fix and also
   what makes weather cost sub-linear in users.
3. Two policy breaches were found and **fixed today**: requests to public OSRM
   servers could exceed 1 request/second (now one queue per server), and the
   FOSSGIS attribution + "Report a map error" link were missing (added).
4. The API was unversioned; it is now **`/api/v1`** with the old paths kept as
   aliases (tested both ways).
5. No CI, no monitoring, no legal pages, no licence. CI is added; the rest is
   planned with owner decisions listed (Georgian UI, open-sourcing, commercial
   timing, speed-camera default).

Recommended path: Phase 1 (compliance) → Phase 2 private beta with an edge
weather cache → Phase 3 public beta on self-hosted Valhalla/Photon → native
apps after a stack spike (ADR-010). Cloudflare covers everything except the
routing engine data and weather models (ADR-001/004/005).

## 2. Product audit

Strengths: unique combination (route × time × forecast × alerts); calm UI;
per-road weather comparison; best time to leave; low-sun glare; time-zone
changes; elevation with temperature at passes; weather-aware re-route offers;
driver reports with honest labels; live sharing; public transport (Tbilisi)
since 2026-10-02.
Weaknesses: no traffic (no free source); web cannot navigate in the
background; geocoding ambiguity (e.g. "Tavisupleba Square" → Kobuleti);
intercity public transport returns nothing for Georgia today.

### Comparison with PLAN.md (status)

| Area (PLAN.md) | Status | Note |
| --- | --- | --- |
| P0 core (map, search, route, ETA, sampling, weather at arrival, timeline, navigation, deviation, alerts, mobile, PWA, live share) | **DONE** | verified by tests |
| P1 iterations 3–5 (side panel, departure planner, AQI chip, compass, time zones, glare, cameras, parking, transliteration, alternatives on map, saved-place icons, categories, elevation profile, weather layer, road hazards, EV sockets, weather re-route, resume drive, 3D buildings, driver reports, voice) | **DONE** | |
| Offline | **PARTIALLY DONE** | shell + loaded route only (correct for web; regions are native-only, ADR-012) |
| Driver-report moderation, legal review | **MISSING** | P2 in PLAN |
| `traffic_calming` events, native ru/ka review, real-device tests | **MISSING** | P1 in PLAN |
| Self-hosted OSRM/Valhalla, PMTiles regions, terrain | **MISSING** | P2 in PLAN; ADR-004/006 |
| Speed cameras "off by default" (PLAN §1, §5) | **INCORRECT** | code default is ON (`settings.ts`), README says ON → Open question #4 |
| References to Georgian UI, ka voice commands in PLAN §1–§3 | **INCORRECT (outdated)** | Georgian removed in §7.7; brief requires it → Open question #1 |
| `state/store.ts` (~2,000 lines), report-list fan-out | **NEEDS REFACTOR** | DEBT-001/002 |

## 3. Competitor landscape
See [UX_AND_GROWTH §1](../product/UX_AND_GROWTH.md). Google/Apple/Waze lead on
traffic and coverage; none shows the forecast at your ETA along each road
option with weather-based departure advice. Uniqueness is not claimed;
specialised road-weather products exist commercially.

## 4. Recommended architecture
Client engines + thin Cloudflare edge (ADR-003); Workers with static assets
(ADR-001); external only for routing data/compute and weather models.
Diagram and MVP → Growth → Scale: [TARGET_ARCHITECTURE](../architecture/TARGET_ARCHITECTURE.md).

## 5. Cloudflare architecture
Per-service "needed when" table with verified free/paid limits:
[TARGET_ARCHITECTURE §2](../architecture/TARGET_ARCHITECTURE.md). In short:
Workers + DOs + rate limits now; Workers Paid at beta; Cache API + KV with the
weather proxy; D1 with accounts; R2 with the tile fallback; Queues with push;
Cron with graph rebuilds/exports; Containers possibly for Valhalla.

## 6. Technology choices
Vite + React SPA kept (ADR-002) — SSR frameworks add nothing to a
GPS/WebGL/voice app. zustand stores, MapLibre GL JS, Vitest. No new runtime
dependencies added by this audit.

## 7. Routing comparison
[ADR-004](../architecture/decisions/ADR-004-routing-engine.md): Valhalla
(MIT; avoid options, truck, time-dependent, on-device offline) recommended for
self-hosting; GraphHopper close second; OSRM remains the current integration
and fallback. Engines can't run in Workers → Containers (regional graph, if a
spike confirms always-on behaviour) or external VM.

## 8. Weather provider comparison
[ADR-005](../architecture/decisions/ADR-005-weather-provider.md): Open-Meteo
best fit (multi-location, hourly, model-run metadata) — paid plan + edge cache
needed early; MET Norway as fallback (free, CC BY 4.0, strict caching rules);
WeatherAPI/OpenWeather/Tomorrow.io/Meteomatics compared.

## 9. Map architecture
[MAPS_ROUTING_GEO](../architecture/MAPS_ROUTING_GEO.md), [ADR-006](../architecture/decisions/ADR-006-map-stack.md):
data (OSM, ODbL) / rendering (MapLibre, BSD-3) / tiles (OpenFreeMap, free incl.
commercial, no SLA) / geocoding / routing / traffic / weather separated;
PMTiles-on-R2 fallback planned.

## 10. Database architecture
[DATA_MODEL](../database/DATA_MODEL.md), [ADR-007](../architecture/decisions/ADR-007-data-storage.md):
no server DB needed for MVP; D1 for optional accounts (8 justified tables);
DOs for real time; KV only for caches/flags; what must never go into D1.

## 11. SQL schema
[`database/migrations/0001_accounts.sql`](../../database/migrations/0001_accounts.sql)
— PROPOSED, not applied; validated in SQLite (cascading deletes verified).

## 12. API specification
[API_V1](../api/API_V1.md): implemented endpoints (health, whereami, share,
reports) and planned ones (reports corridor, weather points, route proxy,
telemetry, accounts). Versioning: [ADR-009](../architecture/decisions/ADR-009-api-versioning.md).

## 13. Security architecture
[SECURITY](../security/SECURITY.md): existing controls are solid (CSP,
CSRF via Sec-Fetch-Site, capability links, hashed keys, salted reporter
hashes, body caps, rate limits). Open: WAF on a custom domain, Turnstile with
accounts, logs, dependency monitoring (Dependabot added).

## 14. Privacy architecture
[PRIVACY](../legal/PRIVACY.md): data inventory; no location history; route
history OFF by default (opt-in only, reasoning documented); background
tracking only during active navigation/sharing (native).

## 15. Legal / licensing matrix
[LICENSING_MATRIX](../legal/LICENSING_MATRIX.md): SAFE — OSM data, OpenFreeMap,
OpenMapTiles, MapLibre, Cloudflare, MET Norway (via Worker). REQUIRES REVIEW —
Nominatim, Photon, Open-Meteo (commercial), Transitous, browser speech.
NOT SUITABLE for production — OSRM demo, FOSSGIS servers, public Overpass.

## 16. Mobile strategy
[MOBILE_STRATEGY](../mobile/MOBILE_STRATEGY.md), [ADR-010](../architecture/decisions/ADR-010-mobile-stack.md)
(Proposed): a spike decides; React Native + native car modules favoured
because the engines are shared TypeScript; Capacitor wrapper rejected
(Apple 4.2, no car platforms).

## 17. CarPlay strategy
Entitlement request to Apple (approval not guaranteed); CarPlay framework
templates; map drawn by the app; voice via AVSpeechSynthesizer; one weather
banner at a time. [MOBILE_STRATEGY §5](../mobile/MOBILE_STRATEGY.md).

## 18. Android Auto strategy
Car App Library, NAVIGATION category, `NAVIGATION_TEMPLATES`,
`NavigationManager`, map on the provided surface, quality guidelines.
[MOBILE_STRATEGY §6](../mobile/MOBILE_STRATEGY.md).

## 19. Offline strategy
[ADR-012](../architecture/decisions/ADR-012-offline.md): web = shell + loaded
route + stale forecasts (no false promises); native = PMTiles regions +
on-device Valhalla.

## 20. UX architecture
[UX_AND_GROWTH §2–4](../product/UX_AND_GROWTH.md): screen map, driving-safety
rules (what is unavailable while moving), responsive layouts. The 2026-10-02
changes (solid travel-mode icons, street-level navigation camera, transit
cards) follow these rules.

## 21. Performance strategy
Main chunk 583 KB (188 KB gz) — split; measure CWV on a throttled phone (never
done); MapLibre stays lazy. [UX_AND_GROWTH §5](../product/UX_AND_GROWTH.md).

## 22. SEO strategy
Minimal by design: robots.txt, noindex for `/live/*` and `?p=` links, OG tags,
optional hand-written guides; no auto-generated pages.

## 23. Analytics strategy
None today. Cookieless, aggregate counters only; never coordinates/searches.
[UX_AND_GROWTH §7](../product/UX_AND_GROWTH.md).

## 24. Cost optimisation
[COST_AND_SCALE](../operations/COST_AND_SCALE.md): implemented controls
(batching, grid dedupe, TTL, stale fallback, no per-fix requests, router
queues) and planned ones (edge cache by cell + model run, ≤10 variables,
corridor request, sharding).

## 25. Scalability model
1 → 1M DAU table (Worker, DO, weather, routing, geocoding, D1) with triggers;
key results: Worker Free budget lasts to ~950 DAU today / ~4,000 after the
corridor fix; the single Reports DO exceeds its soft limit near 1M DAU today;
client-direct weather is impossible beyond small scale, cached weather is
bounded by geography.

## 26. Testing strategy
[DELIVERY §3](../operations/DELIVERY.md): unit/scenario (548), Worker smoke
(both API prefixes), planned Playwright E2E, automated axe, Lighthouse, real
devices; special-case matrix with gaps.

## 27. CI/CD
Added: `.github/workflows/ci.yml` (typecheck, tests, build, Worker smoke on
`/api/v1` and `/api`), `deploy.yml` (manual preview/production, needs
secrets), `dependabot.yml`. [DELIVERY §2](../operations/DELIVERY.md).

## 28. Disaster recovery
[DELIVERY §4](../operations/DELIVERY.md): almost no durable server data by
design; Worker rollback; D1 Time Travel 7/30 days + weekly R2 export once D1 exists.

## 29. MVP scope
[ROADMAP §1](../ROADMAP.md): features are done; MUST items are compliance and
operability.

## 30. Complete roadmap
[ROADMAP §2](../ROADMAP.md): Phases 0–8 with features, requirements,
dependencies, risks, complexity.

## 31. Missing features
[ROADMAP §4](../ROADMAP.md).

## 32. Risks

### Findings (severity-ranked)

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| F1 | Public OSRM servers allow ≤1 req/s; best route + 4 via probes + detour table could exceed it | High | **FIXED** (per-server queue, `VITE_OSRM_MIN_INTERVAL_MS`, tests) |
| F2 | FOSSGIS requires attribution and a link to the map-improvement page — missing | High | **FIXED** (`Attribution.tsx`, en/ru) |
| F3 | Open-Meteo free tier (<10k calls/day) exceeded by the app as a whole at ~30 DAU | High | OPEN → REQ-WX-005 |
| F4 | Non-commercial / fair-use services in the production path (OSRM, FOSSGIS, Overpass, Nominatim, Photon, Transitous) | High (for launch) | OPEN → ADR-004/011 |
| F5 | Transitous requires an open-source, non-commercial project; repo private and unlicensed | High | OPEN → owner (Q#2) |
| F6 | API unversioned (future mobile clients) | Medium | **FIXED** (`/api/v1`, aliases, tests, smoke both ways) |
| F7 | No CI | Medium | **FIXED** (workflows added; run once pushed) |
| F8 | Report listing fans out to ≤24 requests per refresh; single global Reports DO | Medium | OPEN → REQ-CF-008/009 |
| F9 | Observability disabled: production errors invisible | Medium | OPEN → REQ-OBS-002 |
| F10 | Speed-camera alerts default ON (code/README) vs OFF (PLAN); legality varies | Medium | OPEN → owner (Q#4) |
| F11 | Georgian UI removed vs brief requiring it | Medium | OPEN → owner (Q#1) |
| F12 | No Privacy Policy / Terms / licence file | Medium | OPEN → ROADMAP Phase 1 |
| F13 | Preview deploys would share production DO namespaces | Low | OPEN → DELIVERY §1 |
| F14 | 14 Open-Meteo variables (counted as 1.4 calls) | Low | OPEN → REQ-WX-007 |
| F15 | Main JS chunk 583 KB; CWV never measured | Low | OPEN → REQ-PERF-001/004 |
| F16 | Capability links (`/live/*`) lack noindex; no robots.txt | Low | OPEN → UX_AND_GROWTH §6 |
| F17 | Georgian Railway listed by Transitous but no itineraries; same-name geocoding (Kobuleti) | Low | OPEN (upstream / UX copy) |
| F18 | Hosting is Workers static assets, brief says Pages | Info | ADR-001 (intentional) |

Strategic risks: [ROADMAP §5](../ROADMAP.md).

## 33. Technical-debt prevention
[PROJECT_REQUIREMENTS §33](../PROJECT_REQUIREMENTS.md) (DEBT-001…008) and
[ROADMAP §6](../ROADMAP.md); session protocol in [AGENTS.md](../../AGENTS.md).

## 34. Final implementation checklist
[ROADMAP §7](../ROADMAP.md).

---

### Changes made in this audit (2026-10-02)
- Code: `src/api/v1.ts` + Worker routing under `/api/v1` (legacy aliases),
  `GET /api/v1/health`; client paths versioned; smoke scripts take `API=`;
  OSRM per-server request queue (`VITE_OSRM_MIN_INTERVAL_MS`, default 1000 ms);
  attribution with routing/search/transit credits and "Report a map error".
- Tests: `api/v1.test.ts`, OSRM rate-limit tests; updated path expectations.
  548 tests pass; typecheck (app + Worker) passes; share 7/7 and reports 5/5
  smoke checks pass on both prefixes.
- CI: `ci.yml`, `deploy.yml`, `dependabot.yml`.
- Docs: PROJECT_REQUIREMENTS (single source of truth), 12 ADRs, target
  architecture, weather engine, maps/routing/GIS, API v1, data model + SQL,
  security, privacy, licensing matrix, mobile strategy, UX/growth, cost &
  scale, delivery, roadmap, AGENTS.md session protocol.

### Sources (verified 2026-10-02)
Cloudflare: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[KV pricing](https://developers.cloudflare.com/kv/platform/pricing/),
[KV limits](https://developers.cloudflare.com/kv/platform/limits/),
[Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[Containers](https://developers.cloudflare.com/containers/),
[Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/),
[Containers pricing](https://developers.cloudflare.com/containers/pricing/),
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[Rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
[Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/),
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[Turnstile plans](https://developers.cloudflare.com/turnstile/plans/),
[Pages → Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/).
Maps/routing/geo: [OpenFreeMap](https://openfreemap.org/), [OpenFreeMap ToS](https://openfreemap.org/tos/),
[OpenMapTiles licence](https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md),
[MapLibre licence](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt),
[OSM attribution](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines),
[Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/),
[Photon](https://photon.komoot.io/), [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API),
[OSRM demo](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server),
[FOSSGIS routing](https://routing.openstreetmap.de/about.html),
[Valhalla](https://github.com/valhalla/valhalla), [GraphHopper](https://github.com/graphhopper/graphhopper),
[GraphHopper pricing](https://www.graphhopper.com/pricing/), [OSRM](https://github.com/Project-OSRM/osrm-backend),
[Transitous API](https://transitous.org/api/), [Transitous sources](https://transitous.org/sources/).
Weather: [Open-Meteo terms](https://open-meteo.com/en/terms), [pricing](https://open-meteo.com/en/pricing),
[MET Norway ToS](https://api.met.no/doc/TermsOfService), [WeatherAPI](https://www.weatherapi.com/pricing.aspx),
[OpenWeather](https://openweathermap.org/price), [Meteomatics](https://www.meteomatics.com/en/weather-api/).
Platforms: [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
[Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/),
[CarPlay](https://developer.apple.com/carplay/),
[Android Auto navigation](https://developer.android.com/training/cars/apps/navigation),
[Play background location](https://support.google.com/googleplay/android-developer/answer/9799150),
[Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111),
[Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469),
[FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types),
[Web Speech API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API).
Law: [Law of Georgia on Personal Data Protection](https://matsne.gov.ge/en/document/view/5827307).
