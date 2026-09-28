# Testing

## Commands

```bash
npm test              # unit + store-level scenarios (deterministic fake providers, no network)
npm run typecheck     # app + worker
npm run test:live     # opt-in smoke test against the real public APIs (Tbilisi → Batumi)
npm run dev:api       # local relay, then in another terminal:
npm run test:share    # end-to-end checks of the live-sharing relay
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
| Voice | `voice/queue.test.ts`, `voice/parser.test.ts` | priorities, interruption, expiry; en/ru/ka commands |
| Navigation | `navigation/navigation.test.ts` | maneuvers, lanes, speed-adaptive prompts, localized instructions |
| Location | `services/location.test.ts` | error classification, shared watcher, GPS→Wi-Fi fallback, one-shot fix |
| Explore | `state/explore.test.ts` | place card weather + drive time, dropped pins, directions from "Your location", blocked location |
| Sharing | `share/*.test.ts`, `scripts/share-smoke.mjs` | validation, merge (route once, latest position only), cadence, relay auth/limits/ordering/stop |
| Saved places | `state/savedPlaces.test.ts` | slots, dedupe, recents opt-out |
| Store end-to-end | `state/store.test.ts`, `state/scenarios.test.ts` | Tbilisi → Batumi: plan, weather, refresh, simulate, alerts, deviation + recalculation, network loss, arrival summary, assistant |
| PWA | `test/serviceWorker.test.ts` | shell only; provider, tile and `/api` traffic never cached |

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

## Manual / browser checks performed

- Desktop (Chrome in the app's browser pane) and a 390×844 touch phone profile
  (headless Chrome with emulated GPS): locate, press-and-hold pin, place card,
  directions from "Your location", share place, live share between two tabs
  (simulated drive and real GPS), stop sharing, arrival summary.
- Production build served by Cloudflare's runtime (`wrangler dev`): headers,
  SPA fallback, service worker offline reload.

## Not tested (be explicit)

- Real iOS Safari and Android Chrome devices (only emulation).
- Microphone speech recognition end to end (browser speech APIs need a user
  device; the parser and assistant are unit-tested).
- A deployed Cloudflare account (the Worker was verified locally only).
- Long real drives with a phone in a car.
