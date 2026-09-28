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
Overpass, OpenFreeMap) plus a tiny Cloudflare Worker for live location sharing.

## Quick start

```bash
npm install
npm run dev          # app on http://localhost:5173
npm run dev:api      # (optional, second terminal) live-sharing relay on :8787
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

**Plan** — route options with weather exposure per route ("Heavy rain 35 min"
vs "Mostly dry"; never auto-selected), the weather timeline at each ETA, heads-up
events, "Where will I be at…", places along the route with real detour times,
multi-stop trips, departure time in the start location's time zone, and
**when to leave**: the next 12 hours of departures compared by rain and severe
weather on the way ("Leaving at 06:30: about 54 min less heavy weather").

**Drive** — turn-by-turn (lanes when OSM has them), speed-adaptive voice
prompts, heading-up camera that re-centres itself, off-route recalculation,
speed limits (OSM, "signs take precedence"), the "Ahead" list and time-based
weather alerts that stay quiet unless it matters, low-sun glare warnings,
time-zone changes, break reminders, and optional speed-camera alerts (OSM,
off by default — not legal everywhere). Push-to-talk voice questions
("When will the rain start?", "Find a gas station", "Recalculate route").
Arrival shows a trip summary (not stored).

**Share live location** — create a link (1–24 h). The other person sees you
move on the map, where you're heading, your ETA, the weather where you are and
at your destination on arrival. Only your latest position is kept on the
server, and it is deleted when you stop or the link expires.

**Simulate** — a demo drive (1×–300×) exercises everything above without
leaving your desk; in development a diagnostics panel adds jumps, deviation,
simulated weather and incidents (always labelled as simulated).

English, Georgian and Russian; metric/imperial; light/dark/automatic (day/night
by the sun at the car while driving); installable PWA.

## Honest limits

- **No live traffic or incidents.** There is no free source; the interfaces
  exist (`TrafficProvider`, `IncidentProvider`) and the app says "not
  available" instead of inventing data. ETAs use typical road speeds.
- **Avoid tolls/highways** is not offered: the free OSRM server rejects it.
- **Web app limits:** no navigation or sharing with the screen locked or the
  app in the background (browsers pause location); no CarPlay/Android Auto.
- **Offline:** the loaded route, instructions and cached forecasts keep working
  and are labelled stale; new routes, new forecasts and map tiles need a
  connection.
- **Free services are shared** (Overpass is often slow; the OSRM demo server has
  no uptime guarantee). Swap endpoints in `.env` for production.
- **Translations:** Georgian and Russian are drafts that need native review.
- Chrome's speech recognition sends audio to the browser vendor; the mic is
  only opened when you press it.

## Privacy

No account. Stored on the device only: preferences, places you save, recent
destinations (can be turned off and cleared in Settings), and — while you share
— the share's own link/key so you can stop it after a reload. Positions and
routes are never stored. Live sharing sends your position only while you share.

## Deploy (Cloudflare, Free plan)

```bash
npm run build
npx wrangler login
npx wrangler deploy      # app + live-sharing relay (Worker + Durable Object)
```

`public/_headers` sets the CSP. The static app alone also runs on Cloudflare
Pages (`dist/`), just without live sharing.

## Docs

- [Architecture](docs/ARCHITECTURE.md) — engines, data flow, providers, state, relay
- [Environment](docs/ENVIRONMENT.md) — every variable and binding
- [Testing](docs/TESTING.md) — what is covered, dev tools, what isn't tested
- [Product plan](docs/PLAN.md) — competitor study, what goes on the map, design audit, roadmap (in Russian)
- [Audit & backlog](docs/AUDIT.md) — findings, status, remaining gaps
