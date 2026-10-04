# UX, driving safety, performance, SEO, analytics, i18n, monetisation, AI

Product plan and competitor feature study (Russian): [PLAN.md](../PLAN.md).
This document sets the rules; PLAN.md tracks iterations.

## 1. Competitor landscape (positioning, not a feature race)

| | Google Maps | Apple Maps | Waze | Weather apps | navWeather |
| --- | --- | --- | --- | --- | --- |
| Routing + live traffic | yes | yes | yes (crowd) | no | routing yes, traffic no (no free source) |
| Weather on the map | current conditions/layer | current conditions in a corner | some weather reports | full forecasts, not tied to a route | **forecast at each place at your ETA**, along every road option |
| "When should I leave?" | by traffic | by traffic | planned drives by traffic | no | **by weather on the way** (next 12 h) |
| Weather alerts while driving | limited | limited | user reports | push for your location | **time-to-event alerts with dedup, labelled forecast/estimate/reported** |
| Route choice by weather | no | no | no | no | **exposure minutes per road** (storm, snow, heavy rain, fog, wind) |

Claim carefully: the combination (navigation + time + route + forecast +
alerts) is uncommon in mainstream apps; uniqueness is **not** claimed —
specialised trucking/road-weather tools exist (e.g. paid road-risk APIs).

## 2. UX architecture (screens)
Home (map + search + weather chip) → Search (autocomplete, categories,
saved/recents) → Place card (weather now / at arrival / 7 days) → Route
preview (modes, roads with their forecasts, departure selector, "when to
leave") → Navigation (maneuver banner, ETA bar, one alert banner, Report,
voice) → Route weather (timeline, along-the-way groups, heads-up, elevation)
→ Arrival summary. Settings: units, language, appearance, voice, alerts,
cameras, reports, saved places, privacy. **History:** none by design (privacy).

Rules: calm, minimal, trustworthy; complexity in engines not screens; no
decorative AI styling; numbers with units and times in local zones; every
source shows freshness.

## 3. Driving safety
| While moving (speed > ~10 km/h) | Allowed | Not allowed |
| --- | --- | --- |
| Input | voice push-to-talk; Report (5 large buttons); recenter; mute | typing, search field, settings, long lists |
| Information | next maneuver, ETA, speed limit, **one** alert banner | timelines, comparisons, place details |
| Alerts | voice-first, max 4 non-critical/hour, critical immediately | stacked banners, animations that pull attention |
| Visual | large type (maneuver ≥28 px), high contrast day/night, targets ≥44 px | low-contrast text, auto-playing motion |

The PWA already enforces most of this (drive sheet, report dialog, voice
queue priorities). Native car surfaces enforce it by platform templates.

## 4. Responsive web
Phone: bottom sheet (compact/default/expanded), thumb-reach controls, safe
areas. Tablet/desktop: left side panel (400 px), map controls right. Verified
widths 320–1920 px, light/dark, en/ru (PLAN.md §7.4). Not a shrunken desktop.

## 5. Performance
Targets REQ-PERF-001 (LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 on a mid-range phone).
Current: main JS 583 KB (188 KB gz), MapLibre 1.03 MB (281 KB gz, lazy), worker
508 KB; CSS 52 KB + 86 KB. Actions:
1. Measure with Lighthouse/WebPageTest on a throttled phone profile (none yet).
2. Lazy-load Settings, Share, Live viewer, Arrival, Places panel, dev tools.
3. Preconnect to tile and weather hosts; keep fonts system-only (already).
4. Static assets are immutable-cached (`/assets/*` max-age 1 year) — done.
5. Tiles: vector, served by OpenFreeMap's CDN; avoid style reloads (done: theme swap only).
6. Keep `derive()` throttled (≤1/s real time) — done.

## 6. SEO
The product is a tool; SEO value is modest. Do:
- `robots.txt` allowing `/`, disallowing `/api/` and `/live/` (capability links);
  `X-Robots-Tag: noindex` on `/live/*` and `?p=` place links.
- One canonical home page with real text, Open Graph/Twitter cards, structured
  data `WebApplication`.
- Optionally a handful of **hand-written** guides (e.g. "Driving Tbilisi →
  Batumi in winter: passes, weather, timing"), prerendered — only if they help
  people.
Don't: auto-generate thousands of city/route/weather pages.

## 7. Analytics (privacy-conscious)
No analytics today. If added: cookieless and aggregate only — counts of route
searches, route calculations (by mode), navigation sessions started/finished,
weather-panel opens, alert shown/dismissed, provider errors by provider/kind,
7/28-day return via an anonymous local counter. **Never** coordinates,
searches, route endpoints or device ids. Candidates: Cloudflare Web Analytics
(cookieless; terms **REQUIRE VERIFICATION**) for page views; Workers Analytics
Engine via `POST /api/v1/telemetry` for product counters.

## 8. Internationalisation
- Shipped: English (built in), Russian (lazy). Georgian UI removed by owner
  decision — **conflict with the brief** (PROJECT_REQUIREMENTS Open question #1).
- Already handled: spoken vs written forms (ru numbers, units, street-type
  cases), Georgian-script transliteration for en/ru, metric/imperial,
  per-point IANA time zones, departure entered in the start's zone, plural
  rules via `Intl.PluralRules`, road-sign conventions (speed limits per OSM;
  driving side from the router).
- Future languages: same catalogue shape; RTL support would need a layout pass.
- Currencies: none needed until monetisation.

## 9. Monetisation (not in MVP)
Options: free core + premium (multi-day trip planning, longer "when to leave"
windows, saved route alerts, offline regions), B2B route-weather API, fleet
dashboards, white-label. **Advertising is not recommended** (driver
distraction, privacy, and it makes Open-Meteo/Transitous use commercial).

Infrastructure decisions that monetisation changes (so plan them now):
Open-Meteo paid key + Worker proxy (ADR-005); self-hosted routing/geocoding
(ADR-004); Transitous replacement or permission (ADR-011); accounts and
entitlements (ADR-008; `subscriptions` table only then); App Store/Play
billing rules for digital subscriptions.

## 10. AI features (deterministic core stays in charge)
Useful: natural-language trip requests ("tomorrow morning to Batumi avoiding
heavy rain" → structured request to the deterministic planner); explanations
("why this road?" from exposure numbers); "Should I leave now or in 30
minutes?" answered **from** `planDepartures` output; arrival summaries.
Rules: the model never invents numbers, never decides routes or alerts, cites
the deterministic outputs, and is optional (P3). The existing push-to-talk
assistant is rule-based and stays the safe default while driving.
