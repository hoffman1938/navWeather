# Weather engine, route-weather model and alert engine

The core of the product. Implemented as pure TypeScript (no DOM), shared by
all clients (ADR-003). This document describes what exists, what the labels
mean, and what is still missing.

## 1. Pipeline

```
Route (geometry + per-edge durations)                         services/routing/*
  ↓ buildTimedRoute: cumulative distance + time per vertex      algorithms/routeTiming.ts
  ↓ sampleRoute: adaptive samples (below)                       algorithms/routeSampling.ts
  ↓ ETA per sample = trip start + travel time                   (trip start: departure, or the
  ↓                                                               timetabled start for public transport)
  ↓ WeatherService: snap to 0.02° grid → dedupe → batch ≤50     services/weather/WeatherService.ts
  ↓   → TTL cache (20 min) → stale fallback → model-run checks
  ↓ matchForecastToTime(forecast, ETA)                           algorithms/weatherMatching.ts
  ↓ refineSamplesForWeather: add points where neighbours differ  (≤10 extra, one pass)
  ↓ derive(): points, groups, summary, timeline, per-road exposure state/derive.ts
  ↓ buildWeatherEvents → RouteEvent[]                            intelligence/weatherAlerts.ts
  ↓ DriverAlertEngine: when to speak/show                        intelligence/driverAlerts.ts
```

While driving, position updates **re-match cached forecasts to new ETAs** and
make no network requests. Forecasts refresh when ≥20 min old or when a newer
build of our forecast is published (`/api/v1/weather/meta`, checked every 10 min).

### 1a. Where the forecast comes from (DP-4.6, DP-6.6)

```
ECMWF IFS 0.25° (newest run; a short 06Z/18Z run continued by the previous long one, 15 days)
NOAA GFS 0.25° visibility                         ← Open-Meteo open-data archive on AWS (.om files, range reads)
  ↓ pipelines/weather/build.mjs (npm run data:weather): land + coasts, 5°×5° tiles, int16 per step   → R2
  ↓ worker/weather.ts: nearest 0.25° cell, steps → hours, derived values                → /api/v1/weather/forecast
  ↓ ApiWeatherProvider → the same normaliser as Open-Meteo                               → WeatherService
```

From model steps (3-hourly to 6 days, then 6-hourly) to hours (`src/api/weather.ts`):
- values at a step (temperature, humidity, clouds, wind components, CAPE, visibility) — linear in time; the
  precipitation type — the nearer step;
- sums and maxima over an interval (precipitation, snowfall, gusts) — a sum is spread evenly over its hours (6 mm in
  6 h → 1 mm each hour), a maximum holds for each hour of its interval; the hour before the run starts has none;
- derived: wind speed and direction from its components; rain = precipitation − snowfall water; snowfall cm =
  water mm × 0.7; apparent temperature (Steadman, without sunshine); gusts never below the wind;
- **weather code — a derived estimate**: thunderstorm when CAPE ≥ 3000 J/kg with precipitation, or ≥ 1500 with
  ≥ 2.5 mm/h; freezing rain/drizzle and ice pellets from the model's precipitation type; snow when snowfall is at
  least half the precipitation (light < 0.2 cm/h, heavy ≥ 0.8); rain by intensity (2.5 and 7.6 mm/h); fog when
  visibility < 1 km (freezing below 0 °C); otherwise clouds (15/50/85 %);
- temperature for the point's height: route samples send their height; the forecast moves the temperature by
  6.5 °C/km from the grid cell's height (and says which height it is for).

Not available from one deterministic run: **precipitation probability** (`null`; the alert engine then treats rain
as likely when it is forecast). Open sea far from any coast has no tiles: those points are "missing" and the app
asks its fallback.

## 2. Adaptive sampling (not a fixed spacing)

Density budget by trip length: 0–50 km → 5–10 points; 50–200 km → 10–20;
200–500 km → 15–30; 500–1000 km → 25–50; beyond, ~1 per 20 km (cap 150).
Points are placed by priority: origin/destination (1000) > weather change
(400, refinement pass) > elevation extrema / passes (250) > settlements (200)
> at least every 45 min of travel (150) > junctions onto long new roads (120)
> turns (110) > even fill (10). Example: Tbilisi → Batumi (357 km, 4 h 53 min)
→ 25 samples per road.

Why not "every 5 or 10 km": weather changes at passes, coasts and valleys, not
at fixed intervals; the budget keeps requests modest on long routes while the
refinement pass adds detail exactly where neighbouring forecasts disagree.

## 3. Forecast matching rules
- All times UTC internally; each point carries its own **IANA time zone** from
  the forecast response, so a route crossing time zones (Georgia ↔ Turkey) shows
  correct local times and DST is handled by the zone database
  (`utils/timezone.ts`). The user's device zone is never assumed for the route.
- **Instant** values (temperature, wind speed) are interpolated between the
  bracketing hours. **Interval** values (precipitation, probability, gusts,
  condition) come from the forecast hour that **contains** the arrival.
- Never extrapolate beyond the forecast horizon → `weather: null` (navigation
  continues; the point says "no forecast").
- Confidence (`high/medium/low`) from forecast lead time and probability; low
  confidence caps alert severity.

## 4. Route-weather data model (`RouteWeatherPoint`, `WeatherAtTime`)

