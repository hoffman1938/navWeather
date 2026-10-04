# ADR-007 — Storage: no server DB for MVP; D1 with accounts; Durable Objects for real time; KV narrowly

**Status:** Accepted · **Date:** 2026-10-02 · Facts verified 2026-10-02

## Context
Today the server stores only: live shares (one SQLite DO per link: latest
position, route once, expiry) and driver reports (one SQLite DO: reports and
votes with daily-salted reporter hashes, hourly expiry). Preferences, saved
places and recents are in the browser (localStorage). No accounts.

## Decision

| Data | Store | Why |
| --- | --- | --- |
| Preferences, saved places, recents (anonymous) | device only | privacy; no server needed |
| Accounts, auth identities, passkeys, sessions, synced settings, synced saved places, security events | **D1** (when accounts ship) | relational, strongly consistent per DB, cheap (Free: 5M rows read/day, 100k written/day, 500 MB/DB) |
| Live share state, WebSocket fan-out | **Durable Object** per share | single-writer coordination, hibernating WebSockets |
| Driver reports | **Durable Object** (shard by region later) | one coordinated writer per area, SQLite inside |
| Weather/geocode response cache | **Cache API** (per data centre) + **KV** for hot shared cells | KV is eventually consistent, 1 write/s per key — fine for a cache, wrong for records |
| Feature flags / remote config | KV (or `wrangler.toml` vars until needed) | read-heavy, rarely written |
| Map tile archives, exports, backups | **R2** (only when needed) | object storage, free egress |
| Routes, positions, trip history | **nowhere** on the server | REQ-PRIV-001 |

## Reason
D1 is a SQLite database per binding, "inherently single-threaded"
(≈1,000 queries/s at 1 ms each), 500 MB (Free) / 10 GB (Paid) per database,
Time Travel 7/30 days. That suits account data at this product's scale; a
global per-user table stays small because we store no trips. Real-time and
per-link state belongs in Durable Objects (soft limit 1,000 req/s per object).

## Consequences
- Migrations live in `database/migrations/` (first one proposed, not applied).
- If one D1 database ever becomes a bottleneck, shard by user id (D1 allows
  many databases per account on Paid) — not before measured need.
- Weather cache never goes into D1 (row writes cost; no TTL).

## Alternatives rejected
- **KV as a user database:** eventually consistent, no queries, 1 write/s/key.
- **External Postgres (Supabase/Neon) now:** unjustified for this data volume;
  Hyperdrive would be the Cloudflare path if ever needed.
