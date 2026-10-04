# ADR-015 — Free software and open data on our own (paid) hosting; no paid services, no sponsors; Google-Maps-class scale

**Status:** Accepted · **Date:** 2026-10-04 · **Decision by:** owner
**Update 2026-10-04:** placement of the engines in decision 4 is amended by [ADR-016](ADR-016-all-on-cloudflare-workers.md) — places on D1/R2 instead of PostGIS, a weather pipeline writing cells to R2 instead of a long-running Open-Meteo server, geocoder on D1 FTS5 first (Photon only if needed), real time on Workers + Durable Objects; Valhalla, MOTIS and LibreWXR in Cloudflare Containers.
**Supersedes in part:** [ADR-014](ADR-014-zero-cost.md) (rule "zero operating cost / free tiers only / Workers Free only")
**Amends:** [ADR-001](ADR-001-cloudflare-first.md), [ADR-004](ADR-004-routing-engine.md), [ADR-005](ADR-005-weather-provider.md),
[ADR-006](ADR-006-map-stack.md), [ADR-011](ADR-011-public-transport.md), [ADR-012](ADR-012-offline.md), [ADR-013](ADR-013-trip-planner.md)
**Catalogue:** [FREE_STACK_PLAN](../../FREE_STACK_PLAN.md) · **Plan:** [DEVELOPMENT_PLAN](../../DEVELOPMENT_PLAN.md) · **Hosting:** [ADR-016](ADR-016-all-on-cloudflare-workers.md) (Cloudflare Workers; engines placed per its limits)

## Context
On 2026-10-04 the owner set three rules that replace the "zero operating cost" reading of ADR-014:

1. **Scale target: Google-Maps-class** — the navigation is designed for a user base of the order of Google Maps
   (hundreds of millions of people), not for a free-tier ceiling of a few thousand daily users.
2. **No paid services and no sponsors.** No API keys on paid plans, no per-request or per-user fees to any third
   party, no sponsorship programmes, grants or credits (Cloudflare Project Alexandria, Fastly Fast Forward, AWS Open
   Data sponsorship and similar are **not** to be relied on).
3. **Hosting is the one thing the owner pays for.** Servers, bandwidth and storage the app runs on are paid by the
   owner; load is understood to cost money.

Facts verified 2026-10-03/04 (sources in FREE_STACK_PLAN §12):
- Every public free service the app uses today is free only below a limit or forbids production use: OSRM demo and
  FOSSGIS (≤1 req/s, non-commercial, "not production"), Nominatim (≤1 req/s **for the whole app**, no autocomplete),
  Photon (throttled), Overpass ("not suitable as an app backend"), Open-Meteo (<10,000 calls/day, non-commercial),
  Transitous (non-commercial, open source, contact first), MET Norway (≤20 req/s per application), Workers Free
  (100,000 requests/day), FOSSGIS Valhalla (1 req/user/s, 100 req/s total).
- The **software** behind all of them is free and open source, and the **data** is open: Valhalla (MIT),
  OSRM (BSD-2), GraphHopper (Apache-2.0), Photon (Apache-2.0), Nominatim (GPL-2.0), Open-Meteo (AGPL-3.0, data
  CC BY 4.0), MOTIS (MIT — the engine of Transitous), Planetiler (Apache-2.0), MapLibre (BSD-3); OpenStreetMap
  (ODbL), Overture Places (CDLA-Permissive-2.0), Foursquare OS Places (Apache-2.0), ECMWF/DWD/NOAA model data,
  Copernicus DEM, GTFS feeds.
- OpenFreeMap states "no limits on the number of map views or requests" and allows commercial use — it is the
  only public service usable as-is at any scale (still without an SLA).

## Options
1. Keep ADR-014 (free tiers only) — capped at ~4–6k DAU for Worker features and bound by third-party fair-use
   limits; contradicts rule 1.
2. Zero-hosting architecture (everything on the device, peer-to-peer, Nostr relays, sponsor-hosted files) —
   explored on 2026-10-04; at Google scale the bulk transfer still needs someone to pay (sponsors), public relays
   and TURN quotas do not scale, moderation is impossible; contradicts rule 2.
3. **Self-host the same free/open-source engines on owner-paid hosting, fed by free open data; keep only those
   public services whose terms explicitly allow unlimited use.**
4. Commercial APIs (Google, Mapbox, HERE, TomTom) — paid per request; contradicts rule 2.

## Decision
Option 3:

