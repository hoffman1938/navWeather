# ADR-014 — Zero cost and free for users: free tiers only, non-commercial, core independent of our quota

**Status:** Accepted · **Superseded in part by [ADR-015](ADR-015-free-software-own-hosting.md) (2026-10-04):**
hosting may now be paid by the owner, the scale target is Google-Maps-class, and the "free tiers only / Workers
Free only / zero operating cost" rules are replaced by "free software and open data on our own hosting, no paid
services, no sponsors". Rule 2 (free for users, non-commercial) and rule 8 (native store apps blocked by fees) stay.
· **Date:** 2026-10-03 · **Decision by:** owner
**Amends:** ADR-001, ADR-004, ADR-005, ADR-006, ADR-010, ADR-013 (only where they assumed a paid step)

## Context
The owner decided (2026-10-03): *nothing in this application may be paid — everything must be completely free.*
This is read as two binding rules:

1. **Free for users.** No subscriptions, ads, paid tiers, in-app purchases or paid features. The app stays a
   free, non-commercial service.
2. **Zero operating cost.** No paid plan, API key plan, hosting, domain name, store account or third-party
   service that bills. Everything runs on free tiers or on free/open data.

Earlier documents planned paid steps: Workers Paid ($5/month) before a public beta (REQ-CF-007), a paid Open-Meteo
key with a shared edge cache (ADR-005, REQ-WX-005), a self-hosted router on paid compute (ADR-004), a custom domain
for WAF rules and the Cache API (ADR-001), store developer accounts for iOS/Android/CarPlay/Android Auto (ADR-010).

Facts verified on 2026-10-03 (official documentation, see [MASTER_AUDIT](../../AUDIT/MASTER_AUDIT.md) and
[PRODUCTION_READINESS_PLAN](../../PRODUCTION_READINESS_PLAN.md) §3):
- Workers Free: 100,000 requests/day, **10 ms CPU** per request, 50 subrequests, 5 cron triggers; **requests to
  static assets are free and unlimited** (requests matching `run_worker_first` count and get 429 when the quota
  is exhausted).
- Durable Objects on Free: SQLite backend only; 100,000 requests/day, 13,000 GB-s/day, 5M rows read, 100k rows
  written per day, 5 GB stored. KV Free: 100k reads, **1,000 writes**/day. R2 free tier: 10 GB-month, 1M Class A,
  10M Class B operations/month, free egress. Workers Logs Free: 200,000 events/day, 3 days; invocation logs can be
  disabled; head sampling available.
- **The Cache API has no effect on `*.workers.dev`** (it works on custom domains). The trip planner's edge cache of
  places and borders therefore does nothing on the free subdomain (defect B-22).
- Trip planner compute measured locally (warm V8): 600 km 2.5 ms, 1,200 km 8.8 ms, 1,600 km 10.5 ms, 3,800 km 78 ms
  — long trips exceed the Free 10 ms CPU limit (defect B-23).
- Open-Meteo free: non-commercial = "private or non-profit websites or apps that do not have subscriptions or
  advertising"; < 10,000 calls/day, 5,000/hour, 600/minute; whether the limit is per IP or per application is
  **not stated** (requires confirmation from Open-Meteo).
- Free fallbacks reachable: FOSSGIS `routed-car` (car routing, OSRM API), VersaTiles public vector tiles (no key),
  MET Norway Locationforecast (CC BY 4.0, free also commercially; **refuses browser requests without an identifying
  User-Agent** → must be called from the Worker).
- Store fees: Apple Developer Program (yearly fee) for iOS, TestFlight and CarPlay; Google Play Console (one-time
  fee) for Play distribution, required for Android Auto apps. These are paid.

## Options
1. Keep the paid steps as written (rejected by the owner).
2. **Free-tier-only architecture with honest capacity ceilings** and graceful degradation beyond them.
3. Free tiers plus "free with a card on file" services (e.g. Oracle Always Free) in the critical path.

## Decision
Option 2, with these rules:

1. **No billing anywhere.** Cloudflare Workers Free only; the `*.workers.dev` subdomain (no purchased domain);
   free public services and free/open data; GitHub Actions within free minutes. A service that requires a payment
   method may only be used **optionally** (never in the critical path, never required to run the app).
