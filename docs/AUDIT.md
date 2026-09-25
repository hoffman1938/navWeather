# Product audit & backlog — weather-aware navigation

Four role-based reviews were run against the existing weather-along-route prototype (read-only), then consolidated here. File references point at the code as it was before this iteration.

## Consolidated findings

### Product / UX (PM, UX/UI, Mobile)
- The app answers "what's the weather along my route?" but not **"what's ahead of me?"**: no next turn, no next hazard, and driving mode reuses the planning sheet (`RouteSheet.tsx`, `NavigationStatus.tsx`).
- Generic "generated" look: rounded tiles for every datum (weather cards, strips, details grid), 13 pill radii, badges, uppercase eyebrows, backdrop blur on opaque surfaces, a marketing hero inside the product.
- Planning repeats itself: route title twice, weather four ways, the arrival-time disclaimer three times.
- Mobile: landscape phones got the desktop layout, no left/right safe areas, attribution hidden under the search card, static `theme-color`.
- Accessibility:
  - Contrast failures: dark primary buttons 3.3:1, night "End" button 2.8:1, and `--text-3` on tinted surfaces.
  - Severity shown by colour only.
  - Focus lost when panels unmount.
  - The summary is a live region that re-announces every tick.
- Localization: no i18n layer, English prose built in logic (`weatherGrouping.ts`), and English-only plurals.

### Routing / weather algorithms (GIS, Weather data)
- **Progress tracking:** the nearest-segment snap can jump to the opposite carriageway, or snap to the end of out-and-back routes (false "arrived").
- **Weather event generation:** events repeat and flip-flop (heavy rain per sample, ice per sample, "colder" every 50 km, gusts toggling at 60 km/h). Event ids are unstable while driving because they are keyed off the moving "current" point.
- **Matching:**
  - The condition came from the nearest hour. Open-Meteo's code effectively describes the preceding hour, which can show a rain icon for a dry hour.
  - Gusts were averaged even though the value is the previous hour's maximum.
  - `rain` excludes showers.
- **Sampling:** distance fill could break the 45-minute guarantee, and ids collided on tiny routes.
- **Deviation:** fixes of 100–150 m accuracy could trigger off-route. Arrival ignored lateral offset.

### QA / Performance
- `derive()` cost about 5 ms, 95% of it timezone validation (a new `Intl.DateTimeFormat` per call).
- The traveled-route line re-uploaded up to 750 KB several times a second on long routes.
- Route geometry was re-sent to the map on unrelated plan updates.
- **Races:**
  - Weather stuck in "loading" after the plan changed mid-fetch.
  - New loads joined aborted in-flight requests.
  - Navigation resurrected after "End" by an in-flight re-route.
  - Reverse-geocoded names lost.
  - The model-update check shared a caller's abort signal.
- **Tests:** no coverage of alert dedupe/priority, snow/fog/heavy rain, forecast change during navigation, or offline. One timing-flaky test.

### Security / Privacy / Deployment
- No XSS or injection path, no secrets, 0 npm vulnerabilities, nothing persisted.
- Tighten:
  - Round coordinates sent for reverse geocoding and autocomplete bias.
  - Encode model names in URLs.
  - Validate geocoder coordinates.
  - Add an error boundary for a stale lazy chunk after a redeploy.
  - Explain location permission before prompting.
- Cloudflare Pages ready as a static site. It needs `_headers` with CSP / Permissions-Policy / Referrer-Policy. The CSP was verified against the running build.

## Backlog

| Pri | Item | Data availability (free prototype) |
| --- | --- | --- |
| **P0** | Fix progress tracking, deviation, arrival, matching semantics, sampling guarantees, store races, perf hot spots | — |
| **P0** | Central route intelligence: `RouteEvent` model, Weather Alert Engine (latched, stable ids), Driver Alert Engine (time-based windows, confidence, grouping, cooldown, dedupe) | Open-Meteo ✔ |
| **P1** | Turn-by-turn: maneuvers from the route model, localized instructions, lanes (real OSM data), speed-adaptive voice prompts, auto-zoom, heading-up camera, recenter | OSRM steps/lanes ✔ |
| **P1** | Voice: TTS queue with priorities / expiry / interruption, speech recognition (push-to-talk), command parser with context, natural answers | Browser speech APIs (where supported) |
| **P1** | Driver mode UI: maneuver banner, ETA bar, next-event line, "Ahead" list, alert banner, night theme; planning redesign (no card soup) | — |
| **P1** | Settings: language (en/ka/ru), units, alert output / types / timing, voice, speed warnings, battery saver, fuel range — stored locally | — |
| **P2** | Places along route with real detour time (Overpass + OSRM table), voice place search, add as stop | Overpass ✔ (flaky), OSRM table ✔ |
| **P2** | Alternative routes with weather comparison ("B is 20 min longer but avoids the heaviest rain"); never auto-selected | OSRM alternatives ✔ |
| **P2** | Speed limits from OSM with "signs take precedence", speeding warning with hysteresis | OSM maxspeed via Overpass (best effort) |
| **P2** | Avoid tolls/highways/ferries | ✘ The OSRM demo server rejects `exclude`, so the option is hidden until the provider declares the capability |
| **P2** | Live traffic, incidents, community reports | ✘ No free source. Only interfaces are provided; the UI stays silent rather than showing fake data |
| **P3** | Fuel stop suggestion from user-entered range; EV model (battery, connector) | User input only; nothing estimated |
| **P3** | Multi-stop trips (weather across stops) | OSRM waypoints ✔ |
| **P4** | PWA (manifest, offline shell), network-loss behaviour (keep route, label stale weather), Cloudflare Pages headers | — |
| **P4** | Offline map regions, native CarPlay / Android Auto shells | Not possible in a web app. Domain APIs are kept UI-free for a future native shell |
