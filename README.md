# navWeather

**Know the weather before you reach it.**

navWeather shows the weather you are likely to drive into. For every meaningful point on your actual road route it works out **where** you will be, **when** you will get there, and **what the forecast is for that place at that time**. It is not a weather map with a route drawn on it.

```
Tbilisi → Batumi · 357 km · 4h 53m
LEAVE 08:00  Tbilisi     ☁ 18°
ETA   09:10  Gori        ☁ 19°
ETA   10:05  Khashuri    🌧 17°  65%
ETA   11:40  Samtredia   ☀ 21°
ETA   13:00  Batumi      ☁ 23°
```

It runs entirely on free services with no API keys: OSRM, Nominatim/Photon, Overpass, Open-Meteo and OpenFreeMap.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit + end-to-end tests (fake providers, deterministic)
npm run test:live    # opt-in smoke test against the real APIs (Tbilisi → Batumi)
npm run build        # type-check + production build
```

Requires Node 18+. Node 22.12+ is recommended.

## How it works

```
input → geocode → OSRM route (full geometry + per-edge durations)
      → route timing (cumulative distance + time per vertex)
      → adaptive sampling (settlements, passes, junctions, ≤45 min gaps, density)
      → ETA per sample (departure + travel time | now + remaining time)
      → Open-Meteo hourly forecasts (deduped, batched, cached)
      → weather ↔ ETA matching → refinement where neighbours differ
      → grouping / events / summary → timeline cards = map markers
      → live GPS or simulated drive → progress → new ETAs → re-match (no refetch)
      → new model run upstream / stale data / manual ↻ → refetch → diff → only changed cards update
