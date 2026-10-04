# Maps, routing, navigation, voice and GIS

> **Update 2026-10-04 (ADR-015/016):** the providers in §1 are the current code. The target replaces them with our own
> engines on Cloudflare: Valhalla in Containers (car, walk, bike, truck, motorcycle), a D1 FTS5 geocoder (Photon if
> needed), a Places API on D1/R2, own PMTiles in R2 (OpenFreeMap as fallback), own weather cells in R2, MOTIS in
> Containers. MET Norway is not planned. See [FREE_STACK_PLAN §4, §6a](../FREE_STACK_PLAN.md).

## 1. Six separate systems

| System | What it is | Current provider | Interface | Licence / terms (see matrix) | Failure mode |
| --- | --- | --- | --- | --- | --- |
| **Map data** | the world's roads, places, POIs | OpenStreetMap | — | ODbL, attribution | stale edits (weekly builds) |
| **Map rendering** | drawing vector tiles in WebGL | MapLibre GL JS | `RouteMap.tsx` | BSD-3-Clause | WebGL unavailable → error card; app still usable |
| **Tiles / styles** | pre-cut vector tiles + style JSON | OpenFreeMap (OpenMapTiles schema) | `MapProvider` | free, commercial OK, no SLA | blank map |
| **Geocoding** | text ↔ place | Nominatim (typed search, 1 req/s), Photon (autocomplete, reverse) | `GeocodingProvider`, `AutocompleteProvider` | fair use, no autocomplete on Nominatim | search fails, coordinates still work |
| **Routing** | road graph search, ETA, steps | OSRM public (car), FOSSGIS OSRM (walk/bike), Transitous (transit), estimate (flight) | `RoutingProvider` per mode | non-commercial, ≤1 req/s | no new route; loaded route continues |
| **Traffic** | live speeds/incidents | none (driver reports for incidents) | `TrafficProvider`, `IncidentProvider` | — | "not available" |
| **Weather** | forecasts along the route | Open-Meteo | `WeatherProvider` | CC BY 4.0, non-commercial free | stale label, last forecast kept |

Keeping them separate means each can be replaced without touching the others
(e.g. Valhalla for routing, PMTiles for tiles, MET Norway for weather).

## 2. Routing engine
Decision and comparison: [ADR-004](decisions/ADR-004-routing-engine.md).
Correct topology once self-hosted:
```
Client ─▶ Worker /api/v1/route (rate limit, validate, short cache)
            ─▶ Valhalla (Containers or VM, regional graph)
            ◀─ route (OSRM-compatible JSON if verified)
Client: buildTimedRoute → sampling → weather engine (unchanged)
```

## 3. Navigation engine (implemented, web)
- **GPS tracking:** one reference-counted `watchPosition` (`services/location.ts`):
  precise during navigation, coarse for "show my location"; classified errors.
- **Map matching:** windowed projection onto the route with heading and
  continuity checks (handles dual carriageways and loops).
- **Progress & ETA:** distance along route → `timeAtDistance` → remaining
  time; ETA = now + remaining (typical speeds).
- **Deviation:** threshold from road speed and GPS accuracy (30–100 m), must
  persist N readings **and** a duration (8 s, 3 readings); accuracy worse than
  100 m is ignored for decisions.
- **Re-routing:** first try a known alternative road the car is on (no
  network); else re-plan from the car (≥20 s apart), then look for other roads
  in the background.
- **Next maneuver, lanes:** OSRM steps (lanes where OSM has `turn:lanes`),
  "continue on E60 for 187 km" for distant maneuvers.
- **Speed limits / cameras / crossings / curves:** OSM via Overpass (labelled
  "signs take precedence"); curves from route geometry.
- **Arrival detection:** distance + passing the destination's projection,
  false-arrival guards.
- **Simulation:** 1×–300×, always labelled.

**Web limitations (cannot be fixed on the web):** no navigation with the
screen locked or the tab in the background (browsers pause geolocation);
Wake Lock keeps the screen on; no CarPlay/Android Auto; voice may need a
network (Google voices). Native apps (ADR-010) remove these.

## 4. Voice layer
```
navigation / alert engine ──▶ instruction { id: 'TURN_RIGHT' | 'WEATHER_AHEAD' …, params }
   ──▶ i18n phrasing (en/ru; spoken forms: "60 km/h" → "60 километров в час")
   ──▶ VoiceQueue (priority 1 maneuver … 6 minor; expiry; interruption)
   ──▶ TextToSpeechProvider adapter
         web: Web Speech API (Google voices in Chrome; browser voice fallback)
         iOS: AVSpeechSynthesizer (future)    Android: TextToSpeech (future)
```
Web Speech recognition "use[s] a service provided by the user's platform (the
default)" (MDN) — audio may go to the browser vendor; the mic opens only on
push-to-talk and the Settings screen says so.

## 5. GIS conventions
- **Coordinates:** WGS84, `[lon, lat]` tuples internally (`LngLat`), as GeoJSON
  and MapLibre expect. APIs that use lat,lon order (Nominatim, MOTIS
  `fromPlace=lat,lon`, Open-Meteo params) are converted at the provider edge.
- **Precision:** 5–6 decimals for routing; ≤4 for weather requests (enough for
  0.02° cells; MET Norway requires ≤4); 5 for reports.
- **Projection:** Web Mercator only for rendering; all distances are
  great-circle (haversine) in metres; route progress for line gradients uses
  Mercator length to match MapLibre's `line-progress`.
- **Polylines:** OSRM returns GeoJSON; Transitous/MOTIS returns encoded
  polylines with an explicit precision (6/7) decoded with overflow-safe
  arithmetic (`decodePolyline`).
- **Simplification:** Douglas–Peucker for shares/overlays only; the timed
  route keeps full geometry.
- **Time zones:** per point from the forecast response (IANA name + offset);
  wall time ↔ UTC conversions in `utils/timezone.ts` (DST gaps/overlaps
  handled). Departure time is entered in the **start location's** zone.
- **Borders / international routes:** time-zone changes on the route are
  events ("Clocks go back 1 h at the border"); no assumption that a route stays
  in one country; road refs and Georgian script transliterated for en/ru.

## 6. Geocoding quality notes
- Same-named places: "Tavisupleba Square" resolves to Kobuleti before Tbilisi's
  Freedom Square (Photon ranking; Tbilisi's square is named "Freedom Square" in
  English OSM). Mitigation: show the town in suggestions (done), bias by
  location (done), and name the destination town in error messages (planned).
- Nominatim policy: no autocomplete, cache results, ≤1 req/s, identify the app
  (browser Referer satisfies this), heavy users run their own instance.