2. **Non-commercial forever.** No ads, subscriptions, paid features or sponsorship placements in the app. This also
   keeps the use of Open-Meteo free, OSRM demo, FOSSGIS and Transitous within their terms.
3. **The core never depends on our Worker quota.** Search, routing, weather at ETA, alerts, navigation and Long Trip
   planning run in the browser against free providers and free static data. The Worker serves only features that
   need shared state or a server identity: live sharing, driver reports, approximate location, the MET Norway
   fallback, client error reports, health. When the Worker quota or CPU limit is hit, only those features degrade.
4. **Static data over live queries.** OSM data the app needs for the launch region (settlements, hotels, fuel,
   charging, food, rest areas, speed cameras, level crossings, speed limits) is pre-built weekly by a free GitHub
   Actions job from free OSM extracts and shipped as **static assets** (free, unlimited). Country borders come from
   public-domain Natural Earth boundaries evaluated on the client. Public Overpass is used only outside the region,
   lightly, with caching in a Durable Object (not the Cache API).
5. **Long Trip planning runs on the client** (same pure `src/trip` module; no CPU limit, works offline). The
   `/api/v1/trips/*` endpoints stay for compatibility but are not on the web app's critical path.
6. **Fallback chains of free providers:** tiles OpenFreeMap → VersaTiles; car routing OSRM demo → FOSSGIS
   `routed-car` → optional own router; geocoding Photon ↔ Nominatim; weather Open-Meteo (client-direct, persistent
   device cache, ≤10 variables) → MET Norway via the Worker → stale cache with label.
7. **Capacity ceilings are documented and enforced by behaviour, not by money:** per-feature request budgets,
   back-off on 429, adaptive cadences, and in-app "temporarily unavailable" messages.
8. **Native store apps are out of scope while store fees exist:** iOS, CarPlay and Android Auto are BLOCKED by this
   decision; Android may only be distributed through free channels (APK / F-Droid, which requires open source). The
   installable PWA is the mobile product.

## Reason
It satisfies the owner's rule literally (no money changes hands), keeps every provider's terms (non-commercial, light
use, attribution), removes the two Free-plan traps found on 2026-10-03 (Cache API on `workers.dev`, 10 ms CPU), and
makes the product resilient: the part users rely on keeps working even when our free quota is exhausted.

## Consequences
- Superseded paid steps: REQ-CF-007 (Workers Paid), the paid-key part of REQ-WX-005 / ADR-005, paid compute in
  ADR-004 Growth, the custom domain in ADR-001 consequences, store distribution in ADR-010 → marked DEPRECATED or
  BLOCKED with this ADR as the reason (PROJECT_REQUIREMENTS).
- New work (see PRODUCTION_READINESS_PLAN): static OSM extract pipeline, client-side borders, client-side planner,
  provider fallback chains, persistent device forecast cache, DO-based cache for out-of-region Overpass answers,
  Worker budget guards and degradation ladder, MET Norway proxy.
- Capacity is finite. Estimated ceiling on Workers Free after the plan: ~4,000–6,000 DAU for Worker-backed features
  (reports, sharing); unlimited for static assets; core features limited only by the free providers' own fair-use
  rules. Open-Meteo's per-IP vs per-app interpretation is the largest external risk (confirm in writing).
- No WAF/zone rules (need a custom domain): protection relies on the Workers rate-limiting binding, strict
  validation and small, stateless endpoints.
- Optional and free: a free domain (e.g. eu.org) would enable the Cache API and zone rules; an own router on owner
  hardware via Cloudflare Tunnel (free) or Oracle Always Free (2 OCPU / 12 GB, card required, idle instances may be
  reclaimed — never critical path).

## Alternatives rejected
- **Option 1:** contradicts the owner's decision.
- **Option 3:** a card-on-file service in the critical path risks charges and reclamation (Oracle reclaims idle
  Always Free instances), so it is allowed only as an optional accelerator.
- **Pages instead of Workers:** no gain; static assets are already free and unlimited on Workers.
