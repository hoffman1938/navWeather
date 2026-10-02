# Environment

Everything is optional. With no `.env` the app uses free public services and
needs no API keys. Copy `.env.example` to `.env` to override values.

**All `VITE_*` values are compiled into the public JavaScript.** Never put a
secret in them. A provider that needs a secret key must be called through a
Worker route instead (see `worker/`).

## Providers

| Variable | Default | Values |
| --- | --- | --- |
| `VITE_ROUTING_PROVIDER` | `osrm` | `osrm` |
| `VITE_WEATHER_PROVIDER` | `open-meteo` | `open-meteo` |
| `VITE_GEOCODING_PROVIDER` | `nominatim` | `nominatim`, `photon` |
| `VITE_AUTOCOMPLETE_PROVIDER` | `photon` | `photon` |
| `VITE_PLACES_PROVIDER` | `overpass` | `overpass`, `none` |
| `VITE_POI_PROVIDER` | `overpass` | `overpass`, `none` |
| `VITE_SPEED_LIMIT_PROVIDER` | `overpass` | `overpass`, `none` |
| `VITE_ELEVATION_PROVIDER` | `open-meteo` | `open-meteo`, `none` |
| `VITE_MAP_PROVIDER` | `openfreemap` | `openfreemap` |
| `VITE_TRAFFIC_PROVIDER` | `none` | `none` (interface ready) |
| `VITE_INCIDENT_PROVIDER` | `reports` | `reports` (driver reports via this app's Worker), `none` |
| `VITE_AIR_QUALITY_PROVIDER` | `open-meteo` | `open-meteo`, `none` |
| `VITE_SPEECH_PROVIDER` | `browser` | `browser` |

## Endpoints

| Variable | Default |
| --- | --- |
| `VITE_OSRM_BASE_URL` | `https://router.project-osrm.org` |
| `VITE_OPEN_METEO_BASE_URL` | `https://api.open-meteo.com` |
| `VITE_OPEN_METEO_AIR_URL` | `https://air-quality-api.open-meteo.com` |
| `VITE_NOMINATIM_BASE_URL` | `https://nominatim.openstreetmap.org` |
| `VITE_PHOTON_BASE_URL` | `https://photon.komoot.io` |
| `VITE_REPORTS_URL` | `/api/reports` (same origin — no CSP change needed) |
| `VITE_WHEREAMI_URL` | `/api/whereami` (approximate area of the connection, when the device can't give a position; same origin) |
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

Local development: `npm run dev:api` starts the Worker on port 8787, and the
Vite dev server proxies `/api` to it (`vite.config.ts`). Without it, the app
works normally, "Share live location" explains that the server is missing,
and driver reports show as "unavailable" in the Data panel.
