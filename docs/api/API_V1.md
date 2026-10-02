# navWeather HTTP API — v1

Base path: **`/api/v1`** on the app's origin. The unversioned `/api/…` paths
are aliases of v1 for clients from before versioning (ADR-009). Types are
shared code: `src/api/v1.ts`, `src/share/protocol.ts`, `src/reports/protocol.ts`.

Status column: **IMPLEMENTED** (live in `worker/index.ts`) or **PLANNED**
(designed here; build with the phase named in [ROADMAP](../ROADMAP.md)).

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

## Planned

### `POST /reports/query` — PLANNED (P1, REQ-CF-009)
Replaces up to 24 bbox requests per refresh. Body: `{ "corridor": <encoded
polyline, precision 5, ≤500 points>, "widthM": 300 }` → same response as the
bbox list. Server-side: decode, bbox prefilter, distance-to-line filter.

### `POST /weather/points` — PLANNED (Growth, ADR-005)
Body: `{ points: [{lat, lon}] ≤100 (≤4 decimals), untilMs }` → `{ forecasts:
LocationForecast[] keyed by grid cell, modelRun, stale: string[] }`. Edge
cache key = grid cell (0.02°) + model run; no user identifiers. Rate limit
per client; the Worker holds the provider key.

### `POST /route` — PLANNED (public beta, ADR-004)
Body: `{ mode: drive|walk|bike, points: [[lon,lat]…] ≤5, alternatives?:
bool, avoid?: [tolls|highways|ferries], bearingDeg? }` → `{ routes: Route[] }`
(normalised, same type as `src/types/route.ts`). Proxies the self-hosted
router; identical requests cached briefly; never logged with coordinates.

### `POST /telemetry` — PLANNED (REQ-OBS-003/004)
Body: `{ appVersion, events: [{ kind: "provider-error"|"client-error",
provider?, code, count }] }` — counts only, no coordinates, no ids → Workers
Analytics Engine.

### Accounts — PLANNED (Phase 3, ADR-008)
| Method & path | Purpose |
| --- | --- |
| `POST /auth/passkey/register/options` · `POST /auth/passkey/register` | create account / add passkey (WebAuthn) |
| `POST /auth/passkey/login/options` · `POST /auth/passkey/login` | sign in |
| `POST /auth/email/start` (Turnstile token) · `POST /auth/email/verify` | magic link / code fallback |
| `POST /auth/refresh` | mobile: rotate refresh token → new access token |
| `POST /auth/logout` | revoke current session |
| `GET /account` | profile, sign-in methods, sessions |
| `DELETE /account` | delete account and all associated data now (Apple 5.1.1(v), Google Play) |
| `GET /settings` · `PUT /settings` | synced preferences (JSON document with version) |
| `GET /places` · `POST /places` · `PATCH /places/:id` · `DELETE /places/:id` | synced saved places (Home/Work/favourites) with `updatedAt` for merge |
| `POST /devices` · `DELETE /devices/:id` | FUTURE: push registration (mobile) |

Auth: web — `HttpOnly; Secure; SameSite=Lax` session cookie; mobile —
`Authorization: Bearer <access token>` (15 min) + refresh token rotation.
Unauthenticated → 401 `{ error: "unauthenticated" }`.

### Not planned (by design)
`POST /routes` storing routes, `GET /routes/:id/weather`, location history,
`GET /notifications` before mobile push exists. Route weather is computed by
the shared client core (ADR-003); a server variant is added only if a native
client cannot run it.
