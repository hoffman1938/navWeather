# navWeather

**Know what's ahead before you get there.**

A map and navigation app whose difference is the weather: for every part of
your actual road route it works out **where** you will be, **when** you will
get there, and **what the forecast is for that place at that time** — then
tells you what you will run into, in time to matter.

```
Tbilisi → Batumi · 357 km · 4 h 53 min
LEAVE 08:00  Tbilisi     ☁ 18°
ETA   09:10  Gori        ☁ 19°
ETA   10:05  Khashuri    🌧 17°  65%      "Rain is likely in about 55 minutes, near Khashuri."
ETA   11:40  Samtredia   ☀ 21°
ETA   13:00  Batumi      ☁ 23°
```

It runs on free services with no API keys (OSRM, Open-Meteo, Nominatim/Photon,
Overpass, OpenFreeMap, Transitous) plus a tiny Cloudflare Worker for live location sharing
and driver reports.

## Quick start

```bash
npm install
npm run dev          # app on http://localhost:5173
npm run dev:api      # (optional, second terminal) live-sharing + reports relay on :8787
npm test             # unit + end-to-end scenarios, no network
npm run build        # type-check + production build
```

Use Node 22+ (required by the Cloudflare tooling; the tests need 20+).
Location only works on `https://` or `localhost` — opening the dev server from
a phone via `http://192.168…` will be refused by the browser.

## What it does

**Explore (like any map app)** — search a place or press-and-hold (click on
desktop) anywhere on the map. The card shows the weather now, the next 24
hours and 7 days, and — if your location is known — the drive time and the
**weather when you would arrive**, plus air quality. A chip shows the
weather and AQI at the map centre. Directions start from "Your location".
Save places as Home, Work or favourites; share a place as a link; after a
drive, save where you parked (this device only).