| Field | Meaning | Kind |
| --- | --- | --- |
| `distanceFromStartKm`, `latitude`, `longitude` | position along the route | input |
| `arrivalMs`, `estimatedArrivalUtc`, `localTime`, `timezone` | ETA (UTC) and local wall time at that point | derived (typical speeds, no traffic) |
| `forecastLeadHours`, `confidence` | how far ahead the forecast is; trust level | derived |
| `weather.temperature`, `feelsLike` (°C) | interpolated | RAW FORECAST |
| `weather.precipitationProbability` (%) | hour containing ETA | RAW FORECAST |
| `weather.precipitation`, `rain` (mm/h), `snowfall` (cm/h) | hour containing ETA | RAW FORECAST |
| `weather.windSpeed`, `windGusts` (km/h), `windDirection` (°) | | RAW FORECAST |
| `weather.visibility` (m), `cloudCover` (%), `humidity` (%) | | RAW FORECAST |
| `weather.condition` | normalised WMO code → CLEAR / RAIN / HEAVY_RAIN / SNOW / FOG / THUNDERSTORM … | RAW FORECAST (classified) |
| group/severity, "slippery road possible", glare, temperature drop | rules over the above | DERIVED ESTIMATE |
| official warnings | — | **not available yet** (REQ-WX-006) |

Example (target presentation): `42.1 km · ETA 18:42 (Asia/Tbilisi) · 12 °C ·
78 % · rain 3.2 mm/h · wind 32 km/h · visibility 4 km · severity HIGH (derived)`.

## 5. Alert engine

**Weather events** (`buildWeatherEvents`): each hazard type (rain, heavy rain,
snow, storm, fog, strong gusts, temperature drop, ice risk, clearing) is
**latched with hysteresis** (gusts on ≥60 / off <50 km/h; colder on ≥6° /
off <4°); dry gaps of ≤1 sample are bridged, so a rainy stretch is **one**
event; identity = type + stable sample id, so refreshes keep ids; hazards
already in effect at the car are not re-announced (a "clearing" event comes
when they end); severity capped by confidence.

**Driver alert engine** (`DriverAlertEngine`), in time-to-event:

| Severity | First notice | Second notice |
| --- | --- | --- |
| low | never interrupts (list only) | — |
| medium | ≤ ~40 min ahead | — |
| high | ≤ ~55 min ahead | ≤ ~18 min, only if the first came ≥30 min before |
| critical | as soon as confident | ≤ ~15 min |

Anti-spam (the brief's "alert deduplication"):
- **Grouping:** events close together are spoken as one sentence; "Rain /
  Heavy rain / Precipitation" never become three notices — they are one
  latched stretch whose severity is its worst part.
- **Escalation:** a hazard type is not repeated within 45 min **unless it gets
  worse** (rank increases).
- **Cooldown + cap:** a cooldown between alerts; at most 4 non-critical voice
  alerts per hour; recurring hazards summarised ("on and off over the next 2 hours").
- **Dismissal:** acknowledged events stay quiet; per-event state survives
  forecast refreshes (same type within 20 km = same event).
- **Preferences:** output (voice + visual / visual / voice / off) and timing
  (auto / early / standard / minimal) in Settings; per-hazard toggles.
- Maneuver prompts always win (voice priority 1); weather waits while a turn
  is seconds away.

## 6. Labelling rule (safety)

The app must never claim a dangerous road condition the data doesn't support.

| Label | Source | Wording rule | Example |
| --- | --- | --- | --- |
| **Forecast** | provider model output at the ETA | "expected", "likely", with time/place | "Heavy rain expected in about 18 minutes near Khashuri." |
| **Estimate** (derived) | our rules over forecasts (ice risk, slippery, glare, crosswind) | "may", "possible", never certainty | "Road may be slippery: near freezing with rain." |
| **Reported** | other drivers | "reported", count of confirmations | "Accident reported ahead (2 drivers confirmed)." |
| **Official warning** | national service / MeteoAlarm | "Official warning", issuer named | not implemented (REQ-WX-006) |

`DataSources` shows per source: Forecast / Estimated / Scheduled / Stale /
Simulated / Community data / Not available.

## 7. Weather intelligence (deterministic)

Implemented derived signals: severity per condition; precipitation intensity
(mm/h bands); visibility < 1 km = fog exposure; gusts ≥ 70 km/h exposure;
temperature drop along the route; freezing + precipitation = ice-risk estimate;
low-sun glare from sun position vs heading; per-road exposure minutes (storm,
snow, heavy rain, fog, wind) for route comparison; best departure in the next
12 h; elevation profile coloured by temperature at passing time.

Missing / planned: crosswind (needs `windDirection` vs route bearing — data
already requested); storm proximity (needs lightning/radar data — no free
source verified); official warnings (REQ-WX-006).

## 8. Known gaps
- Typical-speed ETAs (no traffic) widen with trip length; shown as "Estimated".
- Grid snapping at 0.02° (~2 km) can blur sharp coastal/mountain gradients;
  passes are sampled explicitly to compensate.
- One global model (ECMWF IFS, ~25 km) everywhere, not regional high-resolution models; mountains and coasts are
  smoother than reality. The height correction helps temperature only (not rain vs snow at a pass).
- No precipitation probability (needs an ensemble — DEVELOPMENT_PLAN stage 11).
- Visibility comes from another model (GFS) than everything else.
