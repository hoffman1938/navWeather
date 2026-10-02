# ADR-006 — Map: MapLibre GL JS + OpenFreeMap vector tiles; PMTiles fallback

**Status:** Accepted · **Date:** 2026-10-02 · Facts verified 2026-10-02

## Context
Rendering: MapLibre GL JS (BSD-3-Clause). Tiles and styles: OpenFreeMap
(positron / dark), OpenMapTiles schema, OpenStreetMap data (ODbL).

OpenFreeMap: "Using our public instance is completely free: there are no
limits on the number of map views or requests"; commercial use "Yes"; no
registration or API keys; attribution "OpenFreeMap © OpenMapTiles Data from
OpenStreetMap" (the OpenFreeMap part optional); "I don't offer SLA guarantees";
self-hosting supported with weekly planet builds. ToS: provided "AS-IS", no
"automated" data collection without permission, Hungarian law.
OpenMapTiles: design CC-BY 4.0, attribution "© OpenMapTiles © OpenStreetMap
contributors". OSM attribution may collapse behind an "(i)" if still findable.

## Options
1. OpenFreeMap public (current).
2. Self-hosted PMTiles (Protomaps/OpenMapTiles build) on R2 served by the Worker.
3. Commercial tile APIs (MapTiler, Mapbox, Stadia…).

## Decision
Keep **OpenFreeMap public** for MVP and beta. Before public launch, prepare a
**fallback style pointing at a regional PMTiles archive on R2** (served through
the Worker with range requests), switchable by `VITE_MAP_STYLE_*`. Keep the
map attribution control visible top-right (already) and the data credits in
the sheets.

## Reason
Free, commercial use allowed, no keys, vector tiles that MapLibre renders
natively on web and (MapLibre Native) on iOS/Android. The single risk is
availability (no SLA, donation-funded) — mitigated by a self-hosted fallback.

## Consequences
- R2 becomes justified only when the fallback is built (free tier: 10 GB-month,
  1M Class A, 10M Class B ops, free egress). A regional archive fits easily.
- Offline regions for native apps reuse the same PMTiles builds (ADR-012).
- Never bulk-download OpenFreeMap tiles (their ToS); build our own instead.

## Alternatives rejected
- **Commercial tiles now:** cost and keys with no capability gain.
- **Raster OSM tiles from tile.openstreetmap.org:** OSMF tile policy is for
  light use; vector tiles are better for styling and dark mode.
