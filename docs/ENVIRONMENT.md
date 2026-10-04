# Environment

> **Update 2026-10-04 (ADR-015/016):** the provider defaults below are the current code and **violate** the
> "always free" rule (public services with usage limits, [FREE_STACK_PLAN §1.1](FREE_STACK_PLAN.md)); they are removed
> in stage 6 (DP-6.1). Local development becomes one `npm run dev` (Vite + Cloudflare Vite plugin with local Durable
> Objects/D1/R2, Docker for the engines) with `.env.development` / `.env.preview` / `.env.production` (DP-2.1…DP-2.3).

Everything is optional. With no `.env` the app uses free public services and
needs no API keys. Copy `.env.example` to `.env` to override values.

**All `VITE_*` values are compiled into the public JavaScript.** Never put a
secret in them. A provider that needs a secret key must be called through a
Worker route instead (see `worker/`).

## Providers

| Variable | Default | Values |
| --- | --- | --- |
| `VITE_ROUTING_PROVIDER` | `valhalla` | `valhalla` (our engine via `/api/v1/route`), `osrm` (public servers) |
| `VITE_ROUTING_FALLBACK` | `osrm` | when our engine isn't running or a point is outside its region: `osrm` (public servers) or `none` |
| `VITE_WEATHER_PROVIDER` | `open-meteo` | `open-meteo` |
| `VITE_GEOCODING_PROVIDER` | `api` | `api` (our geocoder + settlement tiles), `nominatim`, `photon` |
| `VITE_AUTOCOMPLETE_PROVIDER` | `api` | `api`, `photon` |
| `VITE_GEOCODING_FALLBACK` | `photon` | when our index has nothing (a town abroad) or isn't loaded: `photon` or `none` |
| `VITE_PLACES_PROVIDER` | `tiles` | `tiles` (our places tiles, `npm run data:osm`), `overpass`, `none` |
| `VITE_POI_PROVIDER` | `tiles` | `tiles`, `overpass`, `none` |
| `VITE_SPEED_LIMIT_PROVIDER` | `tiles` | `tiles`, `overpass`, `none` |
| `VITE_PLACES_FALLBACK` | `overpass` | outside the region our tiles cover: `overpass` (until that region is built) or `none` |
| `VITE_ELEVATION_PROVIDER` | `open-meteo` | `open-meteo`, `none` |
| `VITE_MAP_PROVIDER` | `openfreemap` | `openfreemap` |
| `VITE_TRAFFIC_PROVIDER` | `none` | `none` (interface ready) |
| `VITE_INCIDENT_PROVIDER` | `reports` | `reports` (driver reports via this app's Worker), `none` |
| `VITE_AIR_QUALITY_PROVIDER` | `open-meteo` | `open-meteo`, `none` |
| `VITE_SPEECH_PROVIDER` | `browser` | `browser` |

## Endpoints

| Variable | Default |
| --- | --- |
| `VITE_ROUTE_URL` | `/api/v1/route` — our routing API (same origin) |
| `VITE_OSRM_BASE_URL` | `https://router.project-osrm.org` |
| `VITE_OSRM_MIN_INTERVAL_MS` | `1000` — least time between requests to one OSRM server (the public servers allow 1 request/s); `0` for a self-hosted router |
| `VITE_OSRM_FOOT_URL` / `VITE_OSRM_BIKE_URL` | `https://routing.openstreetmap.de/routed-foot` / `…/routed-bike` (walking and cycling; the demo server above only does cars) |
| `VITE_TRANSIT_URL` | `https://api.transitous.org` (public transport, MOTIS `plan` API; set empty to switch public transport off) |
| `VITE_OPEN_METEO_BASE_URL` | `https://api.open-meteo.com` |
| `VITE_OPEN_METEO_AIR_URL` | `https://air-quality-api.open-meteo.com` |
| `VITE_NOMINATIM_BASE_URL` | `https://nominatim.openstreetmap.org` |
| `VITE_PHOTON_BASE_URL` | `https://photon.komoot.io` |
| `VITE_REPORTS_URL` | `/api/v1/reports` (same origin — no CSP change needed; the unversioned `/api/reports` still works) |
| `VITE_WHEREAMI_URL` | `/api/v1/whereami` (approximate area of the connection, when the device can't give a position; same origin) |
| `VITE_GEOCODE_URL` | `/api/v1/geocode` — our geocoder (same origin) |
| `VITE_PLACES_TILES_URL` | `/data/places/v1` — our places tiles (static assets, same origin) |
| `VITE_OVERPASS_URLS` | `https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter` |
| `VITE_MAP_STYLE_LIGHT` / `VITE_MAP_STYLE_DARK` | OpenFreeMap Positron / Dark |

If you point any of these at another host, add that host to `connect-src` in
`public/_headers`, or the production CSP will block it.

## Behaviour

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_GEOCODING_LANGUAGE` | `en` | fallback language for place names |
| `VITE_NOMINATIM_MIN_INTERVAL_MS` | `1100` | Nominatim usage policy (≤1 req/s) |
| `VITE_AUTOCOMPLETE_DEBOUNCE_MS` | `300` | typing debounce |
| `VITE_WEATHER_CACHE_TTL_MINUTES` | `20` | forecast cache lifetime |
| `VITE_WEATHER_REFRESH_MINUTES` | `20` | refresh when data is older than this |
| `VITE_WEATHER_SPATIAL_RESOLUTION_DEG` | `0.02` | grid used to share forecasts (~2 km) |
| `VITE_WEATHER_BATCH_SIZE` | `50` | locations per forecast request |
| `VITE_WEATHER_MAX_CACHE_ENTRIES` | `500` | cache size |
| `VITE_WEATHER_TIMEOUT_MS` | `15000` | request timeout |
| `VITE_WEATHER_MIN_FORECAST_HOURS` | `48` | minimum horizon requested |
| `VITE_WEATHER_UPDATE_CHECK_MINUTES` | `10` | how often to check for a new model run |
| `VITE_OPEN_METEO_UPDATE_MODELS` | `ecmwf_ifs025,dwd_icon,ncep_gfs025` | models whose run times are checked |
| `VITE_ROUTE_OPTIONS_MAX` | `3` | roads offered to choose from, the best included (1–4); OSRM is asked for that many alternatives so the distinct-road filter has spares |
| `VITE_SAMPLE_MAX_INTERVAL_MINUTES` | `45` | max driving time between weather samples |
| `VITE_SAMPLE_MAX_REFINEMENT_POINTS` | `10` | extra samples where weather changes |
| `VITE_OFF_ROUTE_MIN_THRESHOLD_M` / `_MAX_` | `30` / `100` | off-route distance range |
| `VITE_OFF_ROUTE_PERSIST_SECONDS` / `_READINGS` | `8` / `3` | how long before re-routing |
| `VITE_MAX_USABLE_GPS_ACCURACY_M` | `100` | worse fixes are ignored for deviation |
| `VITE_MIN_RECALC_INTERVAL_S` | `20` | re-route rate limit |
| `VITE_FAR_FROM_ROUTE_M` | `3000` | "you're far from this route" prompt |
| `VITE_SIMULATION_DEFAULT_SPEED` | `60` | simulated drive speed |

## Live sharing server (Cloudflare Worker)

Configured in `wrangler.toml`; no secrets are required.

| Binding | Purpose |
| --- | --- |
| `ASSETS` | the built app (`dist/`) |
| `LIVE_SHARE` | Durable Object class `LiveShare` (SQLite-backed, Free plan) |
| `CREATE_LIMITER` | rate limit for creating shares (6 per minute per IP) |
| `REPORTS` | Durable Object class `Reports` (SQLite-backed, one object; migration `v2`) |
| `REPORT_LIMITER` | rate limit for sending reports and votes (10 per minute per IP) |
| `REPORT_LIST_LIMITER` | rate limit for reading reports (120 per minute per IP) |

Local development: `npm run dev` starts both the Vite dev server (:5173) and the
Worker (`wrangler dev`, :8787, local Durable Objects and rate limits — no Cloudflare
account) and the dev server proxies `/api` to it (`scripts/dev.mjs`, `vite.config.ts`).
`npm run dev:web` starts only the app: it then works normally, "Share live location"
explains that the server is missing, and driver reports show as "unavailable" in the
Data panel. `npm run preview:worker` serves the production build through the Worker
on :8787, as Cloudflare would (headers, SPA fallback, service worker).

## Worker variables and bindings (Long Trip Mode)

| Name | Kind | Default | Purpose |
| --- | --- | --- | --- |
| `TRIP_LIMITER` | rate-limit binding (`wrangler.toml`) | 20 requests / 60 s per IP | `/api/v1/trips/*` |
| `GEO` | D1 database `navweather-geo` | — | our geocoder index; locally `npm run seed:local` loads it (no account); on Cloudflare the first deploy creates it, then `wrangler d1 execute navweather-geo --remote --file data/build/ge/geocode.sql` |
| `GEOCODE_LIMITER` | rate-limit binding | 120 requests / 60 s per IP | `/api/v1/geocode` |
| `VALHALLA_URL` | var (`.dev.vars` locally, written by `npm run engines:up`) | unset → 503 | where our Valhalla answers; in the cloud the container (DP-5.2) |
| `ROUTE_LIMITER` | rate-limit binding | 60 requests / 60 s per IP | `/api/v1/route`, `/route/matrix` |
| `ASSETS` (read by the Worker) | static assets | — | our places tiles for Long Trip stops (`/data/places/v1`) |
| `OVERPASS_URLS` | `[vars]` | `https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter` | Overpass endpoints for trip stop places and borders (server-side) |
| `TRIP_USER_AGENT` | `[vars]` | `navWeather/0.1 (trip planner; Cloudflare Worker)` | identifies the app to Overpass — **add a contact before production** |

Trip thresholds and presets are code, not environment: `src/trip/config.ts`
(`TRIP_THRESHOLDS`, `PACE_PRESETS`, `STOP_DEFAULTS`, `REPLAN`).
