# Cost and scale model

Decisions: [ADR-015](../architecture/decisions/ADR-015-free-software-own-hosting.md) — the only cost is hosting; every
third-party component is free forever. [ADR-016](../architecture/decisions/ADR-016-all-on-cloudflare-workers.md) —
hosting is Cloudflare. Placement of each component: [FREE_STACK_PLAN §6a](../FREE_STACK_PLAN.md).

**Status:** the measured model (hosting cost per 1,000 daily active users) comes from the capacity pilot
**DP-5.6** and is then reported monthly (DP-12.7). Until then this file lists the cost drivers, list prices and the
method. Prices verified 2026-10-04 at developers.cloudflare.com.

## 1. What costs money (only Cloudflare hosting)

| Item | Price (list) | Cost driver | How we keep it low |
| --- | --- | --- | --- |
| Workers Paid base | $5/month, 10 M requests included, then $0.30 per million | API requests | static assets for everything that fits (free, unlimited); one corridor request for reports; caching |
| Static assets | free, unlimited requests | — | app, small regional tile sets, borders |
| R2 | storage and operations; **egress free** | tile/places/weather reads | Cache API on the custom domain; immutable files; offline region packs |
| D1 | rows read/written, storage | geocoder and places queries | answers by tile → cache; one database per region |
| Durable Objects | requests and active duration | live share, reports, traffic aggregates | hibernating WebSockets (incoming messages billed 20:1); sharding by geohash |
| Queues | messages | push fan-out, traffic ingestion | aggregation on the device; drop raw points |
| Containers | $0.000020 per vCPU-second, $0.0000025 per GiB-second, disk per GB-second, only while running; egress $0.025/GB in North America/Europe (1 TB/month included) | routing, transit, radar requests | regional instance groups; scale to zero; cache identical requests; matrices only on demand |
| Domain | registrar price | — | attached to the Worker (DP-12.1) |

Development and the preview Worker cost $0 on Workers Free until the first engine runs in Containers (DP-5.1).

## 2. Request pattern per daily active user (to be measured)

The pilot measures, per role, requests per DAU and requests per second one container instance sustains:

| Role | What triggers requests | Measured in |
| --- | --- | --- |
| Routing (Valhalla) | plan (1 + alternatives), re-routes, detour matrices, weather re-route checks | DP-5.6 |
| Geocoder (D1) | autocomplete (debounced), submit, reverse naming | DP-5.6 |
| Places (R2/D1) | places along the route, POI search, limits/cameras by corridor | DP-5.6 |
| Weather cells (R2) | plan samples, place cards, map layer; refresh on new model runs | DP-5.6 |
| Real time (DO) | live share updates, report corridor refreshes | DP-5.6 |
| Tiles (R2 / static) | map views; offline region downloads | DP-5.6 |

## 3. Scale rules

- Upstream data volume (model files, OSM extracts, feeds) depends on regions and refresh cadence, **not on users**.
- Every server role is stateless and horizontally scalable; Durable Objects are sharded by region before any object
  nears ~1,000 req/s (REQ-CF-008).
- Engines run per region; a region is added by the procedure DP-13.9.
- If container limits (4 vCPU / 12 GiB / 20 GB per instance; 1,500 vCPU per account) block planet-scale engines, the
  heavy engines move to rented servers behind the same Worker routes — decided by the pilot, recorded in an ADR.

## 4. Triggers

| Trigger | Action |
| --- | --- |
| First engine needed on preview | enable Workers Paid; spend alerts (DP-5.1) |
| Custom domain bought | Cache API in front of tiles, places and weather; WAF rules (DP-12.1) |
| Reports object > 200 req/s at peak | shard by region (DP-7.2) |
| Container group CPU > 70 % sustained | more instances in that region; review cache hit rates |
| New region | data pipeline + engine images + checks (DP-13.9) |
