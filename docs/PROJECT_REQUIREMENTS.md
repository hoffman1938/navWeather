# navWeather — Project Requirements (single source of truth)

> **Status of this document:** v1.0, created 2026-10-02 from the owner's
> platform brief and a full audit of the repository
> ([audit report](audit/2026-10-02-platform-audit.md)). It states what the
> system **should** be. The source code states what the system **currently
> is**. Every session compares the two (see [AGENTS.md](../AGENTS.md)).
>
> Change control: a new or changed requirement is written here first, with an
> ADR in [architecture/decisions/](architecture/decisions/) when it is
> architecturally significant, then implemented, tested and documented
> (§36, §38). Nothing in this file may be silently overridden by code or by a
> chat conversation.

**Priorities:** P0 critical · P1 high · P2 medium · P3 future.
**Statuses:** PLANNED · IN PROGRESS · IMPLEMENTED · VERIFIED (implemented and
covered by automated tests or a recorded check) · BLOCKED · DEPRECATED · FUTURE.
**Traceability:** each requirement names the code, tests and docs that carry it.

---

## 1. Product vision

navWeather is a navigation platform whose core is **NAVIGATION + ROUTE + TIME +
WEATHER + PREDICTION + ALERTS**: for every part of the actual route it works
out where the traveller will be, when, and what the forecast is for that place
at that time, and warns them before significant weather in time to act
("Heavy rain expected in about 18 minutes, near Khashuri"). It is not merely a
map site, a weather site or a route calculator, and future work must keep that
direction (§79 of the brief).

## 2. Product goals

| ID | Goal | Priority | Status |
| --- | --- | --- | --- |
| GOAL-1 | A trustworthy answer to "what weather will I drive into, and when?" for any road trip | P0 | IMPLEMENTED |
| GOAL-2 | Turn-by-turn navigation good enough to drive with, on the web today and natively later | P0 | IMPLEMENTED (web limits: §19) |
| GOAL-3 | Timely, non-spammy weather alerts that separate forecast, derived estimate and official warning | P0 | PARTIALLY (no official warnings, §17) |
| GOAL-4 | Run at near-zero cost during MVP; cost grows sub-linearly with users | P0 | IN PROGRESS (§29) |
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

### 3a. Long Trip Mode

Specification (source of truth): [features/LONG_TRIP_MODE.md](features/LONG_TRIP_MODE.md);
decision: [ADR-013](architecture/decisions/ADR-013-trip-planner.md).

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-TRIP-001 | One trip classification engine (SHORT/MEDIUM/EXTENDED/LONG) with configurable thresholds — never hard-coded in components | P1 | VERIFIED | `src/trip/config.ts`, `classification/classify.ts`; `trip.test.ts` |
| REQ-TRIP-002 | Long Trip Mode on automatically (distance, driving time, overnight, several breaks), user override, non-blocking | P1 | VERIFIED | `state/trip.ts`, `components/Trip/LongTrip.tsx`; `trip.test.tsx` |
| REQ-TRIP-003 | Trip plan: segments, breaks, meals, fuel/charge, overnights, days, timeline | P1 | VERIFIED | `planning/schedule.ts`, `planner.ts` |
| REQ-TRIP-004 | Every ETA and forecast match includes planned stop durations (weather at the real times) | P0 | VERIFIED | `state/derive.ts` (`tripStops`), `routeIntelligence.ts` (`dwellBeforeS`) |
| REQ-TRIP-005 | Overnight areas from driving time, latest arrival, settlement size, no-extra-night rule; user can choose another town | P1 | VERIFIED | `planning/overnight.ts`, `chooseOvernight` |
| REQ-TRIP-006 | Hotels from OpenStreetMap near the area, within the user's distance; never claim availability | P1 | VERIFIED | `stops/recommend.ts`, `/api/v1/trips/places` |
| REQ-TRIP-007 | Fuel/charging only from user-declared range or tank + consumption; never estimated | P1 | VERIFIED | `schedule.ts`, `settings.ts` (`fullRangeKm`) |
| REQ-TRIP-008 | Meal places closed at the planned arrival are excluded (OSM opening hours, safe subset) | P1 | VERIFIED | `stops/openingHours.ts` |
| REQ-TRIP-009 | Weather risks at stop-aware times; "stop earlier" advice with reason, never applied silently | P1 | VERIFIED | `weather/risks.ts` |
| REQ-TRIP-010 | Replan from the car when ≥ 20 min off plan (10 min cooldown), carry today's driving over re-routes; announce arrival changes ≥ 15 min | P1 | VERIFIED | `state/trip.ts`, `replanning/progress.ts` |
| REQ-TRIP-011 | Planned stops as route events replacing generic break/fuel reminders; no notification spam | P1 | VERIFIED | `routeIntelligence.ts` |
| REQ-TRIP-012 | Border crossings along the route (OSM countries), shown in dashboard and timeline | P2 | VERIFIED | `trip/borders.ts`, `/api/v1/trips/borders` |
| REQ-TRIP-013 | Vehicle-specific planning: car/van/motorcycle/truck/EV (stops and places); truck road restrictions | P2 | PARTIALLY (restrictions BLOCKED until Valhalla, ADR-004) | `stops/places.ts`, `recommend.ts` |
| REQ-TRIP-014 | Preferences: pace, hotel stars and distance, food, fuel brand (device-only) | P1 | IMPLEMENTED | `SettingsDialog.tsx` (Long trips) |
| REQ-TRIP-015 | Planner stateless on Cloudflare; no stored trips, no position logs; Queues/D1 not used | P0 | IMPLEMENTED | `worker/trips.ts`, ADR-013 |
| REQ-TRIP-016 | Jurisdiction-specific driving/rest rules for commercial drivers | P3 | PLANNED (needs verified rules) | — |
| REQ-TRIP-017 | Cheapest-fuel and live hotel availability | P3 | BLOCKED (no open/verified data source) | — |

