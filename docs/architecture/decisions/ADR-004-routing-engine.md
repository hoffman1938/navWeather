# ADR-004 — Routing: self-hosted Valhalla in Cloudflare Containers, per region

**Status:** Accepted · **Date:** 2026-10-02 · **Revised:** 2026-10-04 (aligned with ADR-015/016; history in git)

## Context
Routing must stay free forever at any scale (ADR-015) and run on Cloudflare (ADR-016). The current code still calls
the public OSRM demo (car) and FOSSGIS OSRM (walk, bike); their policies allow ≤1 request/s, light non-commercial use and
no production use, so they are replaced (DEVELOPMENT_PLAN stage 6). A routing engine cannot run inside a Worker
(multi-GB graph, long-lived process).

## Options (engines)

| | OSRM | Valhalla | GraphHopper (OSS) |
| --- | --- | --- | --- |
| Licence | BSD-2-Clause | MIT | Apache-2.0 |
| Turn-by-turn, lanes | yes | yes | yes |
| Alternatives | yes | yes | yes |
| Avoid tolls/highways/ferries at request time | only classes compiled into the profile | yes (costing options) | yes (custom models) |
| Truck / motorcycle / wheelchair | separate profile + re-processing | yes (costing) | yes (profiles) |
| Map matching, isochrones, matrix, optimised route | partly | yes | yes |
| Elevation | no | yes | yes |
| Live/historic traffic speeds | segment speed updates | yes | partly |
| On-device / offline (future native) | no | yes (tiled graph, mobile builds) | yes (Android) |

## Decision
- **Valhalla**, self-hosted, one instance group per region in **Cloudflare Containers** (Workers Paid), called only
  through the Worker: `POST /api/v1/route` with per-client rate limits and a short cache for identical requests.
- One engine for car, walking, cycling, later truck/motorcycle/wheelchair, isochrones, optimised stop order and
  traffic speeds (DP-5.2, DP-6.2, DP-6.3, DP-9.x, DP-10.4).
- The regional graph is built from OSM by our pipeline and baked into the image (container disk is ephemeral); rebuilt
  weekly. Locally the same image runs in Docker (ADR-016 localhost parity).
- OSRM stays as an optional provider in the code (it is the tested integration today) until `ValhallaProvider` passes
  the same scenario tests.

## Reason
Valhalla covers what the product needs without re-processing (avoid options, vehicle profiles, traffic, matching,
isochrones), has a permissive licence and a tiled graph suitable for regional sharding and future on-device routing.

## Consequences
- New provider class `ValhallaProvider` behind `RoutingProvider`; whether Valhalla's OSRM-compatible output can reuse
  the OSRM normaliser is checked in DP-6.2.
- A container instance holds at most 4 vCPU / 12 GiB / 20 GB disk: regional graphs fit; a planet graph does not. If the
  capacity pilot (DP-5.6) shows regional sharding is not enough, the engine moves to rented servers behind the same
  Worker route (new ADR).
- Cold starts (~1–3 s) and minimum warm instances are part of capacity planning.

## Alternatives rejected
- **Public routing servers:** usage limits and no production use (ADR-015).
- **Proprietary routing APIs:** per-request fees (ADR-015).
- **Routing inside Workers/WASM:** graph size and memory limits.
