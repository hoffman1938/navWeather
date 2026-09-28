# Product audit, status and gap analysis

Three rounds of role-based review (product, UX/UI, GIS, weather, navigation,
voice, mobile, QA, performance, security, Cloudflare) were run against the
code. Round 1–2 findings were fixed earlier (progress tracking on dual
carriageways, false arrivals, forecast-hour semantics, flip-flopping events,
store races, `derive()` cost, re-uploaded polylines, card-heavy UI, contrast,
i18n, CSP). This document records round 3 and the resulting state.

> Round 4 (competitor study, design audit, P1 features) is documented in
> [PLAN.md](PLAN.md) (Russian): side-panel desktop layout, 20 UX/UI fixes,
> transliteration and Georgian grammar, best time to leave, weather + AQI
> chip, compass, low-sun glare, time-zone changes, speed cameras (opt-in),
> parking spot.

## Round 3 — findings (and fixes)

**Reported by the user**
- "Current location isn't working": location was only requested from the From
  field, every failure said "Location unavailable", there was no my-location
  button, and in the Claude desktop browser pane location is blocked outright.
  → Shared `LocationWatcher`, locate button + blue dot + accuracy, classified
  errors with fix instructions (desktop, macOS, iOS), "Your location" start
  resolved when routing, watchdog for unanswered permission prompts.
- "Like Google Maps, with weather where I want to go; share a pin; share live
  location" → explore mode, place cards with weather now / at arrival / 7 days,
  press-and-hold pins, place links, live sharing (Worker relay).

**Security review of the new relay** — all fixed: a PUT racing a stop could
leave the last position stored forever (body now read before state, re-checked
after every await, orphan backstop); share creation rate-limited; bodies
streamed with a hard byte cap; parallel/out-of-order updates rejected; pings
answered without waking the object; service worker never caches `/api` or
non-HTML navigations; bidi/zero-width characters stripped from names; update
cadence fitted to the Free plan (≥5 s, viewers animate between updates).
Open: `connect-src 'self'` covers same-origin `wss:` in current browsers; very
old iOS Safari falls back to polling.

**Mobile/QA review of the new flows** — all fixed: cancelling "Creating link…"
could still start sharing; the share dialog stole focus on every update;
one GPS timeout downgraded precision for the session; a blocked location left a
dead share running; heartbeats stopped when a stationary phone stopped
reporting; "Your location" could route to 0,0 after swapping; route search
could hang on an ignored permission prompt; double-click zoom dropped pins;
the viewer leaked a socket under StrictMode and never replaced dead sockets;
the place card's clock froze; shares silently resumed after reload (now paused
until the user resumes); no backoff on failures; small touch targets.

**Own verification** — pins jumped away from the finger when the card opened
(map padding shift, now kept still); a lift-off click closed the card after a
long press; arrival voice line was cleared before it was spoken; a simulated
re-route kept the old route's progress; arrival time overshot on large
simulation steps; English provider descriptions leaked into ka/ru UIs.

## Feature status

| Area | Status | Notes |
| --- | --- | --- |
| Map, search, geocoding, autocomplete | Existing → improved | explore search, saved places, recents, coordinates, place links |
| Current location | **Fixed / new** | see above |
| Place card weather (now, arrival, 24 h, 7 days) | New | same matcher as the route |
| Routing (real geometry), alternatives, multi-stop | Existing | OSRM; lanes/exits kept |
| ETA per route point, time zones | Existing | per-point IANA zone; DST-safe (UTC internally) |
| Adaptive sampling | Existing | settlements, passes, junctions, turns, ≤45 min, refinement |
| Weather along route at arrival time | Existing | the core; interval vs instant semantics |
| Weather events + transitions | Existing | rain/heavy/snow/storm/fog/wind/temp drop/ice/clearing |
| Driver alert engine | Existing | time windows, confidence, cooldown, grouping, recurrence, cap |
| Route comparison | Improved | exposure by condition (storm, snow, heavy rain, fog, gusts) |
| Turn-by-turn, camera, recenter | Improved | auto re-centre 12 s after panning |
| Deviation + recalculation | Improved | simulated deviations restart the drive on the new route |
| Voice | Improved | + recalculate, hospital; incidents answer traffic questions when available |
| Places along route + detour time | Existing (+ hospital) | Overpass + OSRM table |
| Speed limits | Existing | OSM, best effort, labelled |
| Fuel / EV advice | Existing | from user-entered range only |
| Break reminders | New | every ~2 h of driving, low severity (never interrupts) |
| Incidents | New (architecture) | provider interface → events; unverified = "reported" |
| Traffic | Architecture only | no free source → "Not available" |
| Arrival summary | New | distance, time vs plan, weather encountered; not stored |
| Live location sharing | New | Worker + Durable Object; latest position only |
| Data freshness | New | Forecast / Estimated / Stale / Simulated / Not available per source |
| Wake lock | New | screen stays on while driving or sharing |
| PWA / offline shell | Existing → hardened | |
| Dev diagnostics + simulation controls | New | development builds only |
| Localization | Existing → lazy | ka/ru load on demand (−18 KB gz from main bundle) |
| Settings | Improved | break reminders, saved places, recents |

## Gap analysis

| Gap | Class | Why it matters | Free? | Priority |
| --- | --- | --- | --- | --- |
| Live traffic speeds / congestion | **Blocked by provider** | ETA accuracy | No free source | P2 (needs paid provider) |
| Official incidents / closures | **Blocked by provider** | safety | Some countries publish feeds; none for Georgia found | P2 |
| Community incident reports | Missing | coverage where no feed exists | Yes (Worker + D1) — needs moderation, abuse controls, legal review | P2 |
| Avoid tolls / highways / ferries | **Blocked by provider** | preference | Self-hosted OSRM/Valhalla with profiles | P2 |
| Weather map layers / radar | Missing | context | Radar tiles are not reliably free for this use | P3 |
| Browser notifications when backgrounded | Missing | alerts while in another app | Yes, but browsers throttle background pages; limited value | P3 |
| Background navigation / locked screen | **Blocked by platform** | real driving | Native app only | P3 |
| CarPlay / Android Auto | **Blocked by platform** | in-car use | Native app only | P3 |
| Offline map tiles | Missing | tunnels / roaming | PMTiles regions possible, large downloads | P3 |
| Persisting the active route across reloads | Missing | reload mid-drive | Yes (session storage); deliberately not done yet — privacy trade-off | P2 |
| Native review of ka/ru text | Missing | quality | Needs native speakers | P1 |
| Real-device testing (iOS Safari, Android Chrome) | Not done | the target platform | Needs devices | P1 |
| Sender over WebSocket instead of HTTP PUT | Future | Free-plan request budget | Yes | P3 |

## Principles kept

No fake live data (simulation is always labelled). No invented capabilities
(unsupported options are hidden). No secrets in the client. No location history.
Provider-agnostic domain code. Complexity in the engines, not the screen.
