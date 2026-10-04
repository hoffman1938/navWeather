# ADR-013 — Long-trip planner as a stateless Worker endpoint over a shared TS domain module

**Status:** Accepted · **Date:** 2026-10-02 · **Amends:** ADR-003 (for trip planning only)
**Update 2026-10-04:** amended by [ADR-016](ADR-016-all-on-cloudflare-workers.md): on Workers Paid the 10 ms CPU limit (B-23) no longer applies; stop places come from our Places API on D1/R2 and borders from Natural Earth on the client (B-22; DP-4.5, DP-6.5).

## Context
Long Trip Mode ([features/LONG_TRIP_MODE.md](../../features/LONG_TRIP_MODE.md))
turns a route into a trip plan: classification, rest / fuel / meal /
overnight stops, multi-day segments, weather risks at the real (stop-aware)
times, recommended places and replanning when delayed. ADR-003 keeps the
deterministic engines on the client. The owner decided (2026-10-02) that the
**trip planner runs on Cloudflare**, while vehicle profile, preferences and
any saved trip stay **on the device**, hotels come from **OpenStreetMap only**,
and the first delivery is **core first**.

## Options
1. Client-only planner (ADR-003 default).
2. Server planner with server-side state: stored trips, background
   monitoring through Queues from continuous position uploads.
3. **Stateless server planner:** the client sends what the plan needs; the
   Worker computes and returns a `TripPlan`; nothing is stored or logged.

## Decision
Option 3.
- Domain logic lives in `src/trip/` — pure TypeScript with no DOM and no
  Workers-only APIs (classification, schedule, overnight zones, place
  ranking, opening hours, weather risks, replanning helpers). The Worker
  imports it like the share/report protocols, so the same engine can later run
  on iOS/Android/CarPlay/Android Auto or a fleet backend unchanged.
- `POST /api/v1/trips/plan` (Worker) validates the request and returns the
  plan **without place lookups** (≈0.3 s): overnight areas are chosen from
  settlements. Live tests showed the public Overpass taking ~7–11 s per
  query, so places are a separate call:
  `POST /api/v1/trips/places` (one stop, Overpass **server-side** with an
  identifying User-Agent, edge-cached by area for 24 h) when the user opens a
  stop (the first night is prefetched), and `POST /api/v1/trips/borders`
  (countries along the route, one `is_in` query, cached 7 days).
  Rate-limited per client. No storage, no logging of coordinates.
- The client classifies instantly with the same pure function (so the UI
  reacts before the network answers, and offline), asks the Worker for the
  plan, applies the plan's stop durations to every ETA (weather at the real
  times), and asks again when it falls behind (no server-side monitoring).
- Weather input comes from the client's own forecasts (hourly hazard codes
  per route sample), so the Worker does not call Open-Meteo (ADR-005's
  free-tier constraint is unchanged).

## Reason
Meets the owner's choice (planning on Cloudflare, one engine for every
client) without location history: the request is processed and discarded,
like a routing request. Server-side Overpass calls can be cached across users
by area and carry a proper User-Agent — better for the public Overpass than
per-browser calls.

## Consequences
- Three endpoints, a new rate-limit binding (`TRIP_LIMITER`), and Overpass
  subrequests from the Worker (one per places/borders call).
- Workers Free allows **10 ms CPU** per invocation; JSON parsing of Overpass
  answers plus planning can exceed it on long trips → Workers Paid is
  expected for production use of this endpoint (REQ-CF-007). Measured cost
  REQUIRES VERIFICATION after deployment.
- Offline: the last plan stays (labelled); a new plan needs the network.
  Classification still works offline.
- Queues are **not** introduced: replanning is client-triggered.
- D1 is **not** introduced: preferences and vehicle profile are device settings.

## Alternatives rejected
- **Option 2:** continuous position uploads and stored trips contradict
  REQ-PRIV-001/002 and the owner's storage choice.
- **Option 1:** contradicts the owner's decision.
