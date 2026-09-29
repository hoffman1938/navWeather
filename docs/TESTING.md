# Testing

## Commands

```bash
npm test              # unit + store-level scenarios (deterministic fake providers, no network)
npm run typecheck     # app + worker
npm run test:live     # opt-in smoke test against the real public APIs (Tbilisi → Batumi)
npm run dev:api       # local relay, then in another terminal:
npm run test:share    # end-to-end checks of the live-sharing relay
npm run test:reports  # end-to-end checks of the driver-reports relay
```

## What is covered

| Area | Where | Highlights |
| --- | --- | --- |
| Route timing, ETA | `algorithms/routeTiming.test.ts` | annotations → steps → proportional fallback; "where will I be at…" |
| Sampling | `algorithms/routeSampling.test.ts` | ≤45 min guarantee, settlements, turns, density by length |
| Weather matching | `algorithms/weatherMatching.test.ts` | interval vs instant values, no extrapolation, time zones |
| Grouping / summary / timeline | `weatherGrouping`, `timeline`, `WeatherStrip` tests | localized text, highlights |
| Deviation, progress, arrival | `routeDeviation`, `routeProgress` tests | hysteresis, opposite carriageway, out-and-back routes |
| Weather alerts | `intelligence/weatherAlerts.test.ts` | latching, stable ids, confidence, severity caps |
| Driver alerts | `intelligence/driverAlerts.test.ts` | windows by severity, cooldown, grouping, recurrence, hourly cap, escalation |
| Route intelligence | `routeIntelligence.test.ts`, `incidents.test.ts` | fuel/EV advice, break reminders, incidents (verified vs reported, expiry) |
| Voice | `voice/queue.test.ts`, `voice/parser.test.ts` | priorities, interruption, expiry; en/ru commands |
| Navigation | `navigation/navigation.test.ts` | maneuvers, lanes, speed-adaptive prompts, localized instructions |
| Location | `services/location.test.ts` | error classification, shared watcher, GPS→Wi-Fi fallback, one-shot fix |
| Explore | `state/explore.test.ts` | place card weather + drive time, dropped pins, directions from "Your location", blocked location |
| Sharing | `share/*.test.ts`, `scripts/share-smoke.mjs` | validation, merge (route once, latest position only), cadence, relay auth/limits/ordering/stop |
| Saved places, parking | `state/savedPlaces.test.ts` | slots, dedupe, recents opt-out, one parking spot |
| Best time to leave | `algorithms/departurePlanner.test.ts` | exposure per departure, nearest clearly-better suggestion, forecast horizon |
| Sun, clocks, cameras | `routeIntelligence.test.ts`, `algorithms/cameras.test.ts` | sun azimuth, glare only into a low sun under clear sky, time-zone change wording, cameras snapped and announced once |
| Names and grammar | `i18n/script.test.ts` | Georgian OSM names → Latin/Cyrillic (streets, road numbers) |
| Store end-to-end | `state/store.test.ts`, `state/scenarios.test.ts` | Tbilisi → Batumi: plan, weather, refresh, simulate, alerts, deviation + recalculation, network loss, arrival summary, assistant |
| PWA | `test/serviceWorker.test.ts` | shell only; provider, tile and `/api` traffic never cached |
| Driver reports | `services/traffic/ReportsIncidentProvider.test.ts`, `state/reports.test.ts`, `reports/protocol.test.ts`, `scripts/reports-smoke.mjs` | route boxes (count/area caps, full coverage), clock skew, partial outages, failure wording; real drives only, offline, "still there?" once and never for your own or in a simulation, 5-minute refresh, off switch; relay rules |
| Drive extras | `state/driveExtras.test.ts` | cameras without limit warnings, loading when switched on mid-drive, never the old route's cameras after a re-route |
| Settings, saved places | `state/settings.test.ts`, `state/savedPlaces.test.ts` | stored values validated; toggling a favourite removes that place only |
| Messages | `i18n/messages.test.ts`, `voice/parser.test.ts` | Russian agreement, report kinds named in every language; voice "report …" commands vs. questions |
| Voice | `voice/voices.test.ts`, `voice/providers.test.ts`, `voice/speakable.test.ts`, `services/places/OverpassPlacesProvider.test.ts` | only Google voices listed and used (the chosen one per language), the browser's own voice when there is none or offline, a failed Google voice repeated on the device; Russian text spelled out (units, temperatures, street types by case, road numbers); town names in Cyrillic in the Russian UI |
| Location | `services/location.test.ts` | watcher: shared, precise→coarse on timeout, coarse→GPS once on "unavailable"; one-shot: GPS retry on timeout/unavailable; trip start falls back to the approximate area (denied, unavailable, insecure page), remembers a failure for a minute, device reason when nothing works, malformed answers ignored |

The critical path from the brief (plan → sample → ETA → weather → events →
alerts → simulate → deviate → recalculate → stale data gone) is
`state/scenarios.test.ts › critical path: deviation mid-drive`.

## Development tools

In `npm run dev`, a "dev" tab (or Ctrl/⌘+Shift+D) opens diagnostics: route,
weather requests and cache hits, upcoming events, alert state, voice log,
providers, location watcher, live-share status. During a simulated drive it
adds +10 km, +30 min, next event, deviate, "heavy rain ahead" and "accident
report". Injected data is flagged and the UI labels it as simulated. None of
this is in production builds.

## Screenshot and accessibility audit

Every state (explore, search, place card, directions, route, expanded route,
settings, driving, expanded driving, report dialog, "still there?", share
dialog, arrival) is captured at 320, 375, 390, 430, 768, 1024, 1280, 1440 and
1920 px wide, light and dark, English and Russian, with headless
Chrome driving the dev build (emulated GPS; provider responses replayed from
the test fixtures when the network is closed). Each capture is also checked
for page-level horizontal overflow, controls off screen, tiny touch targets
and unlabelled buttons. axe-core runs on 10 states in both themes. Findings
and fixes: `docs/PLAN.md` §3 and §7.

## Manual / browser checks performed

- Desktop (Chrome in the app's browser pane) and a 390×844 touch phone profile
  (headless Chrome with emulated GPS): locate, press-and-hold pin, place card,
  directions from "Your location", share place, live share between two tabs
  (simulated drive and real GPS), stop sharing, arrival summary.
- Production build served by Cloudflare's runtime (`wrangler dev`): headers,
  SPA fallback, service worker offline reload.

## "Your location" in the browser

Dev build with mocked providers and a controllable `navigator.geolocation`:
Directions → "Your location" → destination → Go, when location works (route
from the position), is unavailable or blocked (route from the approximate
area, notice names the city; English and Russian), and when the approximate
area is unavailable too (short message, and Go says the start is missing).

## Not tested (be explicit)

- Real iOS Safari and Android Chrome devices (only emulation).
- Microphone speech recognition end to end (browser speech APIs need a user
  device; the parser and assistant are unit-tested).
- A deployed Cloudflare account (the Worker was verified locally only).
- Driver reports with many real users (moderation, abuse patterns at scale).
- Long real drives with a phone in a car.
