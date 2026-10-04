# ADR-011 — Public transport via Transitous, switchable off

**Status:** Accepted (terms pending owner action) · **Date:** 2026-10-02 · Facts verified 2026-10-02

## Context
Public transport needs timetables. There is no free worldwide timetable API
without a key except Transitous (community-run MOTIS over operators' open
GTFS feeds; CORS-enabled; `api.transitous.org`). Its usage policy: the project
must be **open source**, **not commercial**, **light on resources**; requests
identify themselves (User-Agent, or Referer for browsers); link to
`https://transitous.org/sources/` visibly; "Please contact us before using any
potentially resource-intensive API endpoints (such as routing…)"; "Commercial
use is not allowed". Coverage for Georgia (sources page, 2026-10-02): Tbilisi
Transport Company (buses, metro) and Georgian Railway (ODbL) — but Tbilisi →
Batumi returned no itineraries in live tests.

## Decision
Use Transitous (`TransitousProvider`, MOTIS `plan` v5) for the transit mode,
plan-only (no turn-by-turn), with the sources link shown on every trip. The
mode is switched off by `VITE_TRANSIT_URL=` (empty), and the UI then says so.
Every itinerary is an option; each starts at its timetabled time; a departure
change re-plans; no "when to leave" comparison.

## Conditions (owner actions)
1. Make the repository open source (licence) or stop using Transitous (Open question #2).
2. Contact Transitous about routing use before public beta.
3. No ads/subscriptions while Transitous is used.

## Alternatives
- Google/HERE/Navitia transit APIs need keys and payment; possible paid
  replacements if commercial — recorded here for that decision.
- Self-hosted MOTIS with the same GTFS feeds (Tbilisi feed is published) — the
  Growth option if Transitous' terms can't be met.