## 4. Supported platforms

| ID | Platform | Priority | Status |
| --- | --- | --- | --- |
| REQ-PLAT-001 | Web (desktop, tablet, iPhone, Android), installable PWA | P0 | IMPLEMENTED |
| REQ-PLAT-002 | iOS native app | P2 | PLANNED (Phase 4, [MOBILE](mobile/MOBILE_STRATEGY.md)) |
| REQ-PLAT-003 | Android native app | P2 | PLANNED (Phase 5) |
| REQ-PLAT-004 | Apple CarPlay (navigation entitlement) | P3 | FUTURE (Phase 6) |
| REQ-PLAT-005 | Android Auto (Car App Library, NAVIGATION category) | P3 | FUTURE (Phase 7) |
| REQ-PLAT-006 | Wearables, vehicle integrations, public API | P3 | FUTURE |

## 5. Architecture principles

1. **Correctness first, then safety, privacy, reliability, simplicity,
   performance, scalability, cost, UX, advanced features** (owner's order).
2. **Only real data.** No source → the feature says "not available"; simulation
   is always labelled; driver reports are "reported", never fact.
3. **Deterministic engines.** Routing, ETA, weather matching, alerts and
   navigation are pure, tested TypeScript (`src/algorithms`, `src/intelligence`,
   `src/navigation`) with no React/DOM dependency, so they can serve every
   client. AI may explain or converse, never replace them (§58 of the brief).
4. **Provider-agnostic.** Business logic sees interfaces; `services/providers.ts`
   is the only place naming implementations. Swapping a provider is configuration.
5. **Cloudflare-first** ([ADR-001](architecture/decisions/ADR-001-cloudflare-first.md)):
   an external service only when Cloudflare cannot reasonably provide it, with
   the reason, cost and lock-in written down.
6. **Thin, versioned edge API; no server state that isn't needed**
   ([ADR-003](architecture/decisions/ADR-003-client-engines-thin-edge.md)).
7. **Do not over-engineer.** Each infrastructure component answers: required
   for MVP? what problem? can MVP work without it? what triggers it later?
   ([TARGET_ARCHITECTURE](architecture/TARGET_ARCHITECTURE.md) §2).

## 6. Cloudflare architecture

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-CF-001 | One Worker with static assets serves the app and `/api/*` (not Pages; see ADR-001) | P0 | IMPLEMENTED | `wrangler.toml`, `worker/index.ts` |
| REQ-CF-002 | Durable Objects only where a single coordinated state is needed (live share per link, reports) | P1 | IMPLEMENTED | `worker/liveShare.ts`, `worker/reports.ts` |
| REQ-CF-003 | Per-client rate limits on every write and on report listing | P0 | IMPLEMENTED | `wrangler.toml [[ratelimits]]`, `worker/index.ts` |
| REQ-CF-004 | D1 introduced only with optional accounts (Phase 3) | P2 | PLANNED | [DATA_MODEL](database/DATA_MODEL.md), `database/migrations/0001_accounts.sql` (proposed, not applied) |
| REQ-CF-005 | Shared edge cache for weather (Worker + Cache API/KV) before a beta beyond ~25 daily users | P1 | PLANNED | [ADR-005](architecture/decisions/ADR-005-weather-provider.md), [COST](operations/COST_AND_SCALE.md) |
| REQ-CF-006 | Queues, R2, Cron Triggers only when a listed trigger occurs | P2 | PLANNED | [TARGET_ARCHITECTURE](architecture/TARGET_ARCHITECTURE.md) §2 |
| REQ-CF-007 | Workers Paid plan ($5/month minimum) before public beta | P1 | PLANNED | [COST](operations/COST_AND_SCALE.md) §3 |
| REQ-CF-008 | Shard the single `Reports` object by region before it nears ~1,000 req/s | P2 | PLANNED | [SCALE](operations/COST_AND_SCALE.md) |
| REQ-CF-009 | Report listing as one corridor request instead of up to 24 box requests | P1 | PLANNED | `services/traffic/ReportsIncidentProvider.ts`, [API_V1](api/API_V1.md) |
| REQ-CF-010 | Trip planner endpoints (`/api/v1/trips/plan|places|borders`) stateless, rate-limited (`TRIP_LIMITER`), places/borders edge-cached | P1 | IMPLEMENTED | `worker/trips.ts`, `wrangler.toml` |

## 7. Map architecture

Map **data** (OpenStreetMap), map **rendering** (MapLibre GL JS), **tiles**
(OpenFreeMap vector tiles), **geocoding** (Nominatim, Photon), **routing**
(OSRM), **traffic** (none), **weather** (Open-Meteo) are separate systems with
separate licences and failure modes ([MAPS_ROUTING_GEO](architecture/MAPS_ROUTING_GEO.md)).

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-MAP-001 | MapLibre GL JS rendering of OpenFreeMap vector styles (light/dark) | P0 | IMPLEMENTED | `components/Map/RouteMap.tsx`, `services/map/MapProvider.ts` |
| REQ-MAP-002 | Attribution visible: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" on the map; data/routing credits + "Report a map error" in the sheets | P0 | IMPLEMENTED | `RouteMap.tsx` (AttributionControl), `components/Common/Attribution.tsx` |
| REQ-MAP-003 | A self-hostable fallback tile source (PMTiles on R2) before public launch | P2 | PLANNED | [ADR-006](architecture/decisions/ADR-006-map-stack.md) |
| REQ-MAP-004 | No bulk/automated tile downloading (OpenFreeMap ToS) | P0 | IMPLEMENTED | service worker never caches tiles (`public/sw.js`) |

## 8. Routing architecture

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-ROUTE-001 | Respect the public OSRM servers' policy: ≤1 request/s per user, light non-commercial use | P0 | IMPLEMENTED | per-server queue in `OSRMProvider.ts` (`VITE_OSRM_MIN_INTERVAL_MS`); `OSRMProvider.test.ts` |
| REQ-ROUTE-002 | Self-hosted router before public beta (public OSRM is non-commercial, no SLA) | P0 | PLANNED | [ADR-004](architecture/decisions/ADR-004-routing-engine.md) — Valhalla recommended |
| REQ-ROUTE-003 | Avoid tolls/highways/ferries, truck profiles once the router supports them | P2 | BLOCKED (public server) | ADR-004 |
| REQ-ROUTE-004 | Live traffic only from a real provider; "not available" otherwise | P2 | IMPLEMENTED (none) | `services/traffic/TrafficProvider.ts` |
| REQ-ROUTE-005 | Public transport from open timetables (Transitous), labelled, switchable off | P2 | IMPLEMENTED | `TransitousProvider.ts`; [ADR-011](architecture/decisions/ADR-011-public-transport.md) |

## 9. Weather architecture

Details: [WEATHER_ENGINE](architecture/WEATHER_ENGINE.md).

| ID | Requirement | Priority | Status | Traceability |
| --- | --- | --- | --- | --- |
| REQ-WX-001 | Route → adaptive samples → ETA → grid-snapped batched forecasts → cached → matched at ETA → timeline → alerts | P0 | VERIFIED | `routePlanner.ts`, `WeatherService.ts`, `weatherMatching.ts` |
| REQ-WX-002 | Forecast values never extrapolated past the forecast horizon; interval vs instant semantics | P0 | VERIFIED | `weatherMatching.ts`; tests |
| REQ-WX-003 | Every value labelled RAW FORECAST, DERIVED ESTIMATE or OFFICIAL WARNING in UI and voice | P0 | PARTIALLY (forecast/estimate yes; official warnings not integrated) | `components/Plan/DataSources.tsx`; REQ-WX-006 |
| REQ-WX-004 | Stale forecasts shown as stale; model-run-aware refresh; offline keeps last forecast | P0 | VERIFIED | `WeatherService.ts`, `store.ts refreshIfStale` |
| REQ-WX-005 | Weather requests through a shared edge cache with a paid key before a beta beyond ~25 daily users or any commercial use (the app as a whole passes the free tier's 10,000 calls/day at ~30 DAU) | P1 | PLANNED | ADR-005, COST_AND_SCALE §2 |
| REQ-WX-006 | Official warnings (national services / MeteoAlarm where licensed), labelled "official" | P2 | PLANNED (source & licence REQUIRE VERIFICATION per country) | ADR-005 |
| REQ-WX-007 | Request ≤10 weather variables per call where possible (Open-Meteo counts more as extra calls) | P2 | PLANNED (currently 14) | `OpenMeteoProvider.ts`; [COST](operations/COST_AND_SCALE.md) |

## 10. Authentication architecture

[ADR-008](architecture/decisions/ADR-008-identity.md). **Anonymous first:**
everything that works today keeps working with no account.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-AUTH-001 | No account needed for search, routing, weather, navigation, sharing, reports | P0 | IMPLEMENTED |
| REQ-AUTH-002 | Optional account (passkeys + email link) only to sync saved places/settings across devices | P2 | PLANNED (Phase 3) |
| REQ-AUTH-003 | Opaque server sessions (HttpOnly cookie on web, Bearer token in Keychain/Keystore on mobile); no long-lived JWTs | P2 | PLANNED |
| REQ-AUTH-004 | In-app account deletion (Apple 5.1.1(v), Google Play) + web deletion page | P2 | PLANNED (required before mobile launch with accounts) |
| REQ-AUTH-005 | Third-party sign-in (Apple/Google) only together, and only if demand exists (Apple 4.8) | P3 | FUTURE |

## 11. Database architecture

[DATA_MODEL](database/DATA_MODEL.md), [ADR-007](architecture/decisions/ADR-007-data-storage.md).

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-DATA-001 | No server database for MVP: preferences and saved places live on the device | P0 | IMPLEMENTED |
| REQ-DATA-002 | D1 for accounts, sessions, settings, saved places (when accounts ship) | P2 | PLANNED |
| REQ-DATA-003 | Never store positions, routes or trip history on the server unless a user opts in to a named feature | P0 | IMPLEMENTED |
| REQ-DATA-004 | Real-time state (live share, reports) in Durable Objects with expiry | P1 | IMPLEMENTED |
| REQ-DATA-005 | Weather cache in Cache API/KV, never D1 | P1 | PLANNED (with REQ-WX-005) |

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
| REQ-SEC-006 | Turnstile on account creation / email login when accounts ship | P2 | PLANNED |
| REQ-SEC-007 | WAF + Cloudflare rate-limiting rules on the zone before public launch | P1 | PLANNED (needs custom domain) |
| REQ-SEC-008 | Dependency updates monitored (Dependabot) and CI on every PR | P1 | IMPLEMENTED (`.github/`) |

## 14. Privacy requirements

[PRIVACY](legal/PRIVACY.md).

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-PRIV-001 | No location history; positions/routes never stored server-side | P0 | IMPLEMENTED |
| REQ-PRIV-002 | Route history, if ever offered, is OFF by default and opt-in, device-first | P0 | IMPLEMENTED (not offered) |
| REQ-PRIV-003 | Third parties receive only what each request needs (coordinates for routing/weather); documented per provider | P0 | IMPLEMENTED (documented here and in PRIVACY) |
| REQ-PRIV-004 | Logs and analytics never contain precise coordinates or bbox/route query strings | P0 | IMPLEMENTED (observability off); must hold when logs are enabled |
| REQ-PRIV-005 | Privacy Policy, Terms, data-deletion page published before public beta (legal review) | P1 | PLANNED |
| REQ-PRIV-006 | Consent banner not needed while only strictly-necessary device storage is used; re-assess with analytics | P1 | IMPLEMENTED (no cookies/trackers) |

## 15. Legal / licensing requirements

[LICENSING_MATRIX](legal/LICENSING_MATRIX.md). Every external dependency has a
row with licence, commercial use, attribution, caching, limits and a
SAFE / REQUIRES REVIEW / NOT SUITABLE verdict, with source and verification date.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-LEGAL-001 | Attribution for OSM, OpenMapTiles, OpenFreeMap, Open-Meteo (CC BY 4.0), routing servers, Transitous | P0 | IMPLEMENTED |
| REQ-LEGAL-002 | Before ANY commercial use (ads, subscriptions): replace/upgrade Open-Meteo free, OSRM demo, Overpass public, Transitous, Nominatim public | P0 | PLANNED (gate) |
| REQ-LEGAL-003 | Repository public under an OSI licence if Transitous stays in use (its terms) | P1 | BLOCKED (owner decision; repo is private) |
| REQ-LEGAL-004 | Speed-camera alerts: legality varies by country; user responsibility shown in Settings | P1 | IMPLEMENTED (on by default — REQUIRES REVIEW, see Open questions) |

## 16. UX principles

Calm, fast, minimal, trustworthy, driver-focused, not "AI-looking". Complexity
lives in the engines, not on screen. While driving: one banner, voice first,
large targets, nothing to read for long ([UX_AND_GROWTH](product/UX_AND_GROWTH.md)).

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-UX-001 | Desktop side panel; phone bottom sheet (not a shrunken desktop) | P0 | IMPLEMENTED |
| REQ-UX-002 | While moving: no typing, no long lists, Report = 5 large buttons, voice push-to-talk | P0 | IMPLEMENTED |
| REQ-UX-003 | Navigation camera at street level (Google-Maps-like zoom), heading-up, auto re-centre | P1 | IMPLEMENTED |
| REQ-UX-004 | Every source shows its freshness (Forecast / Estimated / Scheduled / Stale / Simulated / Not available) | P0 | IMPLEMENTED |

## 17. Accessibility requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-A11Y-001 | WCAG 2.1 AA: axe-core 0 violations in all main states, light/dark | P1 | VERIFIED (PLAN.md §7.3, round 5) |
| REQ-A11Y-002 | Keyboard: focus traps in dialogs, Escape, focus return | P1 | VERIFIED |
| REQ-A11Y-003 | Touch targets ≥44 px; text never relies on colour alone | P1 | IMPLEMENTED |

## 18. Performance requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-PERF-001 | Core Web Vitals "good" on a mid-range phone: LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 | P1 | PLANNED (not measured; main JS 188 KB gz) |
| REQ-PERF-002 | MapLibre in its own lazy chunk; app shell paints first | P1 | IMPLEMENTED |
| REQ-PERF-003 | Position updates cost no network requests (weather re-matched locally) | P0 | IMPLEMENTED |
| REQ-PERF-004 | Split rarely used UI (settings, share, live viewer, dev panel) out of the main chunk | P2 | PLANNED |

## 19. Scalability requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-SCALE-001 | Upstream weather calls bounded by geography × refresh rate, not by user count (shared cache) | P1 | PLANNED |
| REQ-SCALE-002 | No single Durable Object on the hot path of every user at >1,000 req/s | P2 | PLANNED (shard Reports) |
| REQ-SCALE-003 | Self-hosted routing/geocoding/POI before public beta | P1 | PLANNED |

Model: [COST_AND_SCALE](operations/COST_AND_SCALE.md).

## 20. Mobile preparation requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-MOB-001 | Engines free of React/DOM so they can run in a mobile JS runtime or be ported | P0 | IMPLEMENTED |
| REQ-MOB-002 | Every server feature reachable via `/api/v1` with Bearer-token auth (no cookie-only flows) | P1 | PLANNED (accounts) |
| REQ-MOB-003 | Decide mobile stack via a time-boxed spike (background location, CarPlay, Android Auto) | P2 | PLANNED ([ADR-010](architecture/decisions/ADR-010-mobile-stack.md), PROPOSED) |
| REQ-MOB-004 | Voice layer as platform-neutral instruction IDs + params, rendered by a per-platform TTS adapter | P1 | IMPLEMENTED (web) / PLANNED (mobile) |

## 21. CarPlay requirements

CarPlay navigation needs Apple's CarPlay navigation entitlement (requested via
Apple's form), the CarPlay framework's map templates, and voice guidance through
the system audio session. Not possible from a web app. See
[MOBILE_STRATEGY](mobile/MOBILE_STRATEGY.md) §CarPlay. Status: FUTURE (P3).

## 22. Android Auto requirements

Car App Library, `androidx.car.app.category.NAVIGATION`,
`androidx.car.app.NAVIGATION_TEMPLATES`, `NavigationManager` trip updates,
map drawn on the provided surface, car-app quality guidelines. Not possible
from a web app. Status: FUTURE (P3).

## 23. Offline requirements

[ADR-012](architecture/decisions/ADR-012-offline.md).

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-OFF-001 | Offline app shell; loaded route, instructions and cached forecasts keep working, labelled stale | P0 | VERIFIED |
| REQ-OFF-002 | Never promise offline navigation the stack can't do (no offline routing/tiles on web today) | P0 | IMPLEMENTED |
| REQ-OFF-003 | Downloadable regions (PMTiles) and on-device routing only in native apps (Valhalla tiles) | P3 | FUTURE |

## 24. Internationalization requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-I18N-001 | No hard-coded UI text; messages per locale, lazy-loaded | P0 | IMPLEMENTED (en, ru) |
| REQ-I18N-002 | Georgian UI | P1 | **CONFLICT** — removed by owner decision (PLAN.md §7.7); the brief requires it. Owner to decide (Open questions #1). Transliteration of Georgian names stays. |
| REQ-I18N-003 | Metric/imperial units; 24 h/locale time; per-point IANA time zones, DST-safe (UTC internally) | P0 | VERIFIED |
| REQ-I18N-004 | Russian and (when restored) Georgian reviewed by native speakers before launch | P1 | PLANNED |
| REQ-I18N-005 | Future European/Asian languages via the same message catalogue; plural rules via Intl | P3 | FUTURE |

## 25. Testing requirements

[TESTING](TESTING.md), [DELIVERY](operations/DELIVERY.md) §Testing strategy.

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-TEST-001 | Unit + scenario tests for all engines (currently 548) | P0 | VERIFIED |
| REQ-TEST-002 | Worker smoke tests for share and reports, both API prefixes | P0 | VERIFIED (local) |
| REQ-TEST-003 | Special cases: time-zone crossing, provider failure, re-route, GPS drift/tunnel, offline, duplicate alerts, forecast update, long and international routes | P0 | PARTIALLY (see TESTING gaps) |
| REQ-TEST-004 | Real-device tests (iOS Safari, Android Chrome) before public beta | P1 | PLANNED |
| REQ-TEST-005 | Browser E2E (Playwright) for search → route → simulate → arrive | P2 | PLANNED |

## 26. CI/CD requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-CI-001 | PR checks: typecheck (app + Worker), unit tests, build, Worker smoke tests | P0 | IMPLEMENTED (`.github/workflows/ci.yml`) |
| REQ-CI-002 | Deploy to Cloudflare from CI with a scoped API token (manual trigger first) | P1 | IMPLEMENTED (`deploy.yml`, needs secrets) |
| REQ-CI-003 | Lint (ESLint) in CI | P2 | PLANNED (no linter configured yet) |
| REQ-CI-004 | D1 migrations applied by CI before code that needs them, backward compatible | P2 | PLANNED (with D1) |

## 27. Monitoring requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-OBS-001 | Uptime check on `/api/v1/health` | P1 | PLANNED (endpoint exists) |
| REQ-OBS-002 | Workers Logs with sampling, without request URLs/bodies containing coordinates | P1 | PLANNED (observability disabled; config REQUIRES VERIFICATION) |
| REQ-OBS-003 | Client error reports (no location, no PII) | P2 | PLANNED |
| REQ-OBS-004 | Provider failure rates (routing, weather, geocoding) visible | P2 | PLANNED |

## 28. Disaster recovery requirements

[DELIVERY](operations/DELIVERY.md) §Disaster recovery. MVP holds almost no
server data (live shares and reports expire by design). With D1: Time Travel
(7 days Free / 30 days Paid) plus a scheduled export; migrations forward-only
and backward compatible. Status: PLANNED.

## 29. Cost-control requirements

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REQ-COST-001 | Free tiers during MVP; every paid step has a written trigger | P0 | IMPLEMENTED (documented) |
| REQ-COST-002 | Batch, deduplicate (0.02° grid) and cache forecasts; refresh only on staleness or new model run | P0 | VERIFIED (client) |
| REQ-COST-003 | Browser → Worker → cache → provider for paid/keyed providers (never a key in the client) | P1 | PLANNED |
| REQ-COST-004 | Per-request estimates kept current in COST_AND_SCALE | P1 | IMPLEMENTED |

## 30. MVP scope

See [ROADMAP](ROADMAP.md) §MVP for MUST / SHOULD / COULD / NOT NOW.
Summary: the current web app already exceeds the MVP feature set; the
remaining MVP work is **compliance and operability** — self-hosted routing,
provider terms, legal pages, monitoring, real-device testing.

## 31. Future roadmap

Phases 0–8 in [ROADMAP](ROADMAP.md): architecture → web MVP → private beta →
public beta → iOS → Android → CarPlay → Android Auto → international.

## 32. Known limitations

- Web apps cannot navigate with the screen locked or in the background
  (browsers pause location); no CarPlay/Android Auto from the web.
- No live traffic and no official incident feed for Georgia.
- No official weather warnings yet; road-surface wording is a derived estimate.
- Public OSRM, Overpass, Nominatim, Photon, Transitous and Open-Meteo free are
  fair-use/non-commercial services with no SLA.
- Transitous covers Tbilisi buses/metro; Georgian Railway is listed in its
  sources but returned no itineraries for Tbilisi → Batumi on 2026-10-02.
- Geocoding can pick a same-named place elsewhere (e.g. "Tavisupleba Square" →
  Kobuleti); the result is shown, but the town is not named in transit errors.
- Long Trip Mode: car only; hotels/places only as mapped in OpenStreetMap (no
  ratings, prices or availability); no fuel prices; no truck road
  restrictions; pace presets are preferences, not legal driving limits;
  places and borders depend on the public Overpass server (slow at times).

## 33. Known technical debt

| ID | Debt | Impact | Plan |
| --- | --- | --- | --- |
| DEBT-001 | `state/store.ts` ~2,000 lines | hard to change safely | split by concern (route, weather, navigation, reports) behind the same selectors |
| DEBT-002 | Report listing fans out into ≤24 requests per refresh | Worker/DO request budget | one corridor request (REQ-CF-009) |
| DEBT-003 | Single global `Reports` Durable Object | ~1,000 req/s ceiling | shard by region (REQ-CF-008) |
| DEBT-004 | 14 Open-Meteo variables (counts as 1.4 calls) | cost at commercial scale | trim to ≤10 (REQ-WX-007) |
| DEBT-005 | No linter | style drift | add ESLint (REQ-CI-003) |
| DEBT-006 | Main JS chunk 583 KB (188 KB gz) | LCP on slow phones | code-split (REQ-PERF-004) |
| DEBT-007 | Observability disabled | blind in production | REQ-OBS-002 |
| DEBT-008 | Overpass used live per route (and per trip stop / borders) | violates heavy-use guidance at scale | precomputed OSM extracts / own Overpass (ADR-004) |
| DEBT-009 | Main JS chunk 604 KB after Long Trip Mode (196 KB gz) | LCP | more lazy chunks (REQ-PERF-004) |

## 34. External dependencies

| Dependency | Used for | Verdict (see matrix) |
| --- | --- | --- |
| Cloudflare Workers, Durable Objects, rate limiting | hosting, API, live share, reports | SAFE |
| OpenFreeMap (+ OpenMapTiles schema, OSM data) | vector tiles | SAFE (attribution; no SLA) |
| MapLibre GL JS | rendering | SAFE (BSD-3-Clause) |
| OSRM public demo + FOSSGIS routing servers | car/walk/bike routing | NOT SUITABLE for production; OK for development/private beta |
| Nominatim (OSMF) | typed search | REQUIRES REVIEW (no autocomplete; 1 req/s; heavy users self-host) |
| Photon (komoot) | autocomplete, reverse | REQUIRES REVIEW (fair use, terms informal) |
| Overpass public instances | places, POIs, speed limits, cameras; trip stop places and borders (from the Worker) | NOT SUITABLE for production volume |
| Open-Meteo (free) | forecasts, elevation, air quality | SAFE non-commercial / REQUIRES paid plan commercially |
| Transitous | public transport | REQUIRES REVIEW (open-source + non-commercial + contact) |
| Browser speech (Google voices in Chrome) | TTS, push-to-talk | REQUIRES REVIEW (text/audio go to the browser vendor; disclosed) |

## 35. Licensing requirements

Code: currently no licence file (all rights reserved by default) — owner
decision required (Open questions #2). Data/services: per
[LICENSING_MATRIX](legal/LICENSING_MATRIX.md). Attribution strings live in
`src/i18n/*` (`ui.attribution`) and the map's attribution control.

## 36. Architectural decisions

Recorded in [architecture/decisions/](architecture/decisions/README.md):
ADR-001 Cloudflare-first on Workers · ADR-002 Vite + React SPA · ADR-003
client engines, thin edge · ADR-004 routing engine · ADR-005 weather provider
and edge cache · ADR-006 map stack · ADR-007 data storage · ADR-008 identity ·
ADR-009 API versioning · ADR-010 mobile stack (proposed) · ADR-011 public
transport · ADR-012 offline · ADR-013 long-trip planner (stateless Worker).

## 37. Open questions (owner decisions needed)

1. **Georgian UI** was removed at the owner's request (PLAN.md §7.7); the
   platform brief lists Georgian as required. Restore before a Georgian
   launch? (Recommended: yes, with native review; the code path is known.)
2. **Code licence / public repository.** Transitous' terms require an
   open-source project; the repo is private with no licence. Open-source it,
   or replace Transitous (no free alternative found) / drop public transport.
3. **Commercial intent and timing.** Ads or subscriptions make Open-Meteo,
   OSRM demo, Overpass, Transitous and GraphHopper-free unusable as-is
   (REQ-LEGAL-002). When is the switch planned?
4. **Speed-camera alerts default ON** (README) vs PLAN.md §5 "off by default".
   Legality differs by country; recommended default OFF outside countries
   where they are known to be legal (legal review).
5. **Target countries for public beta** (drives routing extract size, official
   warning sources, legal review scope).
6. **Contact Transitous** before routing use, as their policy asks (owner action).

## 38. Requirements requiring verification

| Item | Why | Owner |
| --- | --- | --- |
| Open-Meteo per-location call counting and plan prices | pricing page shows allowances, not prices; counting of multi-location requests not stated | before commercial plan |
| Cloudflare Cache API on `*.workers.dev` | docs unclear; use a custom domain for edge caching | before REQ-WX-005 |
| Workers Logs option to exclude invocation URLs | needed for REQ-PRIV-004 | before REQ-OBS-002 |
| Cloudflare Containers for an always-on router (sleep/inactivity behaviour) | ADR-004 Growth option | before routing migration |
| Valhalla `format=osrm` compatibility with our OSRM normaliser | eases ADR-004 migration | spike |
| Georgian Railway in Transitous returning no itineraries | upstream data issue? | report upstream |
| Apple privacy-manifest and default-navigation-app (EU) developer requirements | Apple docs not machine-readable at verification time | Phase 4 |
| CCPA/CPRA thresholds | official site unreachable at verification time | before US launch |
| Georgian Law on Personal Data Protection (2023) obligations for this app | legal review | before Georgian public launch |
| Tomorrow.io free-tier terms | pricing page returned 404 | only if considered |
| Workers CPU per trip-plan request on the Free plan (10 ms) | long plans may exceed it | measure after deployment (REQ-CF-007) |
| Overpass usage from the Worker for trips (places, borders) | public instance asks for light use; edge cache helps | before public beta (self-host, ADR-004) |

---

*Last full review: 2026-10-02. Update the status columns in the same commit
that changes the implementation.*
