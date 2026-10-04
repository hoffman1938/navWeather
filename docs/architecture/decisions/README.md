# Architecture Decision Records

One file per architecturally significant decision, describing the **current** decision. Format: Context → Options →
Decision → Reason → Consequences → Alternatives rejected → Status. When a decision changes, the ADR is revised (status
line "Revised: <date>") or replaced by a new one; the previous text stays in git history.

**Current direction (2026-10-04):** [ADR-015](ADR-015-free-software-own-hosting.md) — every third-party component free
forever, only hosting is paid; [ADR-016](ADR-016-all-on-cloudflare-workers.md) — all hosting on Cloudflare Workers (not
Pages), every part also runs on localhost. Plan: [DEVELOPMENT_PLAN](../../DEVELOPMENT_PLAN.md).

| ADR | Title | Status |
| --- | --- | --- |
| [001](ADR-001-cloudflare-first.md) | Cloudflare-first, one Worker with static assets (not Pages) | Accepted; extended by 016 |
| [002](ADR-002-frontend-stack.md) | Frontend: Vite + React SPA (no Next.js/Astro) | Accepted |
| [003](ADR-003-client-engines-thin-edge.md) | Deterministic engines in shared TypeScript; thin edge API | Accepted (revised 2026-10-04) |
| [004](ADR-004-routing-engine.md) | Routing: self-hosted Valhalla in Cloudflare Containers, per region | Accepted (revised 2026-10-04) |
| [006](ADR-006-map-stack.md) | Map: MapLibre + own PMTiles in R2; OpenFreeMap fallback | Accepted (revised 2026-10-04) |
| [007](ADR-007-data-storage.md) | Storage: device first; D1 per region; Durable Objects for real time; R2 for files | Accepted (revised 2026-10-04) |
| [008](ADR-008-identity.md) | Identity: anonymous first; optional passkey account | Accepted (not built) |
| [009](ADR-009-api-versioning.md) | API versioning: `/api/v1`, unversioned alias kept | Accepted (implemented) |
| [010](ADR-010-mobile-stack.md) | Mobile stack: decide by spike | Proposed; store apps BLOCKED by fees (ADR-015) — Android via F-Droid only |
| [011](ADR-011-public-transport.md) | Public transport: own MOTIS in Containers with open feeds | Accepted (revised 2026-10-04) |
| [012](ADR-012-offline.md) | Offline: honest shell-and-cache on web; regions and on-device routing native-only | Accepted; under review (ADR-018, DP-9.8) |
| [013](ADR-013-trip-planner.md) | Long-trip planner: stateless Worker endpoint over a shared TS domain module | Accepted (revised 2026-10-04) |
| [015](ADR-015-free-software-own-hosting.md) | Always free: free software and open data on our own hosting; no paid services, no sponsors | Accepted (2026-10-04) |
| [016](ADR-016-all-on-cloudflare-workers.md) | All hosting on Cloudflare Workers (not Pages) + R2 + D1 + Durable Objects + Queues + Cron + Containers; localhost parity | Accepted (2026-10-04) |
| 017 | Traffic from our own users' anonymised speeds (privacy) | Planned (DP-10.1) |
| 018 | Offline regions in the PWA | Planned (DP-9.8) |

Numbers 005 (weather via Open-Meteo with a paid key) and 014 (zero cost, free tiers only) are no longer current —
replaced by ADR-015/016; their files are removed (DEVELOPMENT_PLAN DP-0.8) and remain in git history.

External facts were verified against official sources on 2026-10-02 (ADR-001…013) and 2026-10-04 (ADR-004, 006, 007,
011, 013 revisions, ADR-015/016); see [LICENSING_MATRIX](../../legal/LICENSING_MATRIX.md), [FREE_STACK_PLAN §12](../../FREE_STACK_PLAN.md)
and [DEVELOPMENT_PLAN §12](../../DEVELOPMENT_PLAN.md).
