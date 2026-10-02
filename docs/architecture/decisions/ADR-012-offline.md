# ADR-012 — Offline: honest shell-and-cache on web; regions and on-device routing native-only

**Status:** Accepted · **Date:** 2026-10-02

## Context
Drivers lose signal in tunnels and mountains. The web app: service worker
caches the app shell and hashed assets only (never provider responses, tiles or
`/api/*` — their URLs carry coordinates); a loaded route, its instructions and
its forecasts stay in memory and are labelled stale.

## Decision
| Capability | Web (now) | Native (future) |
| --- | --- | --- |
| App starts offline | yes (shell) | yes |
| Continue a loaded route: guidance, voice, cached weather (stale label) | yes | yes |
| Map tiles offline | no (only what MapLibre has in memory) | downloadable regional PMTiles (ADR-006 builds) |
| Re-route offline | no — says so | Valhalla tiles on device (ADR-004) |
| Search offline | no | small offline index of saved places/recents only |
| New forecasts offline | no — last forecast labelled stale | same |

Never promise offline navigation the stack can't deliver (REQ-OFF-002).

## Reason
Browsers limit storage and evict it; caching tiles/coordinates in the service
worker would also amount to storing location history. Native apps can manage
explicit, user-initiated regional downloads with clear sizes.

## Consequences
Offline regions are a Phase 4+ feature tied to the self-hosted tile builds and
the Valhalla migration.
