# Long Trip Mode — feature specification (source of truth)

> **Update 2026-10-04 (ADR-015/016):** stop places and borders will no longer come from public Overpass through the
> Worker (B-22): places → our Places API on D1/R2 (DP-6.5), borders → Natural Earth on the client (DP-4.5). On Workers
> Paid the planner's CPU limit (B-23) no longer applies.

Status: **IMPLEMENTED (core)** · Requirements: REQ-TRIP-001…015 in
[PROJECT_REQUIREMENTS](../PROJECT_REQUIREMENTS.md) · Decision:
[ADR-013](../architecture/decisions/ADR-013-trip-planner.md) · Last updated 2026-10-02.

> The app should not only answer "where should I drive?" but, for long
> journeys, "how should I plan the whole journey?" — where I am, where I'm
> going, when I'll arrive, what I'll meet, when to stop, where to rest,
> refuel and sleep, what the weather will be, and how the plan changes.
> It is part of the core (NAVIGATION + ROUTE + ETA + WEATHER + PREDICTION +
> ALERTS), not a separate feature.

## 1. Purpose
A 1,200 km journey is not a long 20 km journey. Long Trip Mode recognises
long trips, plans breaks, meals, fuel/charging and overnight stays along the
real route, recommends a few relevant places for each stop, matches the
forecast to the times you will really be at each place (stops included), and
keeps the plan current while you drive.

## 2. User scenarios
| Scenario | What happens |
| --- | --- |
| Tbilisi → Rustavi (25 km) | SHORT: standard navigation, nothing extra |
| Tbilisi → Batumi (357 km, ~4 h 55 m) | MEDIUM: standard mode; "Plan stops for this trip" link if wanted |
| A 600 km day (7.5 h) | EXTENDED, 3+ breaks → Long Trip Mode on by itself: breaks, lunch, fuel (if range known), dashboard |
| Tbilisi → Istanbul (1,617 km, ~19 h 40 m) | LONG: on by itself — 2 nights at a balanced pace (1 at a fast pace), day-by-day timeline, overnight areas with hotels, weather risks at the real times, border Georgia → Turkey |
| Late, leaving at 15:00 for 1,200 km | the first night comes by the preferred latest arrival (22:00 balanced), not after 9 h of driving at midnight |
| Heavy snow on the road late on day 1 | advice "Consider stopping earlier — stay in X; drive that stretch in the morning, when the forecast is better" (never applied silently) |
| Two hours late while driving | the plan is recalculated from the car (driving today, since the last break) and the new arrival is announced |
| Re-route while driving | the plan follows the new road, keeping today's driving |
| "I'd rather sleep in Trabzon" | "Stay in Trabzon instead" re-plans with that night fixed |
| Offline / planner unavailable | classification still works; "the plan will be made when online" / retry; ETAs fall back to driving time only |

## 3. Classification (`src/trip/classification/classify.ts`)
Thresholds live **only** in `src/trip/config.ts` (`TRIP_THRESHOLDS`):

| Category | Distance | or driving time |
| --- | --- | --- |
| SHORT | < 150 km | — |
| MEDIUM | 150–400 km | — |
| EXTENDED | 400–800 km | ≥ 5 h raises to at least EXTENDED |
| LONG | ≥ 800 km | ≥ 10 h raises to LONG |

