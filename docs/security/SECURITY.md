# Security architecture

> **Update 2026-10-04 ([ADR-016](../architecture/decisions/ADR-016-all-on-cloudflare-workers.md)):** provider calls move
> behind our Worker (no client-direct third parties); WAF/zone rules become available with the custom domain (DP-12.1);
> new surfaces to model — Cloudflare Containers (Valhalla, MOTIS, LibreWXR) and the moderation admin (DP-7.3); review
> in DP-11.9.

Scope: the web app, the Worker API, Durable Objects, provider calls, and the
planned accounts. Requirements: PROJECT_REQUIREMENTS §13 (REQ-SEC-*).

## 1. Assets and threats

| Asset | Threat | Control (status) |
| --- | --- | --- |
| A sharer's live position | link guessing; key theft; stale data left behind | 128-bit capability id, 256-bit key stored as SHA-256 (IMPLEMENTED); constant-time compare; only latest position kept; deleted on stop/expiry by alarm (IMPLEMENTED) |
| Report system integrity | spam, floods, fake reports, vote stuffing | per-IP rate limits (10/min write, 120/min list), 30/day per reporter hash, own-vote and double-vote refused, auto-expiry, "reported" label (IMPLEMENTED); Turnstile on report creation if abused (PLANNED) |
| Worker / DO availability | request floods, oversized bodies, slow bodies | Cloudflare DDoS (platform), rate limits, streamed body caps (48 KB share, 300 B report), WebSocket viewer cap (IMPLEMENTED); zone WAF rules (PLANNED, needs custom domain) |
| Users' browsers | XSS, clickjacking, malicious tiles/styles | CSP `default-src 'none'`, `script-src 'self'`, `frame-ancestors 'none'`, no inline scripts; names sanitised (control/bidi chars stripped); React escaping (IMPLEMENTED) |
| Cross-site writes | CSRF | `Sec-Fetch-Site` check on non-GET; JSON-only writes force a CORS preflight that is never granted (IMPLEMENTED) |
| Secrets | API keys in the bundle | no secrets exist today; rule: `VITE_*` = public, server secrets (e.g. Web Push keys, admin credentials) only as Worker secrets (IMPLEMENTED as policy) |
| Accounts (planned) | credential stuffing, brute force, session theft | passkeys (no passwords), email codes single-use 15 min with attempt cap, Turnstile, per-email-hash + per-IP limits, HttpOnly/Secure/SameSite cookies, refresh rotation with reuse detection (PLANNED) |
| Our engines and hosting bill | scraping our routing/geocoding/places APIs, request floods | per-client rate limits on every endpoint, caching of identical requests, spend alerts (PLANNED, DP-3.4, DP-5.1) |
| Location privacy | logs/analytics leaking coordinates | observability off; rule REQ-PRIV-004 for when it's on (PLANNED) |

## 2. Authentication & authorisation (planned, ADR-008)
- Opaque random tokens (≥128 bit), stored hashed; no JWT.
- Web: session cookie `__Host-nw_session; HttpOnly; Secure; SameSite=Lax; Path=/`.
- Mobile: `Authorization: Bearer` access token (15 min) + refresh token
  (90 days, rotated on each use; reuse of an old one revokes the family and
  records `refresh-reuse`).
- Authorisation is ownership: every query on user data filters by the
  session's `user_id`; IDs are random, never sequential.
- Account deletion revokes all sessions immediately.

## 3. Input validation
All request bodies are validated by shared, unit-tested sanitizers
(`sanitizeCreate`, `sanitizeUpdate`, `sanitizeReport`, `sanitizeVote`,
`parseBbox`): ranges for coordinates, sizes for arrays/strings, clock-skew
limits, monotonic timestamps. SQL in Durable Objects uses bound parameters
only (`sql.exec(query, ...params)`); the D1 schema adds CHECK constraints.

## 4. Abuse specific to navigation
- **GPS spoofing:** a client can lie about its position. Impact today is
  limited to (a) its own navigation, (b) a fake live-share position (the
  sharer's own link), (c) a fake report at a fake place → mitigated by rate
  limits, expiry, "still there?" voting, and the "reported" label. A report is
  never treated as fact.
- **Malicious route requests:** our routing endpoint (`/api/v1/route`, DP-5.2) validates point count
  (≤5), coordinate ranges, total span, and rate-limits per client; responses
  for identical requests are cached briefly.
- **Map-tile/style injection:** styles come only from configured HTTPS hosts
  listed in CSP `connect-src`; no user-supplied style URLs.

## 5. Cloudflare protections
| Protection | Plan / cost | Use |
| --- | --- | --- |
| DDoS mitigation | included | always on |
| Workers rate-limiting binding | available (used) | per-IP keys today; docs advise stable user keys where possible — switch to user/session ids with accounts |
| WAF managed rules / custom rules / zone rate limiting | zone plan dependent — **REQUIRES VERIFICATION** of what Free includes | public beta |
| Turnstile | Free: up to 20 widgets, unlimited challenges | accounts, report abuse |
| Bot Management | Enterprise | not needed |

## 6. Supply chain
- `package-lock.json` committed; CI uses `npm ci`.
- Dependabot weekly for npm and GitHub Actions (`.github/dependabot.yml`).
- Third-party runtime code is limited to React, zustand, MapLibre; no
  analytics or ad SDKs.

## 7. Incident response (minimum)
1. Detect: uptime alert / error spike / provider complaint.
2. Contain: disable the feature by config (e.g. `VITE_INCIDENT_PROVIDER=none`,
   `VITE_TRANSIT_URL=`), roll back with `wrangler rollback` (previous version).
3. Rotate any affected secret (`wrangler secret put`).
4. Notify affected users and authorities when personal data is involved
   (GDPR Art. 33: 72 hours to the supervisory authority — legal review).
5. Write a post-incident note in `docs/operations/` and add a test.
