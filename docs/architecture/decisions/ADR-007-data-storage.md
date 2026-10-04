# ADR-007 — Storage: device first; D1 per region for places, geocoder and accounts; Durable Objects for real time; R2 for files

**Status:** Accepted · **Date:** 2026-10-02 · **Revised:** 2026-10-04 (aligned with ADR-016; history in git)

## Context
Today the server stores only live shares (one SQLite Durable Object per link: latest position, route once, expiry) and
driver reports (one SQLite Durable Object: reports and votes with daily-salted reporter hashes, hourly expiry).
Preferences, saved places and recents are in the browser. ADR-016 adds own places data, a geocoder index, weather cells,
tiles and optional accounts — all on Cloudflare.

## Decision

| Data | Store | Why |
| --- | --- | --- |
| Preferences, saved places, recents (anonymous) | device only | privacy; no server needed |
| Places index and FTS5 geocoder index | **D1**, one database per region/country (≤10 GB each) | relational queries and full-text search; 50,000 databases per account |
| Places tiles, map PMTiles, weather cells, terrain, imagery, data snapshots | **R2** | object storage, free egress, range requests |
| Accounts, auth identities, passkeys, sessions, synced settings, saved places and lists, security events | **D1** (when accounts ship) | relational, strongly consistent per database |
| Live share state, WebSocket fan-out | **Durable Object** per share | single-writer coordination, hibernating WebSockets |
| Driver reports, traffic aggregates | **Durable Objects**, sharded by region (geohash) | one coordinated writer per area, SQLite inside |
| Response caching (tiles, places, weather) | **Cache API** on the custom domain | per data centre; no effect on `*.workers.dev` |
| Routes, positions, trip history | **nowhere** on the server | REQ-PRIV-001 |

## Reason
D1 is a SQLite database per binding (single-threaded; ≈1,000 queries/s at 1 ms each), so data is split by region; R2
holds large immutable files cheaply; Durable Objects give one writer per share or area.

## Consequences
- Migrations live in `database/migrations/` (accounts migration proposed, not applied).
- Regional databases are rebuilt by the data pipelines and swapped atomically (new database → switch binding).
- Weather data never goes into D1 (cells are files in R2).

## Alternatives rejected
- **KV as a database or weather cache:** eventually consistent, 1 write/s per key, small free write quota.
- **PostGIS in a container:** container disk is ephemeral; data would be lost when an instance sleeps.
- **External Postgres:** another provider and bill; not needed for this data.
