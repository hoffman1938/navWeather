# ADR-013 — Long-trip planner as a stateless Worker endpoint over a shared TS domain module

**Status:** Accepted · **Date:** 2026-10-02 · **Revised:** 2026-10-04 (aligned with ADR-016; history in git) ·
**Amends:** ADR-003 (for trip planning only)

## Context
Long Trip Mode ([features/LONG_TRIP_MODE.md](../../features/LONG_TRIP_MODE.md)) turns a route into a trip plan:
classification, rest / fuel / meal / overnight stops, multi-day segments, weather risks at the real (stop-aware) times,
recommended places and replanning when delayed. The owner decided that the **trip planner runs on Cloudflare**, while
vehicle profile, preferences and any saved trip stay **on the device**, and hotels come from **open data only**.

## Options
1. Client-only planner (ADR-003 default).
2. Server planner with server-side state: stored trips, background monitoring from continuous position uploads.
3. **Stateless server planner:** the client sends what the plan needs; the Worker computes and returns a `TripPlan`;
   nothing is stored or logged.

## Decision
Option 3.
- Domain logic lives in `src/trip/` — pure TypeScript with no DOM and no Workers-only APIs (classification, schedule,
  overnight zones, place ranking, opening hours, weather risks, replanning helpers). The Worker imports it like the
  share/report protocols, so the same engine can run on other clients unchanged.
- `POST /api/v1/trips/plan` validates the request and returns the plan without place lookups (overnight areas from
  settlements). Runs on **Workers Paid** (CPU up to 30 s by default), so long trips are not cut by the Free 10 ms limit
  (B-23).
- Stop places come from **our Places API** on D1/R2 (DP-6.5) instead of public Overpass; country borders are detected on
  the **client** from public-domain Natural Earth boundaries (DP-4.5). This removes the Cache-API-on-`workers.dev`
  problem (B-22).
- The client classifies instantly with the same pure function, asks the Worker for the plan, applies the plan's stop
  durations to every ETA (weather at the real times), and asks again when it falls behind (no server-side monitoring).
- Weather input comes from the client's own forecasts (hourly hazard codes per route sample); the Worker does not fetch
  weather.
- Rate-limited per client (`TRIP_LIMITER`); no storage, no logging of coordinates.

## Reason
Meets the owner's choice (planning on Cloudflare, one engine for every client) without location history: the request is
processed and discarded, like a routing request.

## Consequences
- Offline: the last plan stays (labelled); a new plan needs the network; classification works offline. Running the same
  module in a browser Web Worker for offline planning is a possible future step (REQ-TRIP-022).
- Queues and D1 are not used by the planner: replanning is client-triggered; preferences are device settings.

## Alternatives rejected
- **Option 2:** continuous position uploads and stored trips contradict REQ-PRIV-001/002.
- **Option 1:** contradicts the owner's decision.
