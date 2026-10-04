# ADR-004 — Routing: public OSRM now, self-hosted Valhalla before public beta

**Status:** Accepted (migration planned) · **Date:** 2026-10-02 · Facts verified 2026-10-02

## Context
Car routing uses the public OSRM demo server (`router.project-osrm.org`);
walking and cycling use FOSSGIS's OSRM instances (`routing.openstreetmap.de`).
Their policies:

- OSRM demo: "reasonable, non-commercial use-cases", "Do not exceed 1 request
  per second", "no guarantees wrt. uptime, latency, or data updates"
  ([wiki](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server)).
- FOSSGIS: "One request per second max", "no scraping, no heavy usage", a valid
  User-Agent/Referer, display attribution **and a link to the map-improvement
  page**; data updated roughly every two days
  ([about](https://routing.openstreetmap.de/about.html)).

The audit found the app could send several requests per second (best route +
up to four via-point probes + detour table). Fixed on 2026-10-02: one queue per
server, ≥1 s apart (`VITE_OSRM_MIN_INTERVAL_MS`), plus the required credit and
"Report a map error" link. Overpass (places, POIs, speed limits, cameras) has
the same problem class: its guidance for a "regular application" is roughly
"100 queries fetching less 10 MB of data per day", and "Commercial use should
use self-hosted or paid Overpass servers"
([wiki](https://wiki.openstreetmap.org/wiki/Overpass_API)).

A routing engine cannot run inside a Worker (multi-GB graph, long-lived process).

## Options (engines)

| | OSRM | Valhalla | GraphHopper (OSS) |
| --- | --- | --- | --- |
| Licence | BSD-2-Clause | MIT | Apache-2.0 |
| Turn-by-turn, lanes | yes | yes | yes (45+ languages) |
| Alternatives | yes | yes | yes |
| Avoid tolls/highways/ferries at request time | only `exclude` classes compiled into the profile | yes (costing options) | yes (custom models) |
| Truck / bus / motorcycle | separate profile + re-processing | yes (costing) | yes (profiles) |
| Time-dependent | no (traffic only by re-weighting) | yes | partly (public transit via GTFS) |
| Map matching | yes | yes (Meili) | yes |
| Isochrones / matrix | table only / yes | yes / yes | yes / yes |
| Elevation | no | yes | yes |
| Offline / on-device | no | yes — tiled graph, "small memory footprint", mobile builds | yes (Android) |
| Profile change cost | full re-process | runtime costing | runtime custom model |
| Speed | fastest (CH/MLD) | fast | fast (CH/LM) |

Hosted APIs considered: GraphHopper Directions API (Free plan "for
non-commercial use only", 500 credits/day; paid from €69/month), others
(Mapbox, Google, HERE) are proprietary with storage/display restrictions.

## Options (where it runs)
1. Keep public servers (non-commercial, no SLA) — development and private beta only.
2. **Cloudflare Containers** (Workers Paid): instance types up to 4 vCPU,
   12 GiB, 20 GB disk; on-demand with an inactivity timeout. Regional graphs
   fit (Georgia + neighbours: well under 20 GB); a planet graph does not.
3. External compute (small VM or managed Kubernetes) behind the Worker.

## Decision
- **Now (MVP, private beta):** public OSRM servers, rate-limited, attributed.
- **Before public beta:** self-host **Valhalla** for the launch region, called
  only through the Worker (`/api/v1/route` proxy with per-client rate limits and
  a short cache for identical requests). First choice of compute: **Cloudflare
  Containers** (standard-1/2) if a spike confirms it can stay warm; otherwise a
  small external VM. Overpass-derived data (speed limits, cameras, crossings,
  POIs) moves to a precomputed extract (or own Overpass) in the same step.
- **International scale:** external compute for a planet graph, Worker in front.

## Reason
Valhalla meets the product's needs that OSRM can't without re-processing:
avoid options, truck profiles, time-dependent routing and **on-device offline
routing for the future native apps** (ADR-012), under a permissive MIT licence.
GraphHopper is a close second (Java, larger memory; strong custom models).
OSRM stays the fallback because it is the current, tested integration.

## Consequences
- New provider class (`ValhallaProvider`) behind `RoutingProvider`; Valhalla's
  OSRM-compatible output format may let it reuse the OSRM normaliser —
  **REQUIRES VERIFICATION** in the spike.
- Estimated Containers cost for one always-on instance (30-day month, list
  prices verified 2026-10-02, upper bound assuming provisioned vCPU is billed):
  standard-1 ≈ $53/month, standard-2 ≈ $92/month, plus Workers Paid $5.
  Always-on behaviour **REQUIRES VERIFICATION**.
- Re-processing the regional graph weekly (OSM updates) is a scheduled job
  (Cron Trigger → container, or CI).

## Alternatives rejected
- **Public servers in production:** violates their terms, no SLA.
- **Proprietary routing APIs:** cost per request and display/storage terms
  conflict with weather sampling along the full geometry.
- **Routing inside Workers/WASM:** graph size and CPU limits make it unrealistic.
