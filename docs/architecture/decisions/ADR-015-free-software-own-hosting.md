# ADR-015 — Always free: free software and open data on our own hosting; no paid services, no sponsors; Google-Maps-class scale

**Status:** Accepted · **Date:** 2026-10-04 · **Decision by:** owner
**Hosting:** [ADR-016](ADR-016-all-on-cloudflare-workers.md) (Cloudflare Workers; where each engine runs) ·
**Catalogue:** [FREE_STACK_PLAN](../../FREE_STACK_PLAN.md) · **Plan:** [DEVELOPMENT_PLAN](../../DEVELOPMENT_PLAN.md)

## Context
On 2026-10-04 the owner set the cost rules for the whole project:

1. **Scale target: Google-Maps-class** — designed for a user base of the order of Google Maps.
2. **No paid services and no sponsors.** No API keys on paid plans, no per-request or per-user fees to any third party,
   no sponsorship programmes, grants or credits.
3. **Hosting is the one thing the owner pays for** — servers, bandwidth and storage the app runs on.
4. **There is no money for development either:** every API and data source must stay free forever, at any scale, in
   development as well as production — nothing "free up to a limit" or "free until production".
5. **Free for users and non-commercial forever:** no ads, subscriptions or paid features.

Facts verified 2026-10-03/04 (sources in FREE_STACK_PLAN §12):
- Every public free service the current code uses is capped or forbids production use: OSRM demo and FOSSGIS (≤1 req/s,
  non-commercial), Nominatim (≤1 req/s for the whole app, no autocomplete), Photon (throttled), Overpass (not for app
  backends), Open-Meteo API (<10,000 calls/day, non-commercial), Transitous (non-commercial, contact first), MET Norway
  (≤20 req/s per application), FOSSGIS Valhalla (1 req/user/s, 100 req/s total).
- The **software** behind them is free and open source and the **data** is open: Valhalla (MIT), OSRM (BSD-2),
  GraphHopper (Apache-2.0), Photon (Apache-2.0), Open-Meteo (AGPL-3.0, data CC BY 4.0), MOTIS (MIT), Planetiler
  (Apache-2.0), MapLibre (BSD-3); OpenStreetMap (ODbL), Overture Places (CDLA-Permissive-2.0), Foursquare OS Places
  (Apache-2.0), ECMWF/DWD/NOAA model data, Copernicus DEM, GTFS feeds.
- OpenFreeMap states "no limits on the number of map views or requests" and allows commercial use.

## Options
1. Free tiers of public services only — capped at a few thousand daily users and bound by fair-use limits.
2. Zero-hosting architecture (everything on the device, peer-to-peer, volunteer relays, sponsor-hosted files) — at
   Google scale the bulk transfer still needs sponsors; public relays and TURN quotas do not scale.
3. **Self-host the same free engines on owner-paid hosting, fed by open data; keep only services whose terms allow
   unlimited use.**
4. Commercial APIs (Google, Mapbox, HERE, TomTom) — paid per request.

## Decision
Option 3:

1. **Allowed costs = hosting only** (compute, storage, bandwidth, CDN, domain) — on Cloudflare (ADR-016).
2. **Every third-party component is free software or open data**, its licence recorded in
   [LICENSING_MATRIX](../../legal/LICENSING_MATRIX.md) / FREE_STACK_PLAN §10 before use.
3. **Always free — only three classes of dependency** (FREE_STACK_PLAN §1.1): **A** our own instance of free software;
   **B** open data files downloaded by our pipelines on a fixed schedule (volume independent of users, no paid tier);
   **C** services with no usage limit and no paid tier (OpenFreeMap as tile fallback; browser capabilities such as Web
   Speech and Web Push). Forbidden everywhere, including development: free tiers with a request limit, keys with quotas,
   trials, public demo servers or any service that forbids production/app use. Development runs the same stack locally
   (Docker, regional extracts) at $0; CI runs on GitHub Actions for a public repository.
4. **Own engines and data** (placement per ADR-016): routing **Valhalla**; geocoder on **D1 FTS5** (Photon if needed);
   places from OSM + Overture + Foursquare OS Places + Open Charge Map in **D1/R2**; weather and air quality from open
   model files turned into cells in **R2** by our pipeline; elevation from Copernicus DEM; public transport **MOTIS**;
   map tiles **Planetiler → PMTiles**; radar **LibreWXR**; real time on **Workers + Durable Objects**.
5. **API compatibility (ADR-009):** client contracts stay; providers switch by configuration. Deterministic engines stay
   in shared TypeScript (ADR-003).
6. **Live traffic is built, not bought:** opt-in, anonymised segment speeds from our users → aggregation → speed
   updates in Valhalla; open official feeds where a country publishes them without keys or quotas.
7. **Non-commercial forever** — this also keeps NC-licensed data (e.g. EOX Sentinel-2 cloudless 2018+) usable.
8. **AGPL obligations accepted:** modified AGPL software (Open-Meteo, LibreWXR) is offered with its source; simplest with
   a public repository (owner decision D1).
9. **Native store apps:** Apple's yearly fee and Google Play's fee are not hosting → iOS, CarPlay and Android Auto stay
   BLOCKED; Android via F-Droid/APK is free.

## Reason
It satisfies all owner rules at once: no money to any third party, no dependency on sponsors, and capacity that grows
by adding hosting — the same engines power OpenStreetMap's services, Transitous and many navigation products, and every
limit the current code hits disappears when we run them ourselves.

## Consequences
- PROJECT_REQUIREMENTS §0 (REQ-COST-006, 009…012, REQ-DEV-001), §19 (REQ-SCALE-004/005).
- Hosting cost grows with users; the largest items are tiles/bandwidth and routing compute. Offline region packs,
  caching and cache-friendly APIs (weather by cell + model run, places by tile) are design requirements.
- New operational burden: data pipelines (weekly OSM, model runs), engine upgrades, monitoring, runbooks.
- Features without free data stay "not available": popular times, hotel prices/booking, toll prices, fuel prices where
  no open data exists, Immersive View/AR, sub-metre global imagery.

## Alternatives rejected
- **Option 1:** scale ceiling far below the target.
- **Option 2:** needs sponsors or volunteer infrastructure at scale; weak moderation and privacy guarantees.
- **Option 4:** per-request fees.
