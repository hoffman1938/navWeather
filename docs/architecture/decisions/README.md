# Architecture Decision Records

One file per architecturally significant decision. Trivial implementation
details do not get an ADR. Format: Context → Options → Decision → Reason →
Consequences → Alternatives rejected → Status.

Statuses: **Proposed** · **Accepted** · **Superseded** (link to the
successor) · **Deprecated**. Never edit an accepted ADR's decision in place —
supersede it with a new one (a dated "Update" line under the status is allowed).

**Current direction (2026-10-04):** [ADR-015](ADR-015-free-software-own-hosting.md) — every third-party component free
forever, only hosting is paid; [ADR-016](ADR-016-all-on-cloudflare-workers.md) — all hosting on Cloudflare Workers (not
Pages), every part also runs on localhost. Plan: [DEVELOPMENT_PLAN](../../DEVELOPMENT_PLAN.md).

| ADR | Title | Status |
| --- | --- | --- |
| [001](ADR-001-cloudflare-first.md) | Cloudflare-first, one Worker with static assets (not Pages) | Accepted; extended by 016 |
| [002](ADR-002-frontend-stack.md) | Frontend: Vite + React SPA (no Next.js/Astro) | Accepted |
| [003](ADR-003-client-engines-thin-edge.md) | Deterministic engines in shared TypeScript; thin edge API | Accepted |
| [004](ADR-004-routing-engine.md) | Routing: public OSRM now, self-hosted Valhalla before public beta | Accepted; amended by 014, then by 015/016 (Valhalla in Cloudflare Containers per region; no public routers anywhere) |
| [005](ADR-005-weather-provider.md) | Weather: Open-Meteo; shared edge cache + commercial key before commercial use | Superseded by 015/016 (own weather pipeline → cells in R2; no paid key, no MET Norway) |
| [006](ADR-006-map-stack.md) | Map: MapLibre + OpenFreeMap, PMTiles fallback | Accepted; amended by 015/016 (own PMTiles in R2 primary, OpenFreeMap fallback) |
| [007](ADR-007-data-storage.md) | Storage: no server DB for MVP; D1 with accounts; DO for real time; KV narrowly | Accepted; amended by 016 (D1 also for regional places and geocoder) |
| [008](ADR-008-identity.md) | Identity: anonymous first; optional passkey/email account | Accepted (not built) |
| [009](ADR-009-api-versioning.md) | API versioning: `/api/v1`, unversioned alias kept | Accepted (implemented) |
| [010](ADR-010-mobile-stack.md) | Mobile stack: decide by spike; React Native + native car modules favoured | Proposed; store apps BLOCKED by 014/015 (fees) |
| [011](ADR-011-public-transport.md) | Public transport via Transitous, switchable off | Accepted; amended by 015/016 (own MOTIS in Containers) |
| [012](ADR-012-offline.md) | Offline: honest shell-and-cache on web; regions and on-device routing native-only | Accepted; under review (ADR-018 for offline regions in the PWA, DP-9.8) |
| [013](ADR-013-trip-planner.md) | Long-trip planner: stateless Worker endpoints over a shared TS domain module | Accepted; amended by 014, then by 016 (no CPU limit on Workers Paid; places via own Places API) |
| [014](ADR-014-zero-cost.md) | Zero cost and free for users: free tiers only, non-commercial, core independent of our quota | Accepted (2026-10-03); superseded in part by 015/016 |
| [015](ADR-015-free-software-own-hosting.md) | Free software and open data on our own (paid) hosting; no paid services, no sponsors; always free; Google-Maps-class scale | Accepted (2026-10-04) |
| [016](ADR-016-all-on-cloudflare-workers.md) | All hosting on Cloudflare: Workers (not Pages) + R2 + D1 + Durable Objects + Queues + Cron + Containers; localhost parity | Accepted (2026-10-04) |
| 017 | Traffic from our own users' anonymised speeds (privacy) | Planned (DP-10.1) |
| 018 | Offline regions in the PWA | Planned (DP-9.8) |

External facts in ADR-001…014 were verified against official sources on **2026-10-02**, in ADR-015/016 on
**2026-10-04**; see [LICENSING_MATRIX](../../legal/LICENSING_MATRIX.md), [FREE_STACK_PLAN §12](../../FREE_STACK_PLAN.md)
and [DEVELOPMENT_PLAN §12](../../DEVELOPMENT_PLAN.md) for links.
