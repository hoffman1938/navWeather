# ADR-009 — API versioning: `/api/v1`, unversioned alias kept

**Status:** Accepted (implemented 2026-10-02) · **Date:** 2026-10-02

## Context
The Worker served `/api/share…`, `/api/reports…`, `/api/whereami` with no
version. Future native clients cannot be force-updated the way a web page can,
so the contract must be stable and versioned. Old web app shells may be cached
by the service worker for a while after a deploy.

## Decision
- Every endpoint is served under **`/api/v1/…`**. The web client calls only
  versioned paths (`src/api/v1.ts` → `apiPaths`).
- The unversioned `/api/…` paths remain **aliases of v1** for old shells and
  scripts. They may be removed after a deprecation period, never silently.
- `/api/vN/…` for any other N → `404 { "error": "unsupported-api-version", "supported": [1] }`.
- `GET /api/v1/health` → `{ "ok": true, "api": 1 }` (no storage touched).
- Rules for v1: additive changes only (new optional fields, new endpoints);
  breaking change ⇒ `/api/v2` served side by side until clients migrate.
- Request/response types are shared code (`src/share/protocol.ts`,
  `src/reports/protocol.ts`, `src/api/v1.ts`), imported by the Worker and the
  web client; native clients get them from [API_V1](../../api/API_V1.md)
  (and, later, a generated OpenAPI file).

## Consequences
- Path normalisation is one pure function (`normalizeApiPath`) with unit tests;
  the smoke scripts run against both prefixes (`API=/api npm run test:share`).
- The service worker rule "never cache `/api/`" covers both prefixes.

## Alternatives rejected
- **Header-based versioning** (`Accept: …;version=1`): invisible in logs and
  harder for simple clients; path versioning is explicit.
- **No versioning until mobile:** the first native release would freeze
  whatever unversioned shape existed.
