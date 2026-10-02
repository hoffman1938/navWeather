# ADR-003 — Deterministic engines in shared TypeScript; thin edge API

**Status:** Accepted · **Date:** 2026-10-02

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
`src/navigation`, `src/types`). The edge grows only for: secrets (paid
provider keys), shared caches (weather, routing proxy), multi-user state
(sharing, reports, accounts). A `POST /api/v1/route-weather` endpoint is added
only if ADR-010's spike shows a native client cannot run the TS core.

## Reason
- **Privacy:** the server never needs to see a user's whole trip to give them
  its weather; positions during navigation never leave the device.
- **Latency and offline:** the driving loop (map matching, deviation, alerts,
  voice) must work in a tunnel; it cannot depend on a round-trip.
- **Cost:** derive() runs on the user's CPU; a server engine would multiply
  Worker CPU time per active driver (10 ms/invocation on Free).
- **Correctness:** one implementation, already covered by tests.

## Consequences
- Weather and routing providers are called from browsers until the edge cache
  exists (ADR-004, ADR-005). Terms that limit per-user rates (OSRM 1 req/s,
  Nominatim 1 req/s) are enforced in the client.
- Native apps must either embed a JS runtime for the core or port it — the
  decisive factor in ADR-010.
- Server-side caching only ever stores provider responses keyed by grid cell
  and model run, never by user.

## Alternatives rejected
- **Server engines (2):** moves location data and CPU to the server, breaks
  offline driving, duplicates a tested core.
