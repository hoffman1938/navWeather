# Architecture

navWeather is a single-page React app plus a Cloudflare Worker (live location sharing, driver reports,
approximate location, the Long Trip planner). Everything else currently runs in the browser against free public
services; the target moves them onto our own engines on Cloudflare ([TARGET_ARCHITECTURE](architecture/TARGET_ARCHITECTURE.md),
[DEVELOPMENT_PLAN](DEVELOPMENT_PLAN.md)). This document describes the code as it is. The product idea — weather **where you will be, when you will be
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
  reports/       driver-reports protocol and rules (shared with the Worker)
  state/         zustand stores: app (route/nav), explore (map app), settings, saved places, layout
  components/    UI (map, sheets, search, place card, drive mode, arrival, share, live viewer…)
  dev/           development-only diagnostics + simulation controls (not in production builds)
  i18n/          en (built in), ru (loaded on demand)
worker/          Cloudflare Worker + Durable Objects: live-location relay, driver reports
public/          PWA manifest, icons, service worker, _headers (CSP)
```

## Data flow: planning

```
search / pin / link ─▶ Place ─▶ RoutingProvider (OSRM: full geometry, per-edge durations,
                                steps with lanes/exits, up to 3 alternatives)
     ─▶ (few roads? findViaRoutes: ask for routes THROUGH 4 probe points off the main road, keep the
          believable ones — ≤ 1.5× the time, no out-and-back spur — silent via points, legs merged)
     ─▶ selectDistinctRoutes: the router's best road first, then only roads that really
                              go another way (≥ 10 % and ≥ 1 km of their own, not absurdly slow)
     ─▶ buildTimedRoute: cumulative distance + time for every vertex
     ─▶ sampleRoute: settlements, passes (elevation), junctions, heading changes,
                     ≤45 min gaps; refined later where neighbouring forecasts differ
     ─▶ WeatherService: snap to 0.02° grid → dedupe → batch (many locations per request)
                        → TTL cache → stale fallback; model-run aware refresh
     ─▶ matchForecastToTime(forecast, ETA at the sample)    ← the core
     ─▶ derive(): points, groups, summary, timeline, option exposure,
                  and per road: forecast ribbon + stops (buildRoadForecast) + "via" roads
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
  ─▶ throttled derive (real drive: ≤1/s by the fixes' own clock; simulation: ≤1/s real time or every 30 s simulated)
  ─▶ DriverAlertEngine: time-to-event windows by severity, confidence gating,
     cooldown, grouping, recurrence suppression, hourly cap, escalation
  ─▶ voice queue + one visual banner
```

Weather is fetched once per route (and on new model runs / staleness); driving
only re-matches cached forecasts to new ETAs, so position updates cost no
network requests.

### Choosing another road while driving

The app keeps the roads it knows (`routeOptions`: the ones offered at the start,
or the ones found after the last re-route). Two pure helpers in
`algorithms/roadMatching.ts` answer questions without the network:

```
persistent off-route
  ├─ matchKnownRoad: car within 30–60 m of another known road AND heading agrees (≤ 60°)
  │     └─ switchDriveTo(i): new progress on that road, its forecast is already loaded;
  │        names/elevation are added afterwards (same `timed` object, so work tied to it stays valid)
  └─ otherwise recalculateFrom (as before): new directions first, quickly (one road)…
        └─ …then, in the background, planOtherRoads: other distinct roads from that point,
           with their forecasts — a failure there is harmless
```

`derived.otherRoads` lists known roads the car is within 60 m of that still differ
from the current road ahead (`coincidesAhead`, cached per 500 m of progress — it costs
tens of ms), each re-based to start at the car (`roadAhead`) so a road planned at
the trip's start compares fairly with the one being driven. A road drops out of the
list once the car passes its fork. `switchToRoad(i)` (the sheet's "Take this road",
and the simulation) uses the same `switchDriveTo`.

## Providers

Business logic only sees interfaces; `services/providers.ts` is the one place
that names implementations, chosen by `VITE_*` variables.

| Interface | Default | Notes |
| --- | --- | --- |
| `RoutingProvider` per travel mode | car: OSRM demo; walk/bike: OSM community OSRM instances (`routing.openstreetmap.de/routed-foot|bike`); flight: `FlightEstimateProvider`; transit: `TransitousProvider` (MOTIS `plan` at `api.transitous.org`) | `providersForMode(base, mode)` gives the mode's router (a flight has no places/elevation/road data; transit no POIs or speed limits); `travelMode` lives in the app store |
| `RoutingProvider` | OSRM demo server | declares capabilities; `avoid` is empty because the demo server rejects `exclude`; asks for `alternatives=3` (plain `true` returns at most one), retrying with `true` if an older server answers 400 |
| `WeatherProvider` (+ `WeatherService`) | Open-Meteo | batching, cache, stale fallback, model-run checks |
| `GeocodingProvider` / `AutocompleteProvider` | our geocoder: `ApiGeocodingProvider` (`/api/v1/geocode`, D1 FTS5) and `TileReverseGeocoder` (nearest settlement from our tiles) | Photon only when our index has nothing (a town abroad) — `VITE_GEOCODING_FALLBACK`; Nominatim selectable |
| `PlacesProvider`, `PoiProvider`, `SpeedLimitProvider` | our places tiles (`services/places/tiles.ts`, `TileProviders.ts`): static JSON per layer and z9/z11 tile, built from OSM by `pipelines/osm/` | inside the region the tiles cover no third-party request; outside it Overpass (one shared sequential queue) until that region is built (`VITE_PLACES_FALLBACK`) |
| `ElevationProvider` | Open-Meteo | pass detection |
| `TrafficProvider` | none | hook for live traffic (sets segment durations) |
| `IncidentProvider` | driver reports (`/api/reports`) | normalized incidents (`verified` flag) → route events; reports are never verified; `report()`/`vote()` when the source accepts them |
| `TextToSpeechProvider` | `BrowserSpeechSynthesis`: Google voices | see "Voice" below |
| `SpeechRecognitionProvider` | browser | push-to-talk only |
| `MapProvider` | OpenFreeMap | style URLs |

## State

| Store | Holds |
| --- | --- |
| `state/store.ts` (app) | route request, plan + alternatives, forecasts, navigation/simulation, progress, guidance, alerts, arrival summary |
| `state/explore.ts` | my location, locate/follow, place card (search, pin, link), directions entry |
| `share/liveShare.ts` / `share/viewer.ts` | live sharing (sender) / watching a shared link |
| `state/settings.ts` | preferences (localStorage) |
| `state/savedPlaces.ts` | Home/Work/favourites + recent destinations (localStorage, opt-out) |
| app store (reports part) | incidents on the route, relay status, "still there?" prompt; own/asked report ids in memory only |

`derive()` is a pure function of the app state and returns everything the UI
shows; components read narrow selectors.


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

## Driver reports

```
car (real GPS) ──POST /api/reports {kind, lat, lon}──▶ Worker ──▶ Reports DO (SQLite, one object)
route boxes    ──GET  /api/reports?bbox=…  (≤24 boxes, every 5 min driving)──┘   expired rows removed hourly
passing a report ──POST /api/reports/:id/vote {still|gone}──┘
```

- Kinds: accident, hazard, road works, closure, dangerous weather. Lifetime by
  kind (45 min … 12 h); "still there" extends (max 3× lifetime), two "gone"
  outnumbering confirmations remove it; the same kind reported within 150 m
  is a confirmation. Rules live in `src/reports/protocol.ts` (shared, tested).
- The relay keeps a daily-salted hash of the client IP (never the IP) to
  refuse double votes, voting on your own report and floods; three rate
  limits (create/vote, list, share creation).
- Client (`ReportsIncidentProvider`, store): reports become unverified route
  events ("Accident · reported"), a "still there?" card appears 30–400 m after
  passing someone else's report on a real drive; nothing is sent from a
  simulation, and a simulated drive doesn't ask for the list either (DP-1.10). The Report button and prompt disappear when turned off in Settings.

## Voice

```
VoiceQueue (priorities, interruptions, expiry)
  └─ BrowserSpeechSynthesis ── Google voices only; the one picked in Settings per language
       text spelled out for the ear first (speakable.ts, Russian): "60 км/ч" → "60 километров в час",
       "ул." by case ("на улицу", "по улице"), "-3°" → "минус 3 градуса", "С2" → "эс 2"
```

- Google voices ("Google русский", "Google US English") come with Chrome and
  need a connection. Offline, or in a browser without them (Safari, Firefox;
  Android lists its Google voices without the name), the browser's own voice
  for the language speaks, and a Google voice that fails is repeated on the
  device — guidance is never silent.
- The downloadable on-device voice (Piper) was removed; the service worker
  deletes its old cache (`navweather-voices-v1`, ~93 MB) on devices that had it.

## Location

- One reference-counted `watchPosition` (`services/location.ts`) for the map, navigation and sharing: reasons
  (`locate`, `navigate`, `share`) acquire and release it; navigation and sharing ask for GPS precision, "show my
  location" is happy with Wi-Fi, and a precise watch that times out falls back to coarse. Errors are classified
  (`insecure`, `denied`, `unavailable`, `timeout`, `unsupported`), each with its own message (incl. iOS instructions).
- A one-shot `locateOnce` for trips:
  a quick network fix, then GPS if that times out **or can't work out a position**.
- `tripStart` (a trip from "Your location"): the device position, else the
  connection's rough area from `GET /api/whereami` (the Worker reads
  Cloudflare's `request.cf`; nothing stored, no third party). The field then
  reads "Approximate location" and a notice names the city. A failure is
  remembered for a minute so Go doesn't wait for it again. `wrangler dev`'s
  offline placeholder (Austin, TX) is recognised and refused.
- Go with an empty field says which one is missing.

## PWA and offline

`public/sw.js` caches only the app shell and hashed assets; on update it
removes old app shells (and the retired voice download). It never caches
provider responses, tiles or `/api/*` (those URLs contain coordinates). When
the network drops, the loaded route, instructions and cached forecasts keep
working in memory and are labelled stale.

## Deployment

One Cloudflare Worker with static assets (`wrangler.toml`): `/api/*` runs the
Worker, everything else is served from `dist/` with `public/_headers` (CSP,
Permissions-Policy) and SPA fallback. Today it runs on Workers Free; hosting stays on Cloudflare Workers (not Pages)
and moves to Workers Paid when the engines arrive in Containers (ADR-016).

## Travel modes

`TravelMode = drive | walk | bike | transit | flight` (`types/travel.ts`). The store's
`travelMode` picks the router for planning, re-routing and places along the route
(`routeProviders()`); the weather pipeline is the same for every mode, only the
timing differs, so a walker gets the forecast for *their* arrival times. Car-only
extras are gated on `travelMode === 'drive'`: speed limits, cameras, curves and
crossings (`loadDriveExtras`), break reminders and fuel/charging advice (`derive`).
Only `NAVIGABLE_MODES` (drive, walk, bike) can be started or simulated. A flight is the
great-circle line with 25 min on the ground + 800 km/h, labelled as an estimate;
transit is timetabled: `RouteRequest.departAtMs` asks Transitous for itineraries from
the chosen departure, each becomes a `Route` with `route.transit` (legs with line,
colours, stops, times and geometry ranges; a wait at a stop is timed into the leg
after it, so times along the line end at the timetabled arrival). Every itinerary
is an option (no distinct-road filtering), `derive` starts each at its own
`transit.departMs`, a new departure time re-plans, and the "when to leave"
comparison is off (a later departure is another trip). The map draws transit legs
instead of the route line (walks dotted, rides in the line colour). No itinerary →
`no-route` → "no public transport found". `VITE_TRANSIT_URL=` (empty) switches it
off. The saved drive session remembers the mode so a reload resumes a walk as a walk.

## Long Trip Mode

Spec: [features/LONG_TRIP_MODE.md](features/LONG_TRIP_MODE.md); decision: ADR-013.

```
route ready ─▶ state/trip.ts: classifyTrip (instant, pure, offline)
forecasts loaded ─▶ POST /api/v1/trips/plan (route resampled + driving times, departure, vehicle,
                    preferences, settlements, hourly hazard codes) ─▶ worker/trips.ts ─▶ src/trip/planning
                    ◀─ TripPlan (stops, nights, days, timeline, weather risks, advice)
  ─▶ setTripStopsProvider → derive(): every ETA after a stop += its duration (forecasts at the real times)
  ─▶ routeIntelligence: planned stops as TRIP_STOP events (replace generic break/fuel reminders)
  ─▶ first night's hotels: POST /api/v1/trips/places (Overpass, edge-cached) · borders: on the device (Natural Earth, trip/countries.ts)
driving: ≥20 min off plan (10 min cooldown) ─▶ replan with progress (along, driven today, since break)
```

`src/trip/` has no DOM or Workers-only dependencies (shared by the Worker and
the client, ready for mobile). The trip store lives outside `store.ts`; the
app store only asks for the stops to add to ETAs.
