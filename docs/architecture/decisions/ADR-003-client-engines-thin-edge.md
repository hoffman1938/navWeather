# ADR-003 — Deterministic engines in shared TypeScript; thin edge API

**Status:** Accepted · **Date:** 2026-10-02 · **Revised:** 2026-10-04 (edge scope aligned with ADR-015/016)

## Context
The brief sketches a server-side pipeline (`POST /api/v1/routes`,
`GET /routes/:id/weather`, a "Weather Engine" Worker). Today the route-weather
pipeline (sampling, ETA, forecast matching, grouping, alerts, navigation) runs
on the client as pure TypeScript with no React/DOM dependency
(`src/algorithms`, `src/intelligence`, `src/navigation`), and the Worker only
does what needs a server (live sharing, reports, approximate location).

## Options
1. **Client engines + thin edge** (current): clients compute; the edge relays,
   caches and protects keys.
2. **Server engines:** the Worker computes route weather and alerts; clients render.
3. **Hybrid:** client computes; the server offers the same computation as an
   API for clients that can't run the TS core (e.g. a car head unit).

## Decision
**Option 1 now, option 3 when a native client needs it.** The engines stay
platform-neutral TypeScript packages (`src/algorithms`, `src/intelligence`,
`src/navigation`, `src/types`). The edge grows only for: our own engines and data that
clients cannot hold (routing, geocoding, places, transit, weather cells — ADR-015/016), shared caches, multi-user
state (sharing, reports, accounts) and secrets (e.g. Web Push keys). A `POST /api/v1/route-weather` endpoint is added
only if ADR-010's spike shows a native client cannot run the TS core.

## Reason
- **Privacy:** the server never needs to see a user's whole trip to give them
  its weather; positions during navigation never leave the device.
- **Latency and offline:** the driving loop (map matching, deviation, alerts,
  voice) must work in a tunnel; it cannot depend on a round-trip.
- **Cost:** derive() runs on the user's CPU; a server engine would multiply
  Worker CPU time per active driver (engines that must run on servers — routing, search — are the exception, ADR-004).
- **Correctness:** one implementation, already covered by tests.

## Consequences
- Until DEVELOPMENT_PLAN stage 6 the browser still calls public providers directly, with their per-user limits
  (OSRM 1 req/s, Nominatim 1 req/s) enforced in the client; afterwards it calls only our Worker and engines.
- Native apps must either embed a JS runtime for the core or port it — the
  decisive factor in ADR-010.
- Server-side caching only ever stores provider responses keyed by grid cell
  and model run, never by user.

## Alternatives rejected
- **Server engines (2):** moves location data and CPU to the server, breaks
  offline driving, duplicates a tested core.