**Travel modes** — car, walking, bicycle, public transport, flight, as tabs like
Google Maps. Walking and cycling are routed by OpenStreetMap's community routing
servers, with the same weather at *your* pace (rain matters more on a bike) and
turn-by-turn; the driving extras (speed limits, cameras, curves, driving breaks,
fuel advice) stay for the car. **Flight is a labelled estimate** — the straight
line and a typical time, no airports, schedules or prices — and is a plan only.
**Public transport** comes from [Transitous](https://transitous.org) — a free,
community-run journey planner over the timetables operators publish openly (no
key). Each trip found is an option with its departure and arrival, the lines to
take on their own colours, every step (walk, board, stops, get off) and the
weather at the times you'd be there; another departure time asks the timetable
again. Coverage is what operators publish: Tbilisi's buses and metro are there,
Georgian intercity trains and marshrutkas are not — then the app says "no public
transport found" (and links to Google Maps timetables, opened only if you tap it)
instead of inventing anything. It is a plan only, like a flight.

**Long Trip Mode** — trips of 800 km+, 10 h+ of driving, or that need a night
switch it on by themselves (thresholds in one config file; you can turn it off or
on for any trip). The planner (a stateless Cloudflare Worker endpoint) lays out
breaks, meals, fuel/charging (only from the range you enter), overnight areas in
real towns, days, a timeline and the weather at the times you'll really be there
— stops included — and suggests stopping earlier when heavy weather falls late
in the day. Hotels, fuel, food and rest areas come from OpenStreetMap with the
reason each was picked (availability, prices and ratings are not claimed), plus
border crossings. While driving, it replans when you fall well behind.
Details: [docs/features/LONG_TRIP_MODE.md](docs/features/LONG_TRIP_MODE.md).

**Plan** — up to three genuinely different **roads** to the destination (near-copies
of the best route are dropped; when the router offers none, the app asks it for
routes *through* points off the main road and keeps the believable ones), each with its own forecast: the road numbers it
follows ("via S1 · S12"), a weather ribbon along its whole length, a few stops with
the time you would be there and the expected weather and temperature, and the
exposure in minutes ("Heavy rain 35 min" vs "Mostly dry"; never auto-selected).
Then the weather timeline at each ETA of the road you pick, heads-up
events, "Where will I be at…", places along the route with real detour times,
multi-stop trips, departure time in the start location's time zone, and
**when to leave**: the next 12 hours of departures compared by rain and severe
weather on the way ("Leaving at 06:30: about 54 min less heavy weather").

**Drive** — turn-by-turn (lanes when OSM has them), speed-adaptive voice
prompts, heading-up camera that re-centres itself, and **following the road you
choose**: if you leave the planned road onto another road the app already knows,
it carries on along that road at once (no waiting, works offline, its forecast is
already loaded); if you turn onto a road it doesn't know, it makes new directions
from there and looks up the other roads from that point with their forecasts.
"Other roads" in the pulled-up sheet lists the roads you can still take from
here — time difference, forecast, "Take this road" — and fades as you pass the fork.
Also:
speed limits (OSM, "signs take precedence"), the "Ahead" list and time-based
weather alerts that stay quiet unless it matters, low-sun glare warnings,
time-zone changes, break reminders, sharp curves and railway crossings (with
the forecast road surface), and speed-camera alerts (OSM, **on by default** — use them only where that is legal;
one switch in Settings). Push-to-talk voice questions ("When will the
rain start?", "Find a gas station", "Recalculate route", "Report an
accident"). Arrival shows a trip summary (not stored).

**Driver reports** — while driving, report an accident, a hazard, road works,
a closure or dangerous weather in one tap (or by voice). Other drivers see it
on their route as *reported* (never as fact), and are asked "still there?"
just after passing it; reports expire on their own. Nothing is sent from a
simulated drive; it can be turned off in Settings.

**Share live location** — create a link (1–24 h). The other person sees you
move on the map, where you're heading, your ETA, the weather where you are and
at your destination on arrival. Only your latest position is kept on the
server, and it is deleted when you stop or the link expires.

**Simulate** — a demo drive (1×–300×) exercises everything above without
leaving your desk; in development a diagnostics panel adds jumps, deviation,
simulated weather and incidents (always labelled as simulated).

**Voice** — Google voices only («Google русский», "Google US English", …;
Chrome has them, free). Settings → Voice lists the Google voices for your
language. Russian text is spelled out for the ear («60 километров в час»,
«на улицу Руставели»). Google voices need a connection: offline, or in a
browser without Google voices (Safari, Firefox), the browser's own voice says
the sentence so guidance is never silent.

**Your location** — the start of a trip is your device position; if the device
can't give one (location off or blocked, no GPS on a desktop), the trip starts
from your approximate area (city level, from your connection via the app's own
Worker — no third party) and the app says so; type an exact start any time.

English and Russian; metric/imperial; appearance **like the device** (a dark phone gets
a dark map in the car too), light, dark, or "day and night" (the sun at the car while
driving); a street-level camera while driving; installable PWA.

## What it costs: nothing

Every part runs on free services or free tiers, with no API keys and no card:

| Part | Service | Free terms to keep in mind |
| --- | --- | --- |
| App + live sharing + driver reports | Cloudflare Workers **Free plan** (static assets, 2 SQLite Durable Objects, rate limits) | 100 000 Worker requests/day (static files don't count); plenty for personal use |
| Map tiles | OpenFreeMap | free, no key |
| Routing | OSRM public demo server | non-commercial, at most 1 request/s (the app queues requests), no uptime guarantee |
| Public transport | Transitous | open-source, **non-commercial** projects; link to its sources (shown with every trip); ask them before heavy use |
| Weather, air quality, elevation | Open-Meteo | free for **non-commercial** use (≈10 000 calls/day) |
| Search | Nominatim (1 request/s) and Photon | fair use |
| Places, speed limits, cameras | Overpass (OpenStreetMap) | fair use, often slow |
| Device voices, speech recognition | built into the browser | free |

**It stays that way:** the app is free for everyone and non-commercial — no ads,
no subscriptions, no paid features — and it runs on free tiers only, at $0 a
month ([ADR-014](docs/architecture/decisions/ADR-014-zero-cost.md)). Free
services have limits, so the app uses free fallbacks (another router, another
tile source, another weather service) and says so when a free limit is reached.
The path to production: [docs/PRODUCTION_READINESS_PLAN.md](docs/PRODUCTION_READINESS_PLAN.md).

**Update 2026-10-04 ([ADR-015](docs/architecture/decisions/ADR-015-free-software-own-hosting.md)):** the target is
Google-Maps-class scale. The owner pays for hosting only; every other part stays free — the same free, open-source
engines the public services above run on (Valhalla, Photon, Open-Meteo, MOTIS, OpenStreetMap tiles) move onto our own
servers, so no third-party limit or fee applies. Plan: [docs/FREE_STACK_PLAN.md](docs/FREE_STACK_PLAN.md).

## Honest limits

- **No live traffic, no official incident feed.** There is no free source;
  the interfaces exist (`TrafficProvider`, `IncidentProvider`) and the app says
  "not available" instead of inventing data. ETAs use typical road speeds.
  Incidents come only from other drivers' reports, labelled unconfirmed; there
  are no moderation tools yet.
- **Avoid tolls/highways** is not offered: the free OSRM server rejects it.
- **Web app limits:** no navigation or sharing with the screen locked or the
  app in the background (browsers pause location); no CarPlay/Android Auto.
- **Offline:** the loaded route, instructions and cached forecasts keep working
  and are labelled stale; new routes, new forecasts and map tiles need a
  connection.
- **Free services are shared** (Overpass is often slow; the OSRM demo server has
  no uptime guarantee). Swap endpoints in `.env` for production.
- **Translation:** Russian is a draft that needs native review.
- Chrome's speech recognition sends audio to the browser vendor; the mic is
  only opened when you press it.
- **Voice:** Google voices need a connection and come with Chrome; elsewhere
  or offline the browser's own voice speaks. An approximate start (location
  unavailable) is only as good as your connection's location — a VPN moves it.

## Privacy

No account. Stored on the device only: preferences, places you save, recent
destinations (can be turned off and cleared in Settings), and — while you share
— the share's own link/key so you can stop it after a reload. Positions and
routes are never stored. Live sharing sends your position only while you share.
A driver report sends only its kind and your position at that moment; the
relay keeps a daily-salted hash instead of your IP address. Google voices are Google's
online voices (the sentence is sent to Google to be spoken). The approximate
start is worked out by the app's own Worker from the connection and is not
stored.

## Deploy (Cloudflare, Free plan)

```bash
npm run build
npx wrangler login
npx wrangler deploy      # app + live-sharing and reports relay (Worker + Durable Objects)
```

`public/_headers` sets the CSP. The static app alone also runs on Cloudflare
Pages (`dist/`), just without live sharing and driver reports (shown as
unavailable).

## Docs

Start with **[Project requirements](docs/PROJECT_REQUIREMENTS.md)** (single
source of truth) and [AGENTS.md](AGENTS.md) (how to work on the project).

- **[Free stack and development plan](docs/FREE_STACK_PLAN.md)** (in Russian) — free self-hosted replacements for every service, the Google Maps features we lack and their free sources, and the plan to move the navigation onto them ([ADR-015](docs/architecture/decisions/ADR-015-free-software-own-hosting.md), 2026-10-04: only hosting is paid; no paid services, no sponsors)
- **[Production readiness plan](docs/PRODUCTION_READINESS_PLAN.md)** — the zero-cost path to production from 2026-10-03 (stage 1 still first; stage 2 replaced by the free stack plan)
- [Master audit 2026-10-03](docs/AUDIT/MASTER_AUDIT.md) — status of every requirement, confirmed defects, cost, roadmap ([gap analysis](docs/AUDIT/FEATURE_GAP_ANALYSIS.md), [implementation roadmap](docs/AUDIT/IMPLEMENTATION_ROADMAP.md))
- [Platform audit 2026-10-02](docs/AUDIT/2026-10-02-platform-audit.md) — findings, fixes, sources
- [Architecture decisions](docs/architecture/decisions/README.md) · [Target architecture](docs/architecture/TARGET_ARCHITECTURE.md) · [Roadmap & MVP](docs/ROADMAP.md)
- [API v1](docs/api/API_V1.md) · [Data model](docs/database/DATA_MODEL.md) · [Security](docs/security/SECURITY.md) · [Privacy](docs/legal/PRIVACY.md) · [Licensing matrix](docs/legal/LICENSING_MATRIX.md)
- [Weather engine](docs/architecture/WEATHER_ENGINE.md) · [Maps, routing, GIS](docs/architecture/MAPS_ROUTING_GEO.md) · [Mobile strategy](docs/mobile/MOBILE_STRATEGY.md) · [Cost & scale](docs/operations/COST_AND_SCALE.md) · [Delivery](docs/operations/DELIVERY.md)
- [Architecture](docs/ARCHITECTURE.md) — engines, data flow, providers, state, relay
- [Environment](docs/ENVIRONMENT.md) — every variable and binding
- [Testing](docs/TESTING.md) — what is covered, dev tools, what isn't tested
- [Product plan](docs/PLAN.md) — competitor study, what goes on the map, design audit, roadmap, iteration logs (in Russian)
- [Audit & backlog](docs/AUDIT.md) — findings, status, remaining gaps
