# navWeather — Project Requirements (single source of truth)

> **Status of this document:** v2.0 (2026-10-04) — only current requirements. Built from the owner's platform brief,
> re-verified against the code and live runs on 2026-10-03 (defects `B-xx`: [AUDIT/DEFECTS.md](AUDIT/DEFECTS.md)) and
> aligned with the owner's decisions of 2026-10-04 ([ADR-015](architecture/decisions/ADR-015-free-software-own-hosting.md),
> [ADR-016](architecture/decisions/ADR-016-all-on-cloudflare-workers.md)). Requirements that no longer apply were removed
> (history in git). It states what the system **should** be; the source code states what it **currently is**. Every
> session compares the two (see [AGENTS.md](../AGENTS.md)).
>
> Change control: a new or changed requirement is written here first, with an ADR in
> [architecture/decisions/](architecture/decisions/README.md) when it is architecturally significant, then implemented,
> tested and documented. Work order: [DEVELOPMENT_PLAN](DEVELOPMENT_PLAN.md) (tasks `DP-x.y`). Nothing in this file may
> be silently overridden by code or by a chat conversation.

**Priorities:** P0 critical · P1 high · P2 medium · P3 future.
**Statuses:** PLANNED · IN PROGRESS · IMPLEMENTED · VERIFIED (implemented and covered by automated tests or a recorded
check) · DEFECT (implemented, but a confirmed bug makes it behave wrongly — see the linked `B-xx`) · BLOCKED · FUTURE.
**Traceability:** each requirement names the code, tests and docs that carry it.

---

## 0. Binding constraints (owner decisions, 2026-10-04)

Decisions: [ADR-015](architecture/decisions/ADR-015-free-software-own-hosting.md) (every third-party component free
forever, only hosting is paid) and [ADR-016](architecture/decisions/ADR-016-all-on-cloudflare-workers.md) (all hosting
on Cloudflare Workers, localhost parity). Catalogue of free replacements: [FREE_STACK_PLAN](FREE_STACK_PLAN.md).

| ID | Constraint | Priority | Status |
| --- | --- | --- | --- |
| REQ-COST-006 | **Free for users, non-commercial:** no subscriptions, ads, paid features or in-app purchases; stated in the app | P0 | IN PROGRESS (true today; in-app statement DP-12.4) |
| REQ-COST-009 | **Only hosting is paid:** the owner pays for hosting — Cloudflare (ADR-016): Workers Paid, R2, D1, Durable Objects, Queues, Containers usage, and a domain — nothing else; no paid API plans, keys, per-request/per-user fees or paid data (ADR-015) | P0 | PLANNED (today the app uses free public services) |
| REQ-COST-010 | **No sponsors:** no sponsorship programmes, grants or credits in the plan or the critical path (ADR-015) | P0 | VERIFIED (none used) |
| REQ-COST-011 | **Free software and open data only** for every third-party component; licence recorded in LICENSING_MATRIX before use; attribution shown; AGPL obligations met (ADR-015) | P0 | IN PROGRESS (FREE_STACK_PLAN §10; DP-6.9) |
| REQ-COST-012 | **Always free, at any scale, in development and in production:** only (A) our own instances of free software, (B) open data files downloaded on a fixed schedule (volume independent of users, no paid tier) and (C) services with no usage limit and no paid tier (OpenFreeMap as tile fallback, browser capabilities). No free tier with a limit, key with a quota, trial or public demo server anywhere — development runs the same stack locally at $0 (FREE_STACK_PLAN §1.1); checked by a bundle test and an E2E test of dev and prod builds (DEVELOPMENT_PLAN gates G2, G3) | P0 | PLANNED (DP-2.x, DP-6.1…DP-6.8) |
| REQ-DEV-001 | **Localhost parity:** every feature runs on a developer machine with no Cloudflare account and no money (`npm run dev` = Vite + Cloudflare Vite plugin with local Durable Objects/D1/R2/Queues + Docker for the same container images + local seed data) **and** on the preview Worker; one E2E suite passes against both (ADR-016) | P0 | PLANNED (DEVELOPMENT_PLAN stage 2, gate G4) |

## 1. Product vision

