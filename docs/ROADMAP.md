# Roadmap and MVP

Requirements: [PROJECT_REQUIREMENTS](PROJECT_REQUIREMENTS.md). Iteration log
(Russian): [PLAN.md](PLAN.md). Complexity: S (days) · M (1–3 weeks) · L (1–2
months) · XL (quarter+), for one experienced engineer.

## 1. MVP definition

The web app already exceeds the feature MVP. What is missing for a usable,
honest MVP is **compliance and operability**.

| | Items |
| --- | --- |
| **MUST HAVE** | route + ETA + adaptive route weather + alerts (done) · turn-by-turn on web (done) · offline shell + stale labels (done) · provider terms respected: OSRM ≤1 req/s (done), attribution incl. map-fix link (done) · `/api/v1` (done) · CI (done) · owner decisions on Open questions #1–#4 · Privacy Policy + Terms draft (LEGAL REVIEW) · uptime check |
| **SHOULD HAVE** | reports corridor request (REQ-CF-009) · Open-Meteo paid key + edge cache before >25 DAU (ADR-005) · Workers Logs without coordinates · real-device tests · speed-camera default per country · name the destination town in "no transit found" |
| **COULD HAVE** | Georgian UI back (if decided) · code-splitting · Playwright E2E · official warnings for Georgia (if a licensed source exists) |
| **NOT NOW** | accounts/D1 · native apps · CarPlay/Android Auto · offline regions · AI assistant · monetisation · public API |

## 2. Phases

| Phase | Features | Technical requirements | Dependencies | Risks | Complexity |
| --- | --- | --- | --- | --- | --- |
| **0 Architecture** (now) | requirements, ADRs, audit, CI, `/api/v1`, router rate limits | this document set | — | docs drift → AGENTS.md protocol | S (done 2026-10-02) |
| **1 Web MVP** | MUST items above | legal drafts, uptime check, owner decisions | owner, lawyer | provider terms (Open-Meteo per-app limit) | S–M |
| **2 Private beta** (≤ ~100 invited users) | SHOULD items; feedback channel | Workers Paid; edge weather cache + paid key; logs; real devices | Open-Meteo plan; devices | weather cost; public router limits | M |
| **3 Public beta** (one country) | self-hosted routing/geocoding/OSM extract; optional accounts (passkeys/email) to sync places/settings; WAF; reports sharding | Valhalla (Containers or VM), Photon, D1 (migration 0001), Turnstile, custom domain | ADR-004 spike; email sending | ops load; abuse of reports | L |
| **4 iOS** | native navigation with screen off, voice, offline cache of the planned trip, Live Activity | ADR-010 spike → stack; API Bearer auth; privacy manifest | Apple account; ADR-010 | background location review; 4.2 | XL |
| **5 Android** | same; foreground service navigation | FGS `location`; Data safety | Play account | background-location policy | L (if RN shared) / XL |
| **6 CarPlay** | navigation templates, cluster guidance, one weather banner | CarPlay navigation entitlement | Apple approval (not guaranteed) | entitlement refusal | L |
| **7 Android Auto** | NavigationTemplate, trip updates | Car App Library, NAVIGATION category | quality review | review iterations | L |
| **8 International** | more languages, official warnings per country, planet routing, tile hosting | external compute, Enterprise/self-hosted weather, CDN tiles | budget | cost, legal per country | XL |

## 3. Repository structure (when mobile starts — not before)

```
apps/
  web/            current Vite app (src/components, src/state, public/)
  mobile/         React Native app (if ADR-010 accepts) with ios/ and android/ native modules (CarPlay, Android Auto, FGS)
packages/
  core/           today's src/algorithms, src/intelligence, src/navigation, src/types (no DOM)
  api/            src/api/v1.ts, src/share/protocol.ts, src/reports/protocol.ts (+ generated OpenAPI)
  i18n/           messages + spoken forms
workers/
  api/            today's worker/ (Durable Objects, routes)
database/
  migrations/     D1 SQL
docs/             requirements, ADRs, architecture, api, legal, operations
```
Until then the current layout stays (moving files without a second consumer
is churn). The boundaries already exist: engines import nothing from React.

## 4. Missing features (vs the brief)
Official weather warnings; crosswind estimate; storm proximity (no free
lightning source verified); accounts and sync; push notifications; offline
regions; truck routing and avoid options (router-blocked); live traffic (no
free source); Georgian UI (owner decision); E2E browser tests; analytics;
error reporting; staging environment; SEO basics (robots, OG tags).

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Free providers throttle/ban the app as usage grows | high beyond beta | routes/forecasts fail | ADR-004/005 migrations with written triggers |
| Open-Meteo free tier exceeded at app level (~30 DAU) | high | terms breach | paid key + edge cache before beta (REQ-WX-005) |
| Transitous terms unmet (private repo) | certain today | must stop using it | open-source decision or drop/replace |
| OpenFreeMap outage (no SLA) | medium | blank map | PMTiles fallback |
| Single Reports DO hot spot | medium at scale | reports unavailable | corridor request, sharding |
| Wrong safety claims (road conditions) | low (wording rules) | user harm, liability | labelling rules (WEATHER_ENGINE §6), ToS |
| Speed-camera legality | medium | legal | default per country (Open question #4) |
| Web navigation limits mistaken for an app bug | high | churn | explicit copy; native roadmap |
| Documentation drift | medium | wrong decisions | AGENTS.md session protocol; status columns updated with code |

## 6. Technical-debt prevention
- Every change: requirement ID in the commit/PR description; status column
  updated in the same commit.
- New provider ⇒ interface + matrix row + ADR if architectural.
- New server data ⇒ DATA_MODEL update + retention + privacy row first.
- No file over ~800 lines without a plan to split (store.ts is the exception
  recorded as DEBT-001).
- Tests accompany engine changes; CI must be green to merge.

## 7. Implementation checklist (next steps, in order)
1. [ ] Owner decisions: Georgian UI, code licence/repo visibility, commercial
       timing, speed-camera default, beta country (PROJECT_REQUIREMENTS §37).
2. [ ] Contact Transitous; ask Open-Meteo whether free use is per app or per end user.
3. [ ] Publish the branch / set up `gh auth` so CI runs (GitHub Actions).
4. [ ] Reports corridor endpoint + client (REQ-CF-009).
5. [ ] Uptime check on `/api/v1/health`; Workers Logs config without URLs (verify option).
6. [ ] Privacy Policy + Terms drafts → lawyer.
7. [ ] Custom domain; Workers Paid when needed; WAF baseline.
8. [ ] `/api/v1/weather/points` with Cache API → KV → Open-Meteo (paid key), ≤10 variables.
9. [ ] Valhalla spike (Containers vs VM), `ValhallaProvider`, Photon self-host, OSM extract for limits/cameras/POIs.
10. [ ] Real-device test pass (iOS Safari, Android Chrome); Playwright E2E.
11. [ ] D1 + accounts (migration 0001) when sync is wanted.
12. [ ] ADR-010 spike before any mobile code.
