# Architecture

navWeather is a single-page React app plus a small Cloudflare Worker for live
location sharing. Everything else runs in the browser against free public
services. The product idea — weather **where you will be, when you will be
there** — lives in plain TypeScript modules that have no React or DOM
dependencies, so they are unit-tested directly and can move to a native shell
later.

```
src/
  algorithms/    pure route + weather maths (timing, sampling, matching, grouping,
                 deviation, progress, simulation, speed limits, incidents, place forecast)
  intelligence/  "what's ahead": route events, weather alert engine, driver alert engine
  navigation/    maneuvers, instructions, speed-adaptive voice prompts
  voice/         TTS/recognition providers, prioritised voice queue, command parser, assistant
  services/      provider interfaces + implementations, WeatherService, route planner, location
  share/         live-location protocol (shared with the Worker), sharer, viewer, links
  state/         zustand stores: app (route/nav), explore (map app), settings, saved places, layout
  components/    UI (map, sheets, search, place card, drive mode, arrival, share, live viewer…)
  dev/           development-only diagnostics + simulation controls (not in production builds)
  i18n/          en (built in), ka and ru (loaded on demand)
worker/          Cloudflare Worker + Durable Object: the live-location relay
public/          PWA manifest, icons, service worker, _headers (CSP)
```

## Data flow: planning

```
search / pin / link ─▶ Place ─▶ RoutingProvider (OSRM: full geometry, per-edge durations,
                                steps with lanes/exits, alternatives)
     ─▶ buildTimedRoute: cumulative distance + time for every vertex
     ─▶ sampleRoute: settlements, passes (elevation), junctions, heading changes,
                     ≤45 min gaps; refined later where neighbouring forecasts differ
     ─▶ WeatherService: snap to 0.02° grid → dedupe → batch (many locations per request)
                        → TTL cache → stale fallback; model-run aware refresh
     ─▶ matchForecastToTime(forecast, ETA at the sample)    ← the core
     ─▶ derive(): points, groups, summary, timeline, option exposure
     ─▶ buildRouteIntelligence(): RouteEvent[] (weather, stops, speed limits,
                                   fuel/charging, breaks, incidents)
```

`matchForecastToTime` interpolates instant values (temperature, wind) between
bracketing hours, takes interval values (precipitation, probability, gusts)
and the condition from the forecast hour that *contains* the arrival, and
never extrapolates beyond the forecast. Every point carries its own IANA time
zone; all timestamps are UTC internally.

## Data flow: driving (the real-time loop)

```
GPS fix (LocationWatcher) or simulation step
  ─▶ map matching (windowed projection, heading + continuity checks)
  ─▶ deviation (threshold from road speed + accuracy, N readings AND a duration)
       └─ off route → re-plan from the car → everything below is rebuilt
  ─▶ guidance + maneuver voice (priority 1; weather is held while a turn is seconds away)
  ─▶ speed limit / speeding (hysteresis)
  ─▶ throttled derive (≤1/s real time, every 30 s simulated)
  ─▶ DriverAlertEngine: time-to-event windows by severity, confidence gating,
     cooldown, grouping, recurrence suppression, hourly cap, escalation
  ─▶ voice queue + one visual banner
```

Weather is fetched once per route (and on new model runs / staleness); driving
only re-matches cached forecasts to new ETAs, so position updates cost no
network requests.

## Providers

Business logic only sees interfaces; `services/providers.ts` is the one place
that names implementations, chosen by `VITE_*` variables.

| Interface | Default | Notes |
| --- | --- | --- |
| `RoutingProvider` | OSRM demo server | declares capabilities; `avoid` is empty because the demo server rejects `exclude` |
| `WeatherProvider` (+ `WeatherService`) | Open-Meteo | batching, cache, stale fallback, model-run checks |
| `GeocodingProvider` / `AutocompleteProvider` | Nominatim (1 req/s) / Photon | Nominatim forbids autocomplete |
| `PlacesProvider`, `PoiProvider`, `SpeedLimitProvider` | Overpass | one shared sequential queue with endpoint fallback |
| `ElevationProvider` | Open-Meteo | pass detection |
| `TrafficProvider` | none | hook for live traffic (sets segment durations) |
| `IncidentProvider` | none | normalized incidents (`verified` flag) → route events |
| `TextToSpeechProvider` / `SpeechRecognitionProvider` | browser | push-to-talk only |
| `MapProvider` | OpenFreeMap | style URLs |

## State

| Store | Holds |
| --- | --- |
| `state/store.ts` (app) | route request, plan + alternatives, forecasts, navigation/simulation, progress, guidance, alerts, arrival summary |
| `state/explore.ts` | my location, locate/follow, place card (search, pin, link), directions entry |
| `share/liveShare.ts` / `share/viewer.ts` | live sharing (sender) / watching a shared link |
| `state/settings.ts` | preferences (localStorage) |
| `state/savedPlaces.ts` | Home/Work/favourites + recent destinations (localStorage, opt-out) |

`derive()` is a pure function of the app state and returns everything the UI
shows; components read narrow selectors.

## Location

`services/location.ts` owns one reference-counted `watchPosition`. Reasons
(`locate`, `navigate`, `share`) acquire and release it; navigation and sharing
ask for GPS precision, "show my location" is happy with Wi-Fi, and a precise
watch that times out falls back to coarse. Errors are classified
(`insecure`, `denied`, `unavailable`, `timeout`, `unsupported`) and each has
its own message, including iOS-specific instructions.

## Live location sharing

```
sender app ──PUT (Bearer key, ≥5 s apart)──▶ Worker ──▶ Durable Object (one per share)
                                                         │ latest position only
viewer app ◀──WebSocket snapshots (or 12 s polling)──────┘ alarm deletes at expiry
```

- `POST /api/share` creates a share: a random 128-bit id (the link) and a
  256-bit key (only its SHA-256 is stored). Creation is rate-limited per IP.
- The Durable Object keeps only the latest position (never a trail) and the
  route geometry once; stop or expiry deletes everything and tells viewers.
- Validation is shared (`src/share/protocol.ts`): coordinates, sizes, names
  (control/format characters stripped), clock skew, out-of-order updates.
- Viewers see the sender's position (animated between updates), destination,
  ETA, the weather where they are and at the destination on arrival.
- Browsers pause location in the background, so the app keeps the screen on
  while sharing (Wake Lock) and tells both sides when updates stop.

## PWA and offline

`public/sw.js` caches only the app shell and hashed assets. It never caches
provider responses, tiles or `/api/*` (those URLs contain coordinates). When
the network drops, the loaded route, instructions and cached forecasts keep
working in memory and are labelled stale.

## Deployment

One Cloudflare Worker with static assets (`wrangler.toml`): `/api/*` runs the
Worker, everything else is served from `dist/` with `public/_headers` (CSP,
Permissions-Policy) and SPA fallback. All of it fits the Workers Free plan.
The static app alone also works on Cloudflare Pages — without live sharing.