```

### Key algorithms (`src/algorithms`)

| File | What it does |
| --- | --- |
| `routeTiming.ts` | Maps the route to time. Priority: OSRM per-edge **annotations** → **step** durations → **proportional** fallback. A segment's `currentDurationS` (future live traffic) takes precedence automatically. Also provides `whereAtTime()`, which answers "where will I be at 10:30?" |
| `routeWeather.ts` | Builds `RouteWeatherPoint`s (each sample's forecast matched to its own ETA). `routeStateAtTime()` answers "where will I be at 10:30, and what weather then?" (shown in the app's *Where will I be at…* slider). |
| `routeSampling.ts` | Adaptive sampling with a distance budget (<50 km: 5–10 points … 500–1000 km: 25–50, adaptive above that). Anchors on settlements, mountain passes (elevation extrema), major junctions and significant heading changes, and guarantees at least one point every 45 min. A refinement pass adds midpoints where neighbouring forecasts differ (precipitation boundaries, temperature jumps). |
| `weatherMatching.ts` | **The core.** `matchForecastToTime()` interpolates instant values (temperature, wind…) between the two bracketing hours. Interval values (precipitation, probability) come from the forecast hour *containing* the arrival and are never interpolated. The condition/icon is never interpolated: it is the nearest hour, escalated to a precipitating state when rain falls in the arrival's hour. It never extrapolates beyond the forecast range. |
| `weatherGrouping.ts` | Groups stretches ("Gori → Khashuri: Rain likely"), detects events (rain start/end, snow, storms, gusts, fog, temperature drops, icy roads) and picks the few display points (ends, transitions, towns, spread over time). It also writes the hedged summary ("Rain likely near Zestaponi"). |
| `routeDeviation.ts` | Off-route detection. The threshold is 30–100 m depending on road speed and GPS accuracy. It needs N consecutive readings **and** a minimum duration, uses hysteresis, and ignores unusable fixes. |
| `routeProgress.ts` / `simulation.ts` | Windowed snapping of GPS to the route, remaining distance/ETA, and the demo drive with gentle speed variation. |

### Providers (`src/services`)

Every provider sits behind an interface. React components only ever see normalized types (`Route`, `LocationForecast`, `RouteWeatherPoint`, `WeatherCondition`).

| Interface | Default | Notes |
| --- | --- | --- |
| `RoutingProvider` | `OSRMProvider` | `overview=full`, `annotations=duration,distance`, steps aligned to geometry |
| `GeocodingProvider` | `NominatimProvider` | Rate-limited to 1 req/s; used only on submit and for reverse lookups |
| `AutocompleteProvider` | `PhotonProvider` | Nominatim's policy forbids autocomplete, so search-as-you-type uses Photon |
| `WeatherProvider` | `OpenMeteoProvider` | Many locations per request; timezone per location |
| `PlacesProvider` | `OverpassPlacesProvider` | Chunked bbox query, filtered client-side. Soft 3.5 s deadline, then late naming |
| `ElevationProvider` | `OpenMeteoElevationProvider` | ≤100 points per request |
| `TrafficProvider` | `NoTrafficProvider` | Hook for live traffic: set `currentDurationS` on segments |
| `MapProvider` | `StyleUrlMapProvider` | OpenFreeMap Positron (light) / Dark |

`WeatherService` wraps the weather provider with a spatial cache key (0.02° ≈ 2 km, fine enough for mountains and coasts), deduplication, batching, in-flight request sharing, a TTL cache, and stale fallback when the API fails. Each cache entry records `{ locationKey, forecastGeneratedAt, fetchedAt, forecast }`.

The service also asks Open-Meteo's model metadata (`/data/{model}/static/meta.json`) when the newest run became available, at most every 10 minutes. When a newer run exists than the one on screen, the app refetches straight away and reports "New forecast · N changes along your route". The TTL refresh is the fallback.

Provider classes are only named in `services/providers.ts`, and are chosen by environment variables.

## Configuration

Every setting is optional; defaults live in `src/config.ts`. Copy `.env.example` to `.env` to override:

```
VITE_ROUTING_PROVIDER=osrm
VITE_WEATHER_PROVIDER=open-meteo
VITE_GEOCODING_PROVIDER=nominatim
VITE_WEATHER_CACHE_TTL_MINUTES=20
VITE_WEATHER_REFRESH_MINUTES=20
VITE_WEATHER_UPDATE_CHECK_MINUTES=10
VITE_WEATHER_SPATIAL_RESOLUTION_DEG=0.02
VITE_SAMPLE_MAX_INTERVAL_MINUTES=45
VITE_OFF_ROUTE_MIN_THRESHOLD_M=30
VITE_OFF_ROUTE_MAX_THRESHOLD_M=100
…
```

## Using the app

- **Plan:** enter From/To, or tap *Try Tbilisi → Batumi*. *Leave now ▾* picks a departure. Times are entered in the **start location's timezone**, never assumed to be the device's.
- **Timeline ↔ map:** tapping a card flies the map to that point, and tapping a marker scrolls to its card. Scrolling the timeline highlights the centred point on the map. Tap *Details* (or drag the sheet up) for the full forecast.
- **Where will I be at…:** in the expanded sheet, drag the time slider to see your estimated position (marked on the map) and the forecast for that place at that time.
- **Start:** live GPS navigation. If you are far from the route, the app asks whether to route from your location or simulate instead. Off-route driving triggers recalculation once the deviation persists.
- **Simulate drive:** a demo vehicle drives the route (▶ / ⏸, speed 1× / 2× / 5× / 10×, plus 60× / 300× for quick demos, ×). The ETA, "Now" card, and future weather update live, and passed points disappear.
- **Day / night:** while driving or simulating, the UI and map switch between day and night by the sun at the vehicle's position and time. Planning follows your system theme.
- Weather refreshes automatically when a new forecast run is published, once data is older than the refresh interval (checked every minute, and when the tab becomes visible), after re-routing, and on **↻ Update**.

## Free-service etiquette

These are shared community services with **no production capacity guarantees**:

- **Nominatim:** max 1 req/s, no autocomplete. The app rate-limits and caches.
- **Photon, Overpass, OSRM demo server:** fair use only. Requests are debounced, deduplicated and cached, and Overpass has a fallback mirror.
- **Open-Meteo:** free for non-commercial use (CC BY 4.0 attribution shown in the app). One batched request covers a whole route.

For production, switch the endpoints to self-hosted or commercial providers through `.env`. No code changes are needed.

## Privacy

- No account, and no persistent storage of GPS, addresses, destinations or trips.
- The weather cache is in memory only.
- Location stays in the browser. It is only sent to the routing service when re-routing, and to Nominatim when you choose "Current location" as the start.

## Project layout

```
src/
  algorithms/   route timing, sampling, matching, grouping, deviation, progress, simulation, timeline
  services/     provider interfaces + implementations, WeatherService, routePlanner (pipeline)
  state/        zustand store (app state + actions), derive.ts (pure UI derivation), layout insets
  components/   Map, Search, BottomSheet, RouteSummary, WeatherTimeline, WeatherCard, WeatherMarker,
                WeatherDetails, NavigationControls, Notice, WeatherIcon, Icons
  hooks/        geolocation, simulation loop, timers, media queries
  utils/        distance/geometry, timezone, time formatting, cache, sun position
  types/        normalized domain types
```

## Extending

The architecture already has seams for:

- **Live traffic:** implement `TrafficProvider.applyTraffic()` to set `currentDurationS`.
- **Premium weather:** implement `WeatherProvider` and map its codes to `WeatherCondition`.
- **Commercial maps:** implement `MapProvider`.
- **Alternative routes, POIs (fuel/EV), road closures, and severe-weather alerts:** add them as new providers feeding the same `Route` → samples → points pipeline.
