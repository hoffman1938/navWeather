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
| [004](ADR-004-routing-engine.md) | Routing: public OSRM now, self-hosted Valhalla before public beta | Accepted (migration planned) |
| [005](ADR-005-weather-provider.md) | Weather: Open-Meteo; shared edge cache + commercial key before commercial use | Accepted |
| [006](ADR-006-map-stack.md) | Map: MapLibre + OpenFreeMap, PMTiles fallback | Accepted |
| [007](ADR-007-data-storage.md) | Storage: no server DB for MVP; D1 with accounts; DO for real time; KV narrowly | Accepted |
| [008](ADR-008-identity.md) | Identity: anonymous first; optional passkey/email account | Accepted (not built) |
| [009](ADR-009-api-versioning.md) | API versioning: `/api/v1`, unversioned alias kept | Accepted (implemented) |
| [010](ADR-010-mobile-stack.md) | Mobile stack: decide by spike; React Native + native car modules favoured | Proposed |
| [011](ADR-011-public-transport.md) | Public transport via Transitous, switchable off | Accepted (terms pending) |
| [012](ADR-012-offline.md) | Offline: honest shell-and-cache on web; regions and on-device routing native-only | Accepted |

All external facts in these ADRs were verified against official sources on
**2026-10-02**; see [LICENSING_MATRIX](../../legal/LICENSING_MATRIX.md) for links.
