# navWeather HTTP API — v1

Base path: **`/api/v1`** on the app's origin. The unversioned `/api/…` paths
are aliases of v1 for clients from before versioning (ADR-009). Types are
shared code: `src/api/v1.ts`, `src/share/protocol.ts`, `src/reports/protocol.ts`.

Status column: **IMPLEMENTED** (live in `worker/index.ts`) or **PLANNED**
(designed here; built by the task named in [DEVELOPMENT_PLAN](../DEVELOPMENT_PLAN.md)).

## Conventions

- JSON in and out, UTF-8. Writes require `Content-Type: application/json`
  (415 otherwise). Bodies are size-capped (413 / 400).
- **Errors:** `{ "error": "<code>" }` with an HTTP status; never stack traces.
  Common codes: `bad-request` 400, `forbidden` 403, `not-found` 404,
  `method-not-allowed` 405, `unsupported-media-type` 415, `too-many-requests`
  429, `unavailable` 503, `unsupported-api-version` 404.
- **CSRF:** non-GET requests whose `Sec-Fetch-Site` is present and not
  `same-origin`/`none` are refused (403). Native clients don't send this
  header and authenticate with tokens instead (PLANNED endpoints).
- **Caching:** API responses are `Cache-Control: no-store` unless stated.
- **Rate limits** are per client IP today (Workers rate-limiting binding,
  per Cloudflare location, intentionally approximate); with accounts, per user.
- **Compatibility:** v1 only changes additively. Clients must ignore unknown fields.
- **Privacy:** no endpoint returns another user's position except a live share
  the viewer holds the capability link for.

## Implemented

### `GET /health`
`200 { "ok": true, "api": 1 }`. Touches no storage. For uptime checks.

### `GET /whereami`
Approximate area of the connection (Cloudflare `request.cf`), used when the
device can't give a position. `200 { lat, lon, city, country }` or
`404 { error: "unknown" }`. Nothing stored. No CORS headers.

### Live location sharing

| Method & path | Auth | Body | Responses |
| --- | --- | --- | --- |
| `POST /share` | none; rate limit 6/min per IP | `{ "minutes": 15–1440, "name"?: string ≤40 }` | `201 { id, key, expiresAt }` — `id` 128-bit capability (22 chars), `key` 256-bit sharer secret (only its SHA-256 stored); 400, 415, 429, 503 |
| `GET /share/:id` | capability id | — | `200 ShareSnapshot` (latest position only, trip, destination, ETA); 404 |
| `GET /share/:id/ws` | capability id | WebSocket upgrade | stream of `{type:"snapshot"}` / `{type:"ended"}`; 426 without upgrade; 429 too many viewers |
| `PUT /share/:id` | `Authorization: Bearer <key>` | `ShareUpdate` ≤48 KB (position, optional trip/route ≤500 points) | `200 { ok, needsRoute, expiresAt }` (`stale: true` for out-of-order); 403, 404, 413, 429 (`too-fast`, <1 s apart) |
| `DELETE /share/:id` | Bearer key | — | `200 { ok: true }` — everything deleted, viewers told |

### Driver reports

| Method & path | Body | Responses |
| --- | --- | --- |
| `GET /reports?bbox=w,s,e,n` | bbox ≤36 deg² | `200 { reports: PublicReport[] ≤400, now }`; rate limit 120/min per IP |
| `POST /reports` | `{ kind: accident\|hazard\|roadworks\|closure\|weather, lat, lon }` ≤300 B | `201 { id, expiresAt }` or `200 { id, expiresAt, merged: true }` (same kind within 150 m = confirmation); 429 (10/min per IP; 30/day per reporter hash); 503 when full |
| `POST /reports/:id/vote` | `{ vote: "still" \| "gone" }` | `200 { confirms, denies, expiresAt, active }`; 409 `own-report` / `already-voted`; 404 |

`PublicReport = { id, kind, lat, lon, createdAt, expiresAt, confirms, denies }`.
Reports are **unverified** by definition; clients must label them "reported".

### Long-trip planner ([LONG_TRIP_MODE](../features/LONG_TRIP_MODE.md), ADR-013)

Stateless: requests are validated (`src/trip/protocol.ts`, `src/trip/borders.ts`),
answered and discarded. Rate limit `TRIP_LIMITER`: 20/min per IP, shared by the three.

| Method & path | Body | Responses |
| --- | --- | --- |
| `POST /trips/plan` | `TripPlanRequest` ≤400 KB: `route` {id, polyline (precision 5, a point every `stepM` ≥ 500 m), `stepM`, `timesS` (cumulative driving s), `distanceM`, origin, destination, tz?}, `departAtMs` (−2 d … +16 d), `vehicle` {kind, powertrain, rangeKm?, fullRangeKm?}, `preferences` {pace, hotelMinStars, hotelMaxDetourKm, food, fuelBrand}, `places`? (≤200 settlements), `weather`? (≤200 samples of hourly hazard codes), `progress`? (replanning), `overnightsM`? (user-chosen nights), `locale` | `200 TripPlan` (no place lookups — fast); 400 `bad-request` / `bad-route`; 413; 415; 429; 503 |
| `POST /trips/places` | `StopPlacesRequest` ≤40 KB: `stop` {lat, lon, kinds, arriveMs, tz}, `route` (polyline ±30 km), `vehicle`, `preferences`, `locale` | `200 { places: StopPlaces[] }` — per category `ok` / `none-found` / `unavailable` (Overpass failed); edge-cached by area for 24 h |
| `POST /trips/borders` | `{ version: 1, points: [lon,lat][] (2–20), alongM: number[], locale }` | `200 { countries: ({code,name}|null)[], crossings: {alongM, from, to}[] }`; 503 when Overpass is unavailable; edge-cached for 7 days |