1. **Allowed costs = hosting only** (compute, storage, bandwidth, CDN in front of our own servers, domain). Nothing
   else is paid. No sponsorships, grants or credits are part of the plan.
2. **Every third-party component is free software or free open data.** Licences are recorded in
   [LICENSING_MATRIX](../../legal/LICENSING_MATRIX.md) and FREE_STACK_PLAN §10 before use.
3. **Always free, at any scale, in development and in production** (owner clarification 2026-10-04: there is no money
   for development and no sponsors). Only three classes of dependency are allowed (FREE_STACK_PLAN §1.1):
   **A** our own instance of free software; **B** open data files our pipelines download on a fixed schedule (volume
   does not grow with users; no paid tier exists); **C** services with no usage limit and no paid tier (today:
   OpenFreeMap tiles as a fallback to our own tiles; browser capabilities such as Web Speech and Web Push).
   Forbidden everywhere, including development: free tiers with a request limit, keys with quotas, trial periods,
   public demo servers or any service that forbids production/app use (OSRM demo, FOSSGIS, Nominatim, Photon komoot,
   Overpass, Open-Meteo API, Transitous, MET Norway, RainViewer, Mapillary API, Tankerkönig). Development runs the
   same self-hosted stack locally (Docker, regional extracts) at $0; CI runs on GitHub Actions for a public
   repository (no minute limit). Hosting is paid only from the launch for users.
4. **Own engines** (all horizontally scalable, stateless behind load balancers, regional):
   routing **Valhalla** (car, truck, motorcycle, bicycle, pedestrian/wheelchair; avoid tolls/highways/ferries,
   matrix, optimised route, isochrones, map matching, live-traffic speeds); geocoding **Photon** (Pelias optional for
   house-number coverage); places **PostGIS** database built from OSM + Overture + Foursquare OS Places + Open Charge
   Map; weather/air quality/elevation **Open-Meteo self-hosted**; public transport **MOTIS** (GTFS, GTFS-RT, GBFS);
   map tiles **Planetiler → PMTiles** served by our servers/CDN; radar **LibreWXR** (AGPL-3.0); real time (live
   sharing, reports, push, traffic probes) **our own backend**.
5. **API compatibility (ADR-009):** client contracts stay; providers switch by configuration (`VITE_*` endpoints
   → our domains). The deterministic engines stay in shared TypeScript (ADR-003).
6. **Live traffic is built, not bought:** opt-in, anonymised segment speeds from our users → aggregation → speed
   updates in Valhalla; official open traffic feeds where a country publishes them.
7. **Non-commercial stays** (ADR-014 rule 2 is kept): no ads, subscriptions or paid features. This also keeps
   NC-licensed data (e.g. EOX Sentinel-2 cloudless 2018+) usable.
8. **AGPL obligations are accepted:** modified AGPL services (Open-Meteo, LibreWXR) are offered with their source;
   the simplest way is a public repository (owner decision D1 in the plan).
9. **Native store apps:** Apple's yearly fee is not hosting → iOS/CarPlay stay BLOCKED until the owner decides
   otherwise; Android via F-Droid/APK is free.

## Reason
It is the only option that satisfies all three owner rules at once: no money to any third party, no dependency on
sponsors, and capacity that grows by adding hosting — the same engines power OpenStreetMap's own services,
Transitous and many national navigation products, and every limit we hit today disappears when we run them ourselves.

## Consequences
- REQ-COST-005 (zero operating cost) and REQ-SCALE-003's deprecation are replaced (PROJECT_REQUIREMENTS §0, §19);
  new binding constraints REQ-COST-009…012 and REQ-SCALE-004.
- PRODUCTION_READINESS_PLAN is replaced by DEVELOPMENT_PLAN (2026-10-04): its stage 1 (driver-safety defects) stays
  first; its other tasks are mapped there; release gates are unified in DEVELOPMENT_PLAN §7.
- Hosting cost grows with users; the largest items are tile/bandwidth and routing compute. Offline region packs,
  CDN caching and cache-friendly APIs (weather by cell + model run, places by tile) are design requirements.
- New operational burden: data pipelines (weekly OSM, model runs), engine upgrades, monitoring, on-call runbooks.
- Features that have no free data stay "not available" (popular times, hotel prices/booking, toll prices, fuel prices
  where no open data, Immersive View/AR, sub-metre global imagery).

## Alternatives rejected
- **Option 1:** scale ceiling far below the target.
- **Option 2:** needs sponsors or volunteer infrastructure at scale; weak moderation and privacy guarantees.
- **Option 4:** per-request fees.
