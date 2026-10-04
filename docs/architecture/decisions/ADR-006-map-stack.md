# ADR-006 — Map: MapLibre GL JS + own vector tiles (PMTiles in R2); OpenFreeMap as fallback

**Status:** Accepted · **Date:** 2026-10-02 · **Revised:** 2026-10-04 (aligned with ADR-015/016; history in git)

## Context
Rendering: MapLibre GL JS (BSD-3-Clause). Today the tiles and styles come from OpenFreeMap (positron / dark,
OpenMapTiles schema, OSM data): "no limits on the number of map views or requests", commercial use allowed, no keys,
but no SLA and donation-funded. ADR-015 requires every component to stay free forever; ADR-016 puts hosting on
Cloudflare. Attribution: "© OpenMapTiles © OpenStreetMap contributors" (plus OpenFreeMap when its tiles are shown).

## Decision
- **Own vector tiles** built from OSM with Planetiler (Apache-2.0) in the OpenMapTiles schema, packed as **PMTiles** and
  stored in **R2** (small regional sets may be static assets), served by the Worker with range requests and, once the
  custom domain exists, the Cache API (DP-5.5).
- **OpenFreeMap** stays as the automatic fallback when our tiles fail (DP-6.8) — it has no limits and no paid tier.
- Styles light/dark, fonts (Noto, OFL) and sprites are ours; the map attribution control stays visible.
- Never bulk-download OpenFreeMap tiles (their ToS).

## Reason
Own tiles remove the single external availability risk of the map and keep its cost to R2 storage and operations (no
egress fees); MapLibre renders the same PMTiles on the web and natively.

## Consequences
- Weekly tile builds per region in the data pipeline (Planetiler needs memory proportional to the region; planet-size
  builds are split by region).
- Offline regions reuse the same PMTiles (DP-9.8, ADR-018).
- Satellite, terrain and transit/cycling layers are added as extra sources (DP-8.x).

## Alternatives rejected
- **Commercial tile APIs:** per-request fees (ADR-015).
- **Raster tiles from tile.openstreetmap.org:** OSMF policy is for light use; vector tiles are better for styling and dark mode.