navWeather is a navigation platform whose core is **NAVIGATION + ROUTE + TIME + WEATHER + PREDICTION + ALERTS**: for
every part of the actual route it works out where the traveller will be, when, and what the forecast is for that place
at that time, and warns them before significant weather in time to act ("Heavy rain expected in about 18 minutes, near
Khashuri"). It is not merely a map site, a weather site or a route calculator, and future work must keep that direction.
Target scale: Google-Maps-class (ADR-015).

## 2. Product goals

| ID | Goal | Priority | Status |
| --- | --- | --- | --- |
| GOAL-1 | A trustworthy answer to "what weather will I drive into, and when?" for any road trip | P0 | IMPLEMENTED (verified live for trips up to ~2 days; multi-day: REQ-WX-008) |
| GOAL-2 | Turn-by-turn navigation good enough to drive with, on the web today and natively later | P0 | IMPLEMENTED (web limits: §32) |
| GOAL-3 | Timely, non-spammy weather alerts that separate forecast, derived estimate and official warning | P0 | PARTIALLY (no official warnings, REQ-WX-006) |
| GOAL-4 | Only hosting costs money, and hosting cost grows sub-linearly with users (static assets, caching, offline packs) | P0 | IN PROGRESS (§29, DP-5.6) |
| GOAL-5 | One versioned backend API for Web, iOS, Android, CarPlay, Android Auto | P1 | IN PROGRESS (`/api/v1` exists, §12) |
| GOAL-6 | Privacy by design: no location history, minimal server data | P0 | IMPLEMENTED |

## 3. Core functionality

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-CORE-001 | Route by real road geometry with alternatives and multi-stop | P0 | VERIFIED | `services/routing/OSRMProvider.ts`, `services/routePlanner.ts`; `OSRMProvider.test.ts`, `routePlanner.test.ts` |
| REQ-CORE-002 | ETA for every geometry vertex (typical speeds; traffic hook) | P0 | VERIFIED | `algorithms/routeTiming.ts`; `routeTiming.test.ts` |
| REQ-CORE-003 | Adaptive weather sampling along the route (not a fixed spacing) | P0 | VERIFIED | `algorithms/routeSampling.ts`; `routeSampling.test.ts`; [WEATHER_ENGINE](architecture/WEATHER_ENGINE.md) |
| REQ-CORE-004 | Forecast matched to each sample's ETA in its own time zone | P0 | VERIFIED | `algorithms/weatherMatching.ts`, `utils/timezone.ts`; tests |
| REQ-CORE-005 | Route weather timeline, groups, summary, per-road comparison | P0 | VERIFIED | `state/derive.ts`, `algorithms/weatherGrouping.ts`, `components/Plan/*` |
| REQ-CORE-006 | Weather alerts before significant weather, deduplicated | P0 | VERIFIED | `intelligence/weatherAlerts.ts`, `intelligence/driverAlerts.ts`; tests |
| REQ-CORE-007 | Explore map: search, place card with weather now / at arrival / 7 days | P1 | VERIFIED | `state/explore.ts`, `components/Explore/*` |
| REQ-CORE-008 | Best time to leave (next 12 h compared by weather) | P1 | VERIFIED | `algorithms/departurePlanner.ts` |
| REQ-CORE-009 | Travel modes: car, walk, bike, public transport (timetabled), flight (labelled estimate) | P1 | VERIFIED | `types/travel.ts`, `services/routing/*`; `travelModes.test.ts`, `TransitousProvider.test.ts` |
| REQ-CORE-010 | Live location sharing (latest position only, expiring) | P2 | VERIFIED | `worker/liveShare.ts`, `share/*`; `liveShare.test.ts`, `scripts/share-smoke.mjs` |
| REQ-CORE-011 | Driver reports, always labelled "reported" | P2 | VERIFIED | `worker/reports.ts`, `reports/protocol.ts`; `scripts/reports-smoke.mjs` |
| REQ-CORE-012 | Weather-aware re-route offers while driving (never automatic) | P2 | VERIFIED | `state/store.ts` (weather reroute); tests |
| REQ-CORE-013 | Fuel/charging reminders from the user's declared range stay fixed to the road: the range is consumed as the car drives, so the reminder comes closer | P0 | VERIFIED (B-02 fixed 2026-10-04) | `intelligence/routeIntelligence.ts`, `state/store.ts` (`rangeUsedKm`, carried over re-routes, restarts when a new range is entered); `routeIntelligence.test.ts`, `state/range.test.ts` |

### 3a. Long Trip Mode

Specification (source of truth): [features/LONG_TRIP_MODE.md](features/LONG_TRIP_MODE.md);
decision: [ADR-013](architecture/decisions/ADR-013-trip-planner.md).

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-TRIP-001 | One trip classification engine (SHORT/MEDIUM/EXTENDED/LONG) with configurable thresholds — never hard-coded in components | P1 | VERIFIED | `src/trip/config.ts`, `classification/classify.ts`; `trip.test.ts` |
| REQ-TRIP-002 | Long Trip Mode on automatically (distance, driving time, overnight, several breaks) from EXTENDED trips up — shorter trips are offered it, never switched (B-24); user override, non-blocking; whenever it is on, the stops are planned | P1 | VERIFIED | `state/trip.ts`, `components/Trip/LongTrip.tsx`; `trip.test.tsx` |
| REQ-TRIP-003 | Trip plan: segments, breaks, meals, fuel/charge, overnights, days, timeline | P1 | DEFECT (B-04; DP-1.4) | `planning/schedule.ts`, `planner.ts` |
| REQ-TRIP-004 | Every ETA and forecast match includes planned stop durations (weather at the real times) | P0 | VERIFIED | `state/derive.ts` (`tripStops`), `routeIntelligence.ts` (`dwellBeforeS`) |
| REQ-TRIP-005 | Overnight areas from driving time, latest arrival, settlement size, no-extra-night rule; user can choose another town | P1 | DEFECT (B-05; DP-1.5) | `planning/overnight.ts`, `chooseOvernight`, `state/trip.ts` |
| REQ-TRIP-006 | Hotels from open data near the area, within the user's distance; never claim availability | P1 | VERIFIED (OSM via Overpass today; our Places API in DP-6.5) | `stops/recommend.ts`, `/api/v1/trips/places` |
| REQ-TRIP-007 | Fuel/charging only from user-declared range or tank + consumption; never estimated — without the tank size only the first fill is planned and the driver is told (`enter-tank`) | P0 | VERIFIED (B-01, B-20 fixed 2026-10-04) | `schedule.ts`, `planner.ts`, `settings.ts` (`fullRangeKm`), `state/trip.ts`; `trip.test.ts` |
| REQ-TRIP-008 | Meal places closed at the planned arrival are excluded (OSM opening hours, safe subset) | P1 | VERIFIED | `stops/openingHours.ts` |
| REQ-TRIP-009 | Weather risks at stop-aware times; "stop earlier" advice with reason, never applied silently | P1 | DEFECT (B-07, B-21, B-08/B-09; DP-1.7, DP-11.1) | `weather/risks.ts`, `weather/hazards.ts`, `services/trip/requests.ts` |
| REQ-TRIP-010 | Replan from the car when ≥ 20 min off plan (10 min cooldown), carry today's driving over re-routes; announce arrival changes ≥ 15 min | P1 | VERIFIED (B-03, B-01 fixed 2026-10-04) | `state/trip.ts`, `replanning/progress.ts`; `trip.test.ts`, `trip.test.tsx` |
| REQ-TRIP-011 | Planned stops as route events replacing generic break/fuel reminders; no notification spam | P1 | VERIFIED | `routeIntelligence.ts` |
| REQ-TRIP-012 | Border crossings along the route, shown in dashboard and timeline; borders from Natural Earth on the client | P2 | VERIFIED (via Overpass today); client-side borders PLANNED (DP-4.5) | `trip/borders.ts`, `/api/v1/trips/borders` |
| REQ-TRIP-013 | Vehicle-specific planning: car/van/motorcycle/truck/EV (stops and places); truck road restrictions | P2 | PARTIALLY (restrictions PLANNED with Valhalla, DP-9.2) | `stops/places.ts`, `recommend.ts` |
| REQ-TRIP-014 | Preferences: pace, hotel stars and distance, food, fuel brand (device-only) | P1 | IMPLEMENTED | `SettingsDialog.tsx` (Long trips) |
| REQ-TRIP-015 | Planner stateless on Cloudflare; no stored trips, no position logs | P0 | IMPLEMENTED (CPU limit B-23 disappears on Workers Paid, DP-5.1) | `worker/trips.ts`, ADR-013 |
| REQ-TRIP-016 | Jurisdiction-specific driving/rest rules for commercial drivers | P3 | PLANNED (needs verified rules) | — |
| REQ-TRIP-017 | Cheapest fuel and live hotel availability | P3 | BLOCKED (no free data source; fuel prices only where governments publish them, DP-8.10) | — |
| REQ-TRIP-018 | Remaining range is tracked along the drive (declared range − distance since the last fill) and sent with every replan and re-route | P0 | VERIFIED (2026-10-04) | `state/trip.ts`, `replanning/progress.ts` (`rangeLeftAt`), `planner.ts` (a replan never falls back to the starting range); `trip.test.ts`, `trip.test.tsx` |
| REQ-TRIP-019 | Plausible days for any departure time: overnights only in the local evening/night window, a meal at least every ~6 h awake, night driving (00:00–06:00) flagged with advice to start in the morning — never changed silently | P1 | PLANNED (fixes B-04; DP-1.4) | `planning/schedule.ts`, `config.ts` |
| REQ-TRIP-020 | Time spent at a planned stop, up to its planned departure, is not a delay | P1 | VERIFIED (2026-10-04) | `replanning/progress.ts` (`delaySeconds`, within 2 km of the stop); `trip.test.ts` |
| REQ-TRIP-021 | The plan is refreshed when its inputs arrive or change while planning: late settlements, new or longer forecasts (debounced, no notification spam) | P1 | PLANNED (fixes B-05, B-07; DP-1.5, DP-1.7) | `state/trip.ts` |
| REQ-TRIP-022 | Long Trip planning can also run in the browser (Web Worker) with the same `src/trip` module, so planning works offline | P3 | FUTURE | `services/trip/requests.ts`, `state/trip.ts` |

## 4. Supported platforms

| ID | Platform | Priority | Status |
| --- | --- | --- | --- |
| REQ-PLAT-001 | Web (desktop, tablet, iPhone, Android), installable PWA | P0 | IMPLEMENTED |
| REQ-PLAT-002 | iOS native app | P2 | BLOCKED — Apple Developer Program fee is not hosting (ADR-015); the installable PWA is the iOS product |
| REQ-PLAT-003 | Android native app | P2 | PLANNED only through free channels (APK / F-Droid, needs an open-source repo; DEVELOPMENT_PLAN stage 14); Google Play BLOCKED by its fee |
| REQ-PLAT-004 | Apple CarPlay (navigation entitlement) | P3 | BLOCKED — needs a paid Apple developer account (ADR-015) |
| REQ-PLAT-005 | Android Auto (Car App Library, NAVIGATION category) | P3 | BLOCKED — distributed only through Google Play, which has a fee (ADR-015) |
| REQ-PLAT-006 | Wearables, vehicle integrations, public API | P3 | FUTURE |

## 5. Architecture principles

1. **Correctness first, then safety, privacy, reliability, simplicity, performance, scalability, cost, UX, advanced
   features** (owner's order).
2. **Only real data.** No source → the feature says "not available"; simulation is always labelled; driver reports are
   "reported", never fact.
3. **Deterministic engines.** Routing, ETA, weather matching, alerts and navigation are pure, tested TypeScript
   (`src/algorithms`, `src/intelligence`, `src/navigation`) with no React/DOM dependency, so they can serve every
   client. AI may explain or converse, never replace them.
4. **Provider-agnostic.** Business logic sees interfaces; `services/providers.ts` is the only place naming
   implementations. Swapping a provider is configuration.
5. **Always free, only hosting paid** ([ADR-015](architecture/decisions/ADR-015-free-software-own-hosting.md)): own
   instances of free software, open data files, or services without limits.
6. **All hosting on Cloudflare Workers, not Pages** ([ADR-001](architecture/decisions/ADR-001-cloudflare-first.md),
   [ADR-016](architecture/decisions/ADR-016-all-on-cloudflare-workers.md)); every part also runs on localhost.
7. **Thin, versioned edge API; no server state that isn't needed**
   ([ADR-003](architecture/decisions/ADR-003-client-engines-thin-edge.md)).
8. **Do not over-engineer.** Each infrastructure component answers: what problem? can we launch without it? what
   triggers it? ([TARGET_ARCHITECTURE](architecture/TARGET_ARCHITECTURE.md)).

## 6. Cloudflare architecture

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-CF-001 | One Worker with static assets serves the app and `/api/*` | P0 | IMPLEMENTED | `wrangler.toml`, `worker/index.ts` |
| REQ-CF-002 | Durable Objects only where a single coordinated state is needed (live share per link, reports, traffic aggregates) | P1 | IMPLEMENTED (share, reports) | `worker/liveShare.ts`, `worker/reports.ts` |
| REQ-CF-003 | Per-client rate limits on every write and on report listing | P0 | IMPLEMENTED | `wrangler.toml [[ratelimits]]`, `worker/index.ts` |
| REQ-CF-007 | Workers Paid plan from the first engine in Containers | P1 | PLANNED (DP-5.1) | ADR-016, [COST](operations/COST_AND_SCALE.md) |
| REQ-CF-008 | Shard the single `Reports` object by region before it nears ~1,000 req/s | P2 | PLANNED (DP-7.2) | [COST](operations/COST_AND_SCALE.md) |
| REQ-CF-009 | Report listing as one corridor request instead of up to 24 box requests | P1 | PLANNED (DP-7.2) | `services/traffic/ReportsIncidentProvider.ts`, [API_V1](api/API_V1.md) |
| REQ-CF-010 | Trip planner endpoints (`/api/v1/trips/plan|places|borders`) stateless and rate-limited (`TRIP_LIMITER`) | P1 | DEFECT (B-22: places/borders cache uses the Cache API, which does nothing on `*.workers.dev`) → fixed by DP-4.5, DP-6.5 | `worker/trips.ts`, `wrangler.toml` |
| REQ-CF-011 | No feature relies on the Cache API while the app runs on `*.workers.dev`; once the custom domain is attached (DP-12.1) the Cache API fronts tiles, places and weather | P1 | PLANNED (fixes B-22) | `worker/trips.ts` |
| REQ-CF-012 | Per-feature request budgets, spend alerts, back-off on 429 and rate limits on every endpoint incl. `/whereami` — protect the hosting bill | P1 | PLANNED (DP-3.4, DP-5.1) | `worker/*`, `share/liveShare.ts`, `ReportsIncidentProvider.ts` |
| REQ-CF-013 | **All hosting on Cloudflare Workers (not Pages)** — one Worker project with static assets and `/api/v1/*`; custom domain attached to it when bought | P0 | IMPLEMENTED (Worker with assets) / PLANNED (domain, DP-12.1) | `wrangler.toml`, ADR-016 |
| REQ-CF-014 | `wrangler.toml` environments `dev` / `preview` / `production` with separate Durable Object namespaces, D1 databases and R2 buckets; preview never touches production data | P1 | PLANNED (DP-2.2, DP-3.2) | `wrangler.toml`, [DELIVERY](operations/DELIVERY.md) |
| REQ-CF-015 | D1 per region/country for places and the FTS5 geocoder index (≤10 GB per database), plus accounts | P1 | PLANNED (DP-4.2, DP-4.4, DP-7.6) | ADR-016, [DATA_MODEL](database/DATA_MODEL.md) |
| REQ-CF-016 | R2 for map PMTiles, places tiles, weather cells, terrain, imagery and data snapshots, served by the Worker with range requests | P1 | PLANNED (DP-4.x, DP-5.5) | ADR-016 |
| REQ-CF-017 | Cloudflare Containers (Workers Paid) for Valhalla, MOTIS, LibreWXR (and Photon if needed), one instance group per region, behind Worker routes with rate limits; engine data baked into images or pulled from R2 (ephemeral disk) | P1 | PLANNED (DP-5.2…DP-5.7) | ADR-016 |
| REQ-CF-018 | Cron Triggers + Queues for data pipelines, weather refresh, push fan-out and traffic ingestion; every scheduled job can be triggered by hand on localhost | P1 | PLANNED (DP-4.x, DP-7.5, DP-10.3) | ADR-016 |

## 7. Map architecture

Map **data** (OpenStreetMap), map **rendering** (MapLibre GL JS), **tiles**, **geocoding**, **routing**, **traffic** and
**weather** are separate systems with separate licences and failure modes
([MAPS_ROUTING_GEO](architecture/MAPS_ROUTING_GEO.md)). Today: OpenFreeMap tiles; target: own PMTiles in R2 with
OpenFreeMap as fallback.

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-MAP-001 | MapLibre GL JS rendering of vector styles (light/dark) | P0 | IMPLEMENTED (OpenFreeMap styles) | `components/Map/RouteMap.tsx`, `services/map/MapProvider.ts` |
| REQ-MAP-002 | Attribution visible on the map; data/routing credits + "Report a map error" in the sheets | P0 | IMPLEMENTED | `RouteMap.tsx` (AttributionControl), `components/Common/Attribution.tsx` |
| REQ-MAP-003 | Own vector tiles (Planetiler → PMTiles in R2) as the primary source; automatic fallback to OpenFreeMap with the right attribution | P1 | PLANNED (DP-5.5, DP-6.8) | [ADR-006](architecture/decisions/ADR-006-map-stack.md) |
| REQ-MAP-004 | No bulk/automated downloading of third-party tiles (OpenFreeMap ToS) | P0 | IMPLEMENTED | service worker never caches tiles (`public/sw.js`) |

## 8. Routing architecture

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-ROUTE-001 | While the current code still calls the public OSRM servers: ≤1 request/s per server, light non-commercial use (removed in DP-6.1…6.3) | P0 | IMPLEMENTED | per-server queue in `OSRMProvider.ts` (`VITE_OSRM_MIN_INTERVAL_MS`); `OSRMProvider.test.ts` |
| REQ-ROUTE-003 | Avoid tolls/highways/ferries; truck, motorcycle and wheelchair profiles | P2 | PLANNED (Valhalla; DP-9.1, DP-9.2) | ADR-004 |
| REQ-ROUTE-004 | Live traffic only from real data — our users' anonymised segment speeds (opt-in) or open official feeds; "not available" otherwise | P2 | IMPLEMENTED (none) / PLANNED (stage 10) | `services/traffic/TrafficProvider.ts` |
| REQ-ROUTE-005 | Public transport from open timetables, labelled; today Transitous, target our own MOTIS with open feeds | P2 | IMPLEMENTED (Transitous) / PLANNED (DP-5.3, DP-6.7) | `TransitousProvider.ts`; [ADR-011](architecture/decisions/ADR-011-public-transport.md) |
| REQ-ROUTE-007 | Self-hosted Valhalla in Cloudflare Containers for car, walking, cycling (and later truck/motorcycle), behind `/api/v1/route` with rate limits and a short cache | P0 | PLANNED (DP-5.2, DP-6.2, DP-6.3) | [ADR-004](architecture/decisions/ADR-004-routing-engine.md) |

## 9. Weather architecture

Details: [WEATHER_ENGINE](architecture/WEATHER_ENGINE.md).

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-WX-001 | Route → adaptive samples → ETA → grid-snapped batched forecasts → cached → matched at ETA → timeline → alerts | P0 | VERIFIED (tests + live run 2026-10-03; multi-day horizon: REQ-WX-008) | `routePlanner.ts`, `WeatherService.ts`, `weatherMatching.ts` |
| REQ-WX-002 | Forecast values never extrapolated past the forecast horizon; interval vs instant semantics | P0 | VERIFIED | `weatherMatching.ts`; tests |
| REQ-WX-003 | Every value labelled RAW FORECAST, DERIVED ESTIMATE or OFFICIAL WARNING in UI and voice | P0 | PARTIALLY (official warnings not integrated) | `components/Plan/DataSources.tsx`; REQ-WX-006 |
| REQ-WX-004 | Stale forecasts shown as stale; model-run-aware refresh; offline keeps last forecast | P0 | VERIFIED | `WeatherService.ts`, `store.ts refreshIfStale` |
| REQ-WX-006 | Official warnings and hazards (MeteoAlarm where reuse is free, GDACS, USGS, NASA FIRMS files), labelled "official" | P2 | PLANNED (DP-8.9; MeteoAlarm terms and Georgia coverage REQUIRE VERIFICATION) | WEATHER_ENGINE §6 |
| REQ-WX-008 | The forecast horizon requested covers the whole trip including planned stops, from the first load | P1 | DEFECT (B-06; DP-1.6) | `state/store.ts` (`loadWeather`), `WeatherService.ts` |
| REQ-WX-009 | One set of weather hazard thresholds, configurable in one module, documented with their rationale and used by alerts, trip risks, road comparison, departure advice and the road-surface estimate | P1 | DEFECT (B-08; DP-11.1) | `intelligence/weatherAlerts.ts`, `trip/weather/hazards.ts`, `state/derive.ts`, `algorithms/departurePlanner.ts`, `algorithms/roadHazards.ts` |
| REQ-WX-010 | Extreme temperature alerts (heat, severe cold) with configurable thresholds | P2 | PLANNED (DP-11.2) | `intelligence/weatherAlerts.ts` |
| REQ-WX-013 | Weather from our own pipeline: open model files (ECMWF, DWD, NOAA; CAMS for air quality) → forecast cells (grid + model run) in R2 → Worker `/api/v1/weather/*`, compatible with `WeatherService`; no third-party weather API | P1 | PLANNED (DP-4.6, DP-6.6) | ADR-016 |

## 10. Authentication architecture

[ADR-008](architecture/decisions/ADR-008-identity.md). **Anonymous first:** everything that works today keeps working
with no account.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-AUTH-001 | No account needed for search, routing, weather, navigation, sharing, reports | P0 | IMPLEMENTED |
| REQ-AUTH-002 | Optional account with passkeys (no e-mail or SMS service) only to sync saved places, lists and settings | P2 | PLANNED (DP-7.6) |
| REQ-AUTH-003 | Opaque server sessions (HttpOnly cookie on web, Bearer token on mobile); no long-lived JWTs | P2 | PLANNED |
| REQ-AUTH-004 | In-app account deletion + web deletion page | P2 | PLANNED (DP-7.6) |
| REQ-AUTH-005 | Third-party sign-in (Apple/Google) only together, and only if demand exists | P3 | FUTURE |

## 11. Database architecture

[DATA_MODEL](database/DATA_MODEL.md), [ADR-007](architecture/decisions/ADR-007-data-storage.md).

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-DATA-001 | Preferences and saved places live on the device unless the user signs in | P0 | IMPLEMENTED |
| REQ-DATA-002 | D1 for accounts, sessions, settings, saved places and lists (when accounts ship) | P2 | PLANNED (DP-7.6) |
| REQ-DATA-003 | Never store positions, routes or trip history on the server unless a user opts in to a named feature | P0 | IMPLEMENTED |
| REQ-DATA-004 | Real-time state (live share, reports) in Durable Objects with expiry | P1 | IMPLEMENTED |
| REQ-DATA-006 | Open data for each region (OSM + Overture Places + Foursquare OS Places + Open Charge Map; borders from Natural Earth) pre-built by our pipelines into R2, D1 and static assets; no live Overpass | P1 | PLANNED (DP-4.1…DP-4.5) |

## 12. API architecture

[API_V1](api/API_V1.md), [ADR-009](architecture/decisions/ADR-009-api-versioning.md).

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-API-001 | All app endpoints under `/api/v1/…`; unversioned `/api/…` kept as alias for old app shells | P0 | VERIFIED | `src/api/v1.ts`, `worker/index.ts`; `api/v1.test.ts`, smoke scripts (both prefixes) |
| REQ-API-002 | JSON errors `{ "error": "<code>" }` with correct HTTP status; no stack traces | P0 | IMPLEMENTED | `worker/http.ts` |
| REQ-API-003 | Platform-independent: no cookies required for anonymous endpoints; CSRF protection for browsers | P0 | IMPLEMENTED | `Sec-Fetch-Site` check in `worker/index.ts` |
| REQ-API-004 | Shared request/response types between Worker and clients | P1 | IMPLEMENTED | `src/share/protocol.ts`, `src/reports/protocol.ts`, `src/api/v1.ts` |
| REQ-API-005 | `GET /api/v1/health` for uptime monitoring | P1 | VERIFIED | `worker/index.ts`; smoke |
| REQ-API-006 | A breaking change is a new version served alongside the old one | P0 | IMPLEMENTED (policy) | ADR-009 |

## 13. Security requirements

[SECURITY](security/SECURITY.md).

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-SEC-001 | No secrets in the client bundle; all `VITE_*` values are public | P0 | IMPLEMENTED |
| REQ-SEC-002 | Strict CSP, Permissions-Policy, nosniff, referrer policy | P0 | IMPLEMENTED (`public/_headers`) |
| REQ-SEC-003 | Writes: same-origin only (Sec-Fetch-Site), JSON content type, size-capped bodies, rate limits | P0 | VERIFIED (smoke) |
| REQ-SEC-004 | Capability links with ≥128-bit ids; sharer key stored only as SHA-256 | P0 | VERIFIED |
| REQ-SEC-005 | Reporter/voter identity only as daily-salted hash; no IP stored | P0 | IMPLEMENTED |
| REQ-SEC-006 | Turnstile (free) on account creation and on report abuse | P2 | PLANNED (with accounts, DP-7.6) |
| REQ-SEC-007 | WAF + rate-limiting rules on the custom domain before public launch | P1 | PLANNED (DP-12.1) |
| REQ-SEC-008 | Dependency updates monitored (Dependabot) and CI on every PR | P1 | IMPLEMENTED (`.github/`) |

## 14. Privacy requirements

[PRIVACY](legal/PRIVACY.md).

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-PRIV-001 | No location history; positions/routes never stored server-side | P0 | IMPLEMENTED |
| REQ-PRIV-002 | Route history, if ever offered, is OFF by default and opt-in, device-first | P0 | IMPLEMENTED (not offered) |
| REQ-PRIV-003 | Third parties receive only what each request needs; target: no third party receives coordinates (own engines on Cloudflare) | P0 | IMPLEMENTED (documented) / PLANNED (stage 6) |
| REQ-PRIV-004 | Logs and analytics never contain precise coordinates or bbox/route query strings | P0 | IMPLEMENTED (observability off); must hold when logs are enabled |
| REQ-PRIV-005 | Privacy Policy, Terms, data-deletion page published before public beta (free templates + self-review; not legal advice) | P1 | PLANNED (DP-12.3) |
| REQ-PRIV-006 | Consent banner not needed while only strictly-necessary device storage is used; re-assess with analytics | P1 | IMPLEMENTED (no cookies/trackers) |

## 15. Legal / licensing requirements

[LICENSING_MATRIX](legal/LICENSING_MATRIX.md). Every external dependency has a row with licence, commercial use,
attribution, caching, limits and a verdict, with source and verification date.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-LEGAL-001 | Attribution for every data source and engine actually used (today: OSM, OpenMapTiles, OpenFreeMap, Open-Meteo, routing servers, Transitous) | P0 | IMPLEMENTED (today) / PLANNED (target list, DP-6.9) |
| REQ-LEGAL-002 | Non-commercial licences (e.g. EOX Sentinel-2 cloudless 2018+) are used only while REQ-COST-006 holds | P1 | IMPLEMENTED (policy) |
| REQ-LEGAL-003 | Repository public under an OSI licence (AGPL services, open feeds, F-Droid, free CI) | P1 | PLANNED (owner decision D1, DP-0.3) |
| REQ-LEGAL-004 | Speed-camera alerts: legality varies by country; off by default, user responsibility shown in Settings | P1 | IMPLEMENTED (currently on by default — DP-0.4 switches it off) |

## 16. UX principles

Calm, fast, minimal, trustworthy, driver-focused, not "AI-looking". Complexity lives in the engines, not on screen.
While driving: one banner, voice first, large targets, nothing to read for long
([UX_AND_GROWTH](product/UX_AND_GROWTH.md)).

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-UX-001 | Desktop side panel; phone bottom sheet (not a shrunken desktop) | P0 | IMPLEMENTED |
| REQ-UX-002 | While moving: no typing, no long lists, Report = 5 large buttons, voice push-to-talk | P0 | IMPLEMENTED |
| REQ-UX-003 | Navigation camera at street level, heading-up, auto re-centre | P1 | IMPLEMENTED |
| REQ-UX-004 | Every source shows its freshness (Forecast / Estimated / Scheduled / Stale / Simulated / Not available) | P0 | IMPLEMENTED |

## 17. Accessibility requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-A11Y-001 | WCAG 2.1 AA: axe-core 0 violations in all main states, light/dark | P1 | VERIFIED (manual axe run 2026-10-02; automated in DP-11.4) |
| REQ-A11Y-002 | Keyboard: focus traps in dialogs, Escape, focus return | P1 | VERIFIED |
| REQ-A11Y-003 | Touch targets ≥44 px; text never relies on colour alone | P1 | IMPLEMENTED (map markers: DP-11.11) |

## 18. Performance requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-PERF-001 | Core Web Vitals "good" on a mid-range phone: LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 | P1 | PLANNED (DP-11.5; main JS 196 KB gz) |
| REQ-PERF-002 | MapLibre in its own lazy chunk; app shell paints first | P1 | IMPLEMENTED |
| REQ-PERF-003 | Position updates cost no network requests (weather re-matched locally) | P0 | IMPLEMENTED |
| REQ-PERF-004 | Split rarely used UI (settings, share, live viewer, transit, departure planner, dev panel) out of the main chunk | P2 | PLANNED (DP-11.5) |

## 19. Scalability requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-SCALE-001 | Upstream weather downloads bounded by models × runs × regions, independent of the number of users | P1 | PLANNED (DP-4.6) |
| REQ-SCALE-002 | No single Durable Object on the hot path of every user at >1,000 req/s | P2 | PLANNED (shard Reports; DP-7.2) |
| REQ-SCALE-004 | **Google-Maps-class target:** every server role is stateless and horizontally scalable, multi-region, with cache layers (tiles, weather by cell + model run, places by tile, geocoding); a measured capacity model gives hosting cost per 1,000 DAU | P0 | PLANNED (DP-5.6, DP-13.5, DP-13.6) |
| REQ-SCALE-005 | Self-hosted free engines before public beta: Valhalla (routing, all modes), geocoder (D1 FTS5 or Photon), Places API (OSM + Overture + Foursquare OS Places + Open Charge Map in D1/R2), weather pipeline (weather and air quality as cells in R2; elevation from Copernicus DEM), MOTIS (public transport), own tiles (Planetiler → PMTiles in R2), real time on Workers + Durable Objects | P1 | PLANNED (DEVELOPMENT_PLAN stages 4–7) |

Model: [COST_AND_SCALE](operations/COST_AND_SCALE.md); free stack: [FREE_STACK_PLAN](FREE_STACK_PLAN.md).

## 20. Mobile preparation requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-MOB-001 | Engines free of React/DOM so they can run in a mobile JS runtime or be ported | P0 | IMPLEMENTED |
| REQ-MOB-002 | Every server feature reachable via `/api/v1` with Bearer-token auth (no cookie-only flows) | P1 | PLANNED (accounts) |
| REQ-MOB-003 | Decide the mobile stack via a time-boxed spike, only for free channels (PWA, APK / F-Droid); store apps blocked by fees (ADR-015) | P2 | PLANNED |
| REQ-MOB-004 | Voice layer as platform-neutral instruction IDs + params, rendered by a per-platform TTS adapter | P1 | IMPLEMENTED (web) / PLANNED (mobile) |
| REQ-MOB-005 | Location behind a `LocationProvider` interface (today an injectable browser `geolocation`) | P2 | PLANNED |
| REQ-MOB-006 | Notifications behind a `NotificationProvider` interface; alerts can reach a backgrounded app where the platform allows (Web Push) | P2 | PLANNED (DP-7.5) |

## 21. CarPlay requirements

CarPlay navigation needs Apple's CarPlay navigation entitlement, the CarPlay framework's map templates and voice
guidance through the system audio session. Not possible from a web app. See [MOBILE_STRATEGY](mobile/MOBILE_STRATEGY.md).
Status: BLOCKED (REQ-PLAT-004).

## 22. Android Auto requirements

Car App Library, `androidx.car.app.category.NAVIGATION`, `androidx.car.app.NAVIGATION_TEMPLATES`, `NavigationManager`
trip updates, map drawn on the provided surface, car-app quality guidelines. Not possible from a web app. Status:
BLOCKED (REQ-PLAT-005).

## 23. Offline requirements

[ADR-012](architecture/decisions/ADR-012-offline.md).

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-OFF-001 | Offline app shell; loaded route, instructions and cached forecasts keep working, labelled stale | P0 | VERIFIED |
| REQ-OFF-002 | Never promise offline navigation the stack can't do | P0 | IMPLEMENTED |
| REQ-OFF-003 | User-initiated downloadable regions (PMTiles + places) in the PWA within browser storage limits; on-device routing only in native apps | P3 | PLANNED (ADR-018 first; DP-9.8) |

## 24. Internationalization requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-I18N-001 | No hard-coded UI text; messages per locale, lazy-loaded | P0 | IMPLEMENTED (en, ru) |
| REQ-I18N-002 | Georgian UI with native review | P1 | PLANNED if the owner decides (D5, DP-11.13); transliteration of Georgian names stays |
| REQ-I18N-003 | Metric/imperial units; 24 h/locale time; per-point IANA time zones, DST-safe (UTC internally) | P0 | VERIFIED |
| REQ-I18N-004 | Russian (and Georgian, if restored) reviewed by native speakers before launch | P1 | PLANNED |
| REQ-I18N-005 | Future languages via the same message catalogue; plural rules via Intl | P3 | FUTURE |

## 25. Testing requirements

[TESTING](TESTING.md), [DELIVERY](operations/DELIVERY.md).

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-TEST-001 | Unit + scenario tests for all engines (586 passing on 2026-10-03) | P0 | VERIFIED |
| REQ-TEST-002 | Worker smoke tests for share and reports, both API prefixes | P0 | VERIFIED (local) |
| REQ-TEST-003 | Special cases: time-zone crossing, provider failure, re-route, GPS drift/tunnel, offline, duplicate alerts, forecast update, long and international routes | P0 | PARTIALLY (see TESTING gaps) |
| REQ-TEST-004 | Real-device tests (iOS Safari, Android Chrome) before public beta | P1 | PLANNED (DP-11.7) |
| REQ-TEST-005 | Browser E2E (Playwright) for search → route → simulate → arrive, Long Trip, offline, API failure | P1 | PLANNED (DP-11.3) |
| REQ-TEST-006 | A regression test for every confirmed defect (B-01…B-07 first) before it is closed | P0 | PLANNED (stage 1) |
| REQ-TEST-007 | The same E2E suite runs against `localhost` and the preview Worker (REQ-DEV-001) | P0 | PLANNED (DP-2.6, DP-11.3) |

## 26. CI/CD requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-CI-001 | PR checks: typecheck (app + Worker), unit tests, build, Worker smoke tests | P0 | IMPLEMENTED (`.github/workflows/ci.yml`; runs on GitHub not verified) |
| REQ-CI-002 | Deploy to Cloudflare from CI with a scoped API token: preview, then production | P1 | IMPLEMENTED (`deploy.yml`, needs secrets; environments DP-2.2, DP-3.1) |
| REQ-CI-003 | Lint (ESLint) in CI | P2 | PLANNED (DP-11.6) |
| REQ-CI-004 | D1 migrations applied by CI before code that needs them, backward compatible | P2 | PLANNED (with D1) |
| REQ-CI-005 | Dependency audit in CI without high findings (dev included) | P2 | PLANNED (B-16; DP-11.6) |

## 27. Monitoring requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-OBS-001 | Uptime check on `/api/v1/health` | P1 | PLANNED (DP-12.7) |
| REQ-OBS-002 | Workers Logs with sampling, without request URLs/bodies containing coordinates | P1 | PLANNED (DP-3.3) |
| REQ-OBS-003 | Client error reports (no location, no PII) | P2 | PLANNED |
| REQ-OBS-004 | Failure rates of our engines and data pipelines visible | P2 | PLANNED (DP-3.3, DP-11.8) |

## 28. Disaster recovery requirements

[DELIVERY](operations/DELIVERY.md) §Disaster recovery. Live shares and reports expire by design. With D1: Time Travel
plus a scheduled export to R2; migrations forward-only and backward compatible.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-DR-001 | Runbooks in `docs/runbooks/`: outage of each engine, data-pipeline failure, overload, Worker rollback, leaked token, report abuse | P2 | PLANNED (DP-12.2) |

## 29. Cost-control requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-COST-002 | Batch, deduplicate (0.02° grid) and cache forecasts; refresh only on staleness or new model run | P0 | VERIFIED (client) |
| REQ-COST-004 | Hosting cost per 1,000 DAU kept current in COST_AND_SCALE (capacity pilot, then monthly) | P1 | PLANNED (DP-5.6, DP-12.7) |

## 30. Release scope

The current web app already exceeds the feature MVP. A public release requires DEVELOPMENT_PLAN stages 0–12 and all
release gates G1–G13 ([DEVELOPMENT_PLAN §7](DEVELOPMENT_PLAN.md)); stage 13 is beta, launch and scaling.

## 31. Future roadmap

Beyond the launch region: more regions by the procedure DP-13.9, more languages, Android via F-Droid (stage 14).
iOS, CarPlay, Android Auto and Google Play are BLOCKED by store fees (ADR-015).

## 32. Known limitations

- Web apps cannot navigate with the screen locked or in the background (browsers pause location); no CarPlay/Android
  Auto from the web.
- No live traffic yet (own crowdsourcing planned, stage 10) and no official incident feed for Georgia.
- No official weather warnings yet; road-surface wording is a derived estimate.
- Until stage 6 the code calls public services with usage limits (OSRM demo, FOSSGIS, Nominatim, Photon, Overpass,
  Open-Meteo, Transitous); they have no SLA and are removed by DEVELOPMENT_PLAN stage 6.
- Weather radar does not exist for Georgia/the Caucasus; the precipitation layer there is a model estimate.
- One Cloudflare container is at most 4 vCPU / 12 GiB / 20 GB ephemeral disk; engines are planned per region, and
  planet-wide routing/search may need a different placement (capacity pilot DP-5.6).
- Transit coverage is what operators publish (Tbilisi buses/metro yes; Georgian intercity trains returned no
  itineraries on 2026-10-02).
- Geocoding can pick a same-named place elsewhere (e.g. "Tavisupleba Square" → Kobuleti).
- Long Trip Mode: car only; hotels/places only as mapped in open data (no ratings, prices or availability); no fuel
  prices in Georgia; no truck road restrictions yet; pace presets are preferences, not legal driving limits.

## 33. Known technical debt

| ID | Debt | Impact | Plan |
| --- | --- | --- | --- |
| DEBT-001 | `state/store.ts` ~2,000 lines | hard to change safely | split by concern (route, weather, navigation, reports) behind the same selectors |
| DEBT-002 | Report listing fans out into ≤24 requests per refresh | Worker/DO requests | one corridor request (REQ-CF-009, DP-7.2) |
| DEBT-003 | Single global `Reports` Durable Object | ~1,000 req/s ceiling | shard by region (REQ-CF-008, DP-7.2) |
| DEBT-005 | No linter | style drift | ESLint (REQ-CI-003, DP-11.6) |
| DEBT-007 | Observability disabled | blind in production | REQ-OBS-002, DP-3.3 |
| DEBT-008 | Overpass called live per route (and per trip stop / borders) | violates its usage guidance at scale | our Places API and client borders (DP-4.5, DP-6.5) |
| DEBT-009 | Main JS chunk 604 KB (196 KB gz) | LCP on slow phones | more lazy chunks (REQ-PERF-004, DP-11.5) |
| DEBT-010 | Weather thresholds duplicated in 7 files with different values (B-08) | inconsistent alerts vs trip risks | REQ-WX-009, DP-11.1 |
| DEBT-011 | `forecasts` map in the app store is never pruned (B-11) | memory in long sessions | DP-1.9 |
| DEBT-012 | `derive` throttle never applies during real navigation (B-10) | CPU/battery per GPS fix | DP-1.9 |
| DEBT-013 | Dev dependency `undici` (via `wrangler` 4.142) has a high advisory (B-16) | local/CI tooling | update `wrangler` (DP-11.6) |
| DEBT-014 | The repository lives in an iCloud-synced folder, which created 17 duplicate files `* 2.*` (removed 2026-10-04) | duplicates may reappear | move the repo out of iCloud sync (DP-0.2) |

## 34. External dependencies

**Today (until DEVELOPMENT_PLAN stage 6):**

| Dependency | Used for | Verdict (see matrix) |
| --- | --- | --- |
| Cloudflare Workers, Durable Objects, rate limiting | hosting, API, live share, reports | SAFE |
| OpenFreeMap (+ OpenMapTiles schema, OSM data) | vector tiles | SAFE (no limits; no SLA) — stays as fallback |
| MapLibre GL JS | rendering | SAFE (BSD-3-Clause) |
| OSRM public demo + FOSSGIS routing servers | car/walk/bike routing | NOT ALLOWED in the target (limits) → Valhalla |
| Nominatim (OSMF), Photon (komoot) | search, autocomplete, reverse | NOT ALLOWED in the target (limits) → own geocoder |
| Overpass public instances | places, POIs, speed limits, cameras; trip places and borders | NOT ALLOWED in the target (limits) → Places API, Natural Earth |
| Open-Meteo (free API) | forecasts, elevation, air quality | NOT ALLOWED in the target (limits) → own weather pipeline |
| Transitous | public transport | NOT ALLOWED in the target (terms) → own MOTIS |
| Browser speech (Google voices in Chrome) | TTS, push-to-talk | allowed (browser capability); on-device voices planned (DP-9.12) |

**Target:** free software on Cloudflare and open data only — [FREE_STACK_PLAN §4–§6a](FREE_STACK_PLAN.md).

## 35. Licensing requirements

Code: currently no licence file (all rights reserved by default) — owner decision D1 (recommended: public, MIT).
Data/services: per [LICENSING_MATRIX](legal/LICENSING_MATRIX.md) and [FREE_STACK_PLAN §10](FREE_STACK_PLAN.md).
Attribution strings live in `src/i18n/*` (`ui.attribution`) and the map's attribution control.

## 36. Architectural decisions

Recorded in [architecture/decisions/](architecture/decisions/README.md): ADR-001 Cloudflare-first on Workers ·
ADR-002 Vite + React SPA · ADR-003 client engines, thin edge · ADR-004 routing engine (Valhalla) · ADR-006 map stack ·
ADR-007 data storage · ADR-008 identity · ADR-009 API versioning · ADR-010 mobile stack (proposed) · ADR-011 public
transport (MOTIS) · ADR-012 offline · ADR-013 long-trip planner · ADR-015 always free, only hosting paid · ADR-016 all on
Cloudflare Workers, localhost parity.

## 37. Open questions (owner decisions needed)

Listed with recommendations in [DEVELOPMENT_PLAN §9](DEVELOPMENT_PLAN.md) (D1–D10): repository licence and visibility,
when to enable Workers Paid, launch region, speed-camera default, Georgian UI, project contact, native iOS, traffic
probes, domain, geocoder choice.

## 38. Requirements requiring verification

| Item | Why | When |
| --- | --- | --- |
| Workers Logs option to exclude invocation URLs | needed for REQ-PRIV-004 | before REQ-OBS-002 (DP-3.3) |
| Cloudflare Containers capacity for regional engines, cold starts, account limits | placement of Valhalla/MOTIS (REQ-CF-017) | capacity pilot DP-5.6 |
| Valhalla `format=osrm` compatibility with our OSRM normaliser | eases DP-6.2 | DP-6.2 |
| D1 FTS5 geocoder quality vs Photon on control queries | decision D10 | DP-4.4 |
| MeteoAlarm reuse terms and whether Georgia is covered | REQ-WX-006 | DP-8.9 |
| Licence of the `kokoro-ru` voice model | on-device voice | DP-9.12 |
| Georgian Railway feed returning no itineraries | upstream data issue | DP-5.3 |
| Apple privacy-manifest and EU default-navigation-app requirements | only if native iOS is ever unblocked | — |
| CCPA/CPRA thresholds | official site unreachable at verification time | before a US launch |
| Georgian Law on Personal Data Protection (2023) obligations for this app | legal review | before the Georgian public launch |
| Whether a deployment exists; whether CI runs on GitHub Actions | no record found on 2026-10-03 | DP-3.1 |

---

*Last full review: 2026-10-04 (documentation cleanup). Update the status columns in the same commit that changes the
implementation.*
