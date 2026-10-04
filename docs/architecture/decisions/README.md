# Architecture Decision Records

One file per architecturally significant decision. Trivial implementation
details do not get an ADR. Format: Context → Options → Decision → Reason →
Consequences → Alternatives rejected → Status.

Statuses: **Proposed** · **Accepted** · **Superseded** (link to the
successor) · **Deprecated**. Never edit an accepted ADR's decision in place —
supersede it with a new one.

| ADR | Title | Status |
| --- | --- | --- |
| [001](ADR-001-cloudflare-first.md) | Cloudflare-first, one Worker with static assets (not Pages) | Accepted |
| [002](ADR-002-frontend-stack.md) | Frontend: Vite + React SPA (no Next.js/Astro) | Accepted |
| [003](ADR-003-client-engines-thin-edge.md) | Deterministic engines in shared TypeScript; thin edge API | Accepted |
| [004](ADR-004-routing-engine.md) | Routing: public OSRM now, self-hosted Valhalla before public beta | Accepted; paid hosting amended by 014 (free fallback chain, own router optional) |
| [005](ADR-005-weather-provider.md) | Weather: Open-Meteo; shared edge cache + commercial key before commercial use | Accepted; paid key amended by 014 (client-direct, MET Norway fallback) |
| [006](ADR-006-map-stack.md) | Map: MapLibre + OpenFreeMap, PMTiles fallback | Accepted; fallback amended by 014 (VersaTiles) |
| [007](ADR-007-data-storage.md) | Storage: no server DB for MVP; D1 with accounts; DO for real time; KV narrowly | Accepted |
| [008](ADR-008-identity.md) | Identity: anonymous first; optional passkey/email account | Accepted (not built) |
| [009](ADR-009-api-versioning.md) | API versioning: `/api/v1`, unversioned alias kept | Accepted (implemented) |
| [010](ADR-010-mobile-stack.md) | Mobile stack: decide by spike; React Native + native car modules favoured | Proposed; store apps BLOCKED by 014 (fees) |
| [011](ADR-011-public-transport.md) | Public transport via Transitous, switchable off | Accepted (terms pending) |
| [012](ADR-012-offline.md) | Offline: honest shell-and-cache on web; regions and on-device routing native-only | Accepted |
| [013](ADR-013-trip-planner.md) | Long-trip planner: stateless Worker endpoints over a shared TS domain module | Accepted; web planning moved to the client by 014 (Free CPU limit) |
| [014](ADR-014-zero-cost.md) | Zero cost and free for users: free tiers only, non-commercial, core independent of our quota | Accepted (2026-10-03); superseded in part by 015 (hosting may be paid) |
| [015](ADR-015-free-software-own-hosting.md) | Free software and open data on our own (paid) hosting; no paid services, no sponsors; Google-Maps-class scale | Accepted (2026-10-04) — plan: [FREE_STACK_PLAN](../../FREE_STACK_PLAN.md) |

All external facts in these ADRs were verified against official sources on
**2026-10-02**; see [LICENSING_MATRIX](../../legal/LICENSING_MATRIX.md) for links.
