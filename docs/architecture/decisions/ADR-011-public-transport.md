# ADR-011 — Public transport: own MOTIS in Cloudflare Containers with open feeds; switchable off

**Status:** Accepted · **Date:** 2026-10-02 · **Revised:** 2026-10-04 (aligned with ADR-015/016; history in git)

## Context
Public transport needs timetables. The current code uses Transitous (community-run MOTIS over operators' open GTFS
feeds). Its policy: open-source and non-commercial projects only, light use, contact before routing use — a limit that
ADR-015 does not allow. MOTIS itself is MIT-licensed and supports GTFS/NeTEx, GTFS-RT/SIRI, GBFS and OSM street routing.
Coverage for Georgia: Tbilisi Transport Company (buses, metro); Georgian Railway is published but returned no
itineraries for Tbilisi → Batumi in live tests (2026-10-02).

## Decision
- **Own MOTIS** instance group per region in **Cloudflare Containers**, behind `/api/v1/transit` (DP-5.3), with the
  region's timetables baked into the image (ephemeral disk) and rebuilt on feed updates.
- **Only open feeds without keys or quotas**, each with its licence checked; Transitous' public feed list is a starting
  point for discovery. Real time (GTFS-RT) and bike/scooter sharing (GBFS) are added the same way (DP-9.6, DP-9.7).
- Plan-only (no turn-by-turn for transit); every itinerary is an option starting at its timetabled time; a departure
  change re-plans; operators' attribution shown on every trip. The mode is switched off by configuration and the UI says so.
- Until DP-6.7 the code keeps using Transitous with its sources link.

## Consequences
- `TransitousProvider` becomes `MotisProvider` (same MOTIS `plan` API, our endpoint).
- Coverage equals what operators publish; "No public transport found" stays honest.

## Alternatives rejected
- **Transitous in production:** usage conditions (ADR-015).
- **Commercial transit APIs (Google, HERE, Navitia):** keys and per-request fees.