Types: `src/trip/types.ts`. Positions sent are the planned route (needed to
plan it); the car's position is sent only as `progress.alongM` (a distance
along that route) when replanning.

## Planned

All planned endpoints are served by the same Worker on Cloudflare (ADR-016); engines behind them run in Containers,
data in D1/R2. Each contract is finalised here when its DEVELOPMENT_PLAN task starts. No endpoint proxies a
third-party service with usage limits (ADR-015).

### `POST /reports/query` — PLANNED (DP-7.2, REQ-CF-009)
Replaces up to 24 bbox requests per refresh. Body: `{ "corridor": <encoded polyline, precision 5, ≤500 points>,
"widthM": 300 }` → same response as the bbox list. Server-side: decode, bbox prefilter, distance-to-line filter.

### `POST /route` — PLANNED (DP-5.2, ADR-004)
Body: `{ mode: drive|walk|bike|truck|motorcycle, points: [[lon,lat]…] ≤5, alternatives?: bool,
avoid?: [tolls|highways|ferries], vehicle?: {heightM, weightT…}, bearingDeg?, departAtMs?|arriveByMs? }` →
`{ routes: Route[] }` (normalised, same type as `src/types/route.ts`). Valhalla in Containers; identical requests cached
briefly; never logged with coordinates. Related: `POST /route/matrix`, `POST /route/optimize`, `POST /route/isochrone`
(DP-9.4, DP-9.5).

### `GET /geocode` — PLANNED (DP-4.4)
`?q=&lang=&near=lon,lat` (search and autocomplete) and `?reverse=lon,lat&lang=` → `{ places: Place[] }`. FTS5 index in
D1 per country (Photon in Containers only if decision D10 says so).

### `/places/*` — PLANNED (DP-4.3)
`GET /places/tile/:z/:x/:y?cat=` (cacheable), `POST /places/corridor` (polyline + width + categories; also speed
limits, cameras, level crossings), `GET /places/:id` → normalised places with source and licence per record.

### `GET /weather/*` — PLANNED (DP-4.6)
`GET /weather/cells?ids=` (forecast cells: grid cell + model run, hourly variables), `GET /weather/meta` (latest model
runs) → shapes compatible with `WeatherService`. Cells are files in R2 produced by our pipeline; air quality the same way.

### `POST /transit` — PLANNED (DP-5.3)
MOTIS `plan` request shape (`fromPlace`, `toPlace`, `time`, `arriveBy`) → itineraries, as consumed by `MotisProvider`.

### `GET /radar/*` — PLANNED (DP-5.4)
Tile endpoints of LibreWXR (precipitation; "model estimate" where no radar exists).

### `POST /telemetry` — PLANNED (REQ-OBS-003/004)
Body: `{ appVersion, events: [{ kind: "engine-error"|"client-error", component?, code, count }] }` — counts only, no
coordinates, no ids → Workers Analytics Engine.

### Push — PLANNED (DP-7.5)
`POST /push/subscribe` · `DELETE /push/subscribe` (Web Push subscription, VAPID); opt-in only.

### Accounts — PLANNED (DP-7.6, ADR-008)
| Method & path | Purpose |
| --- | --- |
| `POST /auth/passkey/register/options` · `POST /auth/passkey/register` | create account / add passkey (WebAuthn) |
| `POST /auth/passkey/login/options` · `POST /auth/passkey/login` | sign in |
| `POST /auth/refresh` | mobile: rotate refresh token → new access token |
| `POST /auth/logout` | revoke current session |
| `GET /account` | profile, sign-in methods, sessions |
| `DELETE /account` | delete account and all associated data now |
| `GET /settings` · `PUT /settings` | synced preferences (JSON document with version) |
| `GET /saved-places` · `POST /saved-places` · `PATCH /saved-places/:id` · `DELETE /saved-places/:id` | synced saved places with `updatedAt` for merge |
| `GET /lists/:id` · `POST /lists` · … | shared lists of places (DP-9.10) |

No e-mail or SMS sign-in (no paid sending service). Auth: web — `HttpOnly; Secure; SameSite=Lax` session cookie;
mobile — `Authorization: Bearer <access token>` (15 min) + refresh token rotation. Unauthenticated → 401
`{ error: "unauthenticated" }`.

### Not planned (by design)
`POST /routes` storing routes, `GET /routes/:id/weather`, location history,
`GET /notifications` before mobile push exists. Route weather is computed by
the shared client core (ADR-003); a server variant is added only if a native
client cannot run it.