Long Trip Mode switches on (`longTripMode`, with `reasons`) when any of:
distance ≥ `LONG_TRIP_DISTANCE_KM` (800) · driving ≥ `LONG_TRIP_TIME_MINUTES`
(600) · the schedule needs an overnight · ≥ `LONG_TRIP_MIN_REST_STOPS` (3)
breaks/meals — **and** the trip is at least `AUTO_ON_FROM_CATEGORY` (EXTENDED).
A shorter trip with reasons (e.g. Tbilisi → Batumi leaving at 18:30, which
arrives after the balanced pace's 22:00) keeps standard navigation and its
ETAs; the reasons are kept and the mode is offered ("Plan stops for this
trip"). Whenever the mode is on, the stops are planned (B-24). The user can
override per trip (on/off); the override is non-blocking. Classification also reports estimated total time (stops
included), recommended breaks, time-zone changes and border crossings
(`requiresBorderCrossing`: null until the borders lookup answers).

```ts
type TripClassification = {
  category: 'SHORT' | 'MEDIUM' | 'EXTENDED' | 'LONG';
  distanceKm: number; drivingTimeMinutes: number; estimatedTotalTimeMinutes: number;
  requiresOvernight: boolean; requiresBorderCrossing: boolean | null;
  recommendedRestStops: number; timeZoneChanges: number;
  longTripMode: boolean; reasons: ('distance' | 'driving-time' | 'overnight' | 'rest-stops')[];
};
```
The same pure function runs on the client (instantly, offline) and in the
Worker (authoritative, inside the plan).

## 4. Planning algorithm (`src/trip/planning/schedule.ts`, `planner.ts`)
A deterministic walk along the route in **driving time**, with each stop's
local wall clock read in that stop's own time zone:

1. Candidates at each step: **break** every `restEveryS` of driving; **meal**
   in the next local meal window (lunch 12:00–14:30, dinner 18:30–21:00) not
   yet used, not in the first hour of a day; **fuel/charge** when 75 % of the
   range since the last fill is used (only with a range the user entered;
   not needed when the destination is within the range less 10 %);
   **overnight** when the day's driving (`dailyDriveS`) or the latest arrival
   hour (the first one at least 3 h after the driving day began) is reached —
   unless the destination is within 75 min.
2. The earliest candidate wins; others due within 25 min join it (one stop,
   not three). An overnight due soon after another stop anchors it.
3. Stop lengths: break by pace (10–20 min), meal 45 min, fuel 10 min, EV
   charge 35 min (an estimate), overnight until the preset morning start and
   at least `minOvernightS`.
4. **Overnight area** (`overnight.ts`): towns and cities within 1.5 h before
   to 20 min after the daily target, scored by size (accommodation and
   services likely) and by driving moved to the next day; a candidate that
   would add a whole extra night is penalised; the plain target is always an
   option. Nights are fixed one at a time (each moves the following days).
   User-chosen nights (`overnightsM`) are kept as they are. The other good
   towns are returned as `alternatives`.
5. Segments, days, timeline, summary, weather risks and advice are derived
   from the final schedule.

Pace presets (`PACE_PRESETS`) are **preferences, not medical or legal
rules**:

| Pace | Break every | Break | Daily driving | Latest arrival | Morning start | Shortest night |
| --- | --- | --- | --- | --- | --- | --- |
| relaxed | 1 h 45 m | 20 min | 7 h | 21:00 | 09:00 | 10 h |
| balanced | 2 h | 15 min | 9 h | 22:00 | 08:00 | 9 h |
| fast | 3 h | 10 min | 11 h | 23:00 | 07:00 | 8 h |

Jurisdiction-specific driving/rest rules (e.g. commercial drivers) are **not
built in**; Settings says so. Adding them needs verified rules per country.

## 5. Accommodation logic
- Overnight **areas** come from the plan (fast, no lookups). **Hotels** for an
  area are loaded from OpenStreetMap through `POST /api/v1/trips/places`
  (prefetched for the first night, on demand for the others), within the
  user's maximum distance from the route (5/10/20 km, straight line).
- Ranking: distance from the route, star class where OSM lists it (filtered
  by the 3★/4★ wish; unlisted kept but behind), parking tags, hotel/motel
  over guest house/hostel; unnamed buildings never recommended; top 5.
- Always labelled **"Recommended nearby — availability, prices and ratings
  are not checked"**. Never "available tonight": no verified source exists.
- No hotel mapped → "No hotels are mapped near this area" + the other towns
  ("Stay in X · arrive 21:40") which re-plan with that night.

## 6. Fuel logic
- Only from data the user declared: remaining range (Settings) and tank or
  battery size + consumption per 100 km (→ full-tank range). Nothing is
  estimated. Without a range: advice "Add your range (and tank size) in
  Settings to plan fuel stops".
- Stations within 2 km of the route; preferred brand (+), 24/7 at night (+),
  closed at arrival (removed); trucks prefer `hgv`/HGV diesel stations; EV:
  charging stations within 4 km, ≥ 50 kW preferred, power shown.
- **Not offered:** "cheapest" — there is no open fuel-price data for the
  launch region; the preference is not shown rather than faked.

## 7. Rest and meal logic
- Breaks at the pace interval; rest areas / motorway services within 3 km
  (toilets tag +); trucks: `hgv` parking. None mapped → "Nothing mapped here".
- Meals in local meal windows; restaurants/fast food/cafés per preference,
  **closed at the planned arrival are removed** (OSM `opening_hours`, safe
  subset parser — anything it can't read is "hours unknown", never "open").

## 8. Weather logic
- The client sends hourly **hazard codes** per route sample (from its own
  forecasts: rain, heavy rain, snow, storm, fog, strong wind, freezing with
  precipitation; same thresholds as the alert engine). The Worker never calls
  a weather API.
- Risks are evaluated at **stop-aware** planned times and grouped into
  stretches (`WeatherRisk`).
- **Stop earlier:** a high-severity risk driven in the last 3 h before an
  overnight → look for a town before it (≤ 2.5 h earlier) from which the same
  stretch, driven the next morning, has no high-severity hazard → advice with
  the hazard, its time window and the suggested town. A recommendation only.
- In the app, **every ETA after a planned stop includes its duration**
  (derive: `tripStops`), so the timeline, markers, alerts and "weather along
  your journey" show the weather for when you will really be there. Delays
  trigger a replan, which recomputes all of it.

## 9. Borders
`POST /api/v1/trips/borders`: ≤ 20 points along the route (≥ 25 km apart) →
the OSM country of each (one Overpass `is_in` query, edge-cached for a week)
→ crossings where the country changes (points at sea skipped). Shown in the
dashboard and as timeline entries ("Georgia → Turkey · around 380 km").
Approximate position; no border wait times (no source).

## 10. Notifications (anti-spam)
- Planned stops become route events (`TRIP_STOP`): overnight and fuel/charge
  are medium (one notice ~40 min ahead through the driver alert engine),
  breaks and meals low (shown in the "Ahead" list, never interrupt). They
  **replace** the generic 2-hour break and range-based fuel reminders.
- Weather alerts are unchanged (deduplicated, escalation-only repeats).
- Replanning while driving: at most every 10 min, only when ≥ 20 min off the
  plan; the user is told only when the arrival moves by ≥ 15 min.
  (`REPLAN` in config.)
- Before departure, the dashboard is the "long trip ahead" message — no
  separate pop-up.

## 11. UI states
| State | UI |
| --- | --- |
| Not long, not overridden | nothing (MEDIUM/EXTENDED: a quiet "Plan stops for this trip" link) |
| Auto-on | banner "Long Trip Mode is on for this trip · About 1,617 km and 19 h 40 min of driving · Keep standard mode" (non-blocking) |
| Planning | "Planning stops…" (classification already shown) |
| Ready | dashboard: arrival (with weekday), total time incl. stops, tiles (driving, overnight, fuel stops, breaks, meals, weather risks, border), border line, advice; pulled-up sheet: overnight stay (area, ETA, nights, hotels, other towns), day-by-day timeline (expandable), recommended stops (places on demand, with reasons), weather along the journey |
| Planner error | "unavailable / offline · Try again"; ETAs without stops |
| Stale (replan failed) | "This plan may be out of date · Try again" |
| Driving | ETA includes planned stops; planned stops in "Ahead"; replans when late |
| Multi-day | "When to leave" 12-hour comparison is hidden (it assumes one continuous drive) |

## 12. API contracts
Full shapes: `src/trip/types.ts`, validation: `src/trip/protocol.ts`,
`src/trip/borders.ts`. Endpoint table: [API_V1](../api/API_V1.md).
- `POST /api/v1/trips/plan` — `TripPlanRequest` → `TripPlan`. Request: route
  resampled every `stepM` (≥ 500 m, ≤ 1,500 points) with cumulative driving
  times, origin/destination, departure, vehicle, preferences, settlements
  (≤ 200), hazard samples (≤ 200 × ≤ 400 h), optional `progress` (replanning)
  and `overnightsM` (user-chosen nights). ≤ 400 KB.
- `POST /api/v1/trips/places` — one stop + the road ±30 km →
  `{ places: StopPlaces[] }`.
- `POST /api/v1/trips/borders` — ≤ 20 points →
  `{ countries, crossings }`.
All three: JSON only, same-origin writes, `TRIP_LIMITER` (20/min per IP),
nothing stored or logged.

## 13. Data model
`TripPlan` = classification, origin, destination, departAtMs, arriveAtMs,
totalDistanceKm, estimatedDrivingTimeMinutes, estimatedTotalTimeMinutes,
`segments` (between stops, per day), `days`, `recommendedStops`
(`TripStop`: kinds, position, place name, arrive/depart, dwell, time zone,
day, why, places), `accommodation` (per night: area, ETA, nights, hotels,
availability 'not-checked', alternatives), `weatherRisks`, `advice`,
`timeline`, `summary`, `dataStatus`, `progress`. The spec's `fuelStops` /
`mealStops` are `recommendedStops` filtered by kind.

**Storage:** none on the server. Vehicle profile and preferences are device
settings (`vehicleKind`, `vehicle`, `fuelRangeKm`, `tankSize`,
`consumptionPer100Km`, `tripPace`, `hotelMinStars`, `hotelMaxDetourKm`,
`tripFood`, `fuelBrand`). Plans live in memory only (saved trips: future,
device-only, opt-in).

## 14. Architecture
```
src/trip/                         shared domain module (no DOM, no Workers APIs)
  config.ts                       thresholds, pace presets, stop defaults, replan rules
  types.ts                        TripClassification, TripPlan, requests…
  classification/classify.ts      categories, Long Trip Mode decision
  route/profile.ts                resampled route ↔ driving time
  planning/schedule.ts            the stop schedule
  planning/overnight.ts           overnight areas
  planning/planner.ts             createTripPlan, findStopPlaces
  stops/places.ts                 Overpass query/parse (Worker side)
  stops/recommend.ts              ranking with reasons
  stops/openingHours.ts           safe opening-hours subset
  weather/hazards.ts, risks.ts    hazard codes, risks, stop-earlier advice
  replanning/progress.ts          delay, planned time at a position, progress state
  borders.ts                      countries along the route
  protocol.ts                     request validation
worker/trips.ts                   /api/v1/trips/{plan,places,borders}
src/services/trip/requests.ts     request building + calls (client)
src/state/trip.ts                 trip store, wiring (initTrip), replanning
src/state/derive.ts               stop durations added to every ETA
src/intelligence/routeIntelligence.ts  planned stops as route events
src/components/Trip/              banner + dashboard (main chunk), details (lazy chunk)
```
Cloudflare: Worker + rate limit + Cache API only. **Not used** (by
decision): D1 (no stored trips), Queues (replanning is client-triggered),
Durable Objects (no shared real-time state), KV.

## 15. Edge cases
- Route shorter than the merge window / no stops → plan with no stops.
- Departure late in the evening (e.g. 23:00) → a normal driving day: the
  latest arrival counts from when the driving day began (the first
  `latestArrivalHour` at least 3 h after it), so the first rest comes by the
  daily limit, not two hours after setting off.
- Time zones along the route → each stop's local time in its own zone.
- No forecasts → `dataStatus.weather: 'missing'`, no risks, no advice.
- Overpass slow/down → places "Couldn't load places right now · Try again";
  never invented; plan unaffected.
- Unknown opening hours → kept, labelled; at night penalised.
- Re-route while driving → new plan from the car with today's driving.
- Simulation → no delay replanning (the simulated car doesn't stop).
- Transit/walk/bike/flight → Long Trip Mode not offered (car only for now).

## 16. Testing
`src/trip/trip.test.ts` (engine: classification bands and time raise,
short/400/600/800/1,580 km, overnight and multi-day, latest arrival, fuel
and EV ranges, merging, opening hours, hazard codes, Overpass query/parse,
places ranking incl. closed/unknown/stars/detour, API failure and budget,
stop-earlier advice, replanning, validation, borders) and
`src/state/trip.test.tsx` (app: classification, override, stop-aware ETAs,
automatic activation, route events replacing reminders, plan screen,
departure change, planner failure, delay replanning, "Stay in X instead",
borders). Live checks 2026-10-02: plan 0.3 s; Kutaisi hotels/restaurants from
Overpass; Georgia/Turkey countries via `is_in`.

## 17. Future extensions
Truck routing restrictions (needs Valhalla, ADR-004) · verified
jurisdiction rest rules for commercial drivers · EV charging time from car
model and charger power, weather impact on range · fuel prices (if a
reliable open source appears) · real hotel availability (no free open source exists;
the project stays non-commercial, ADR-015) · saved trips (device-only, opt-in)
· multi-night stays · voice: "where do we sleep tonight?" · CarPlay/Android
Auto trip overview · fleet mode (same engine server-side).
