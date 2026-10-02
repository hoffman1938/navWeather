# ADR-008 — Identity: anonymous first; optional passkey / email account

**Status:** Accepted (not built) · **Date:** 2026-10-02 · Facts verified 2026-10-02

## Context
Nothing in the product needs an account today. Accounts become useful to sync
saved places and settings across web, iOS and Android, and later for paid
features. Platform rules once accounts exist:
- Apple 5.1.1(v): "If your app supports account creation, you must also offer
  account deletion within the app"; delete "the entire account record, along
  with associated personal data"; Sign in with Apple tokens revoked via REST API.
- Apple 4.8: apps using a third-party login (Google, Facebook…) for the
  primary account "must also offer as an equivalent option another login
  service" with privacy features; **not required** if the app "exclusively
  uses your company's own account setup and sign-in systems".
- Google Play: in-app deletion path **and** a web link where users can request
  deletion after uninstalling.

## Options
1. Email + password.
2. Email magic link.
3. Passkeys (WebAuthn).
4. OAuth: Sign in with Apple + Google.
5. Third-party identity service (Auth0, Clerk, Firebase Auth…).

## Decision
- **Anonymous by default** for everything that works today (REQ-AUTH-001).
- **Optional account = passkeys first, email magic link as fallback/recovery.**
  Own system → Apple 4.8 does not force Sign in with Apple.
- Add **Sign in with Apple and Google together** only if demand appears.
- Sessions: opaque random tokens; only their SHA-256 stored in D1 (`sessions`).
  Web: `HttpOnly; Secure; SameSite=Lax` cookie + same-origin check (existing
  `Sec-Fetch-Site` rule). Mobile: `Authorization: Bearer` short-lived access
  token + rotating refresh token (reuse detection revokes the family), stored
  in Keychain / Android Keystore.
- Turnstile on email-link requests and account creation; rate limits per
  email hash and per IP.
- Account deletion: immediate hard delete of user rows (cascade), revoke
  sessions and Apple tokens if used, keep one audit event without PII.

## Reason
Passkeys remove passwords (no credential stuffing, no reset flow), work on
web, iOS and Android, and need no third party. Magic links cover devices
without passkey support. Opaque tokens are revocable by deleting a row —
simpler and safer than JWTs for a single backend.

## Consequences
- D1 tables: `users`, `auth_identities`, `passkey_credentials`,
  `email_challenges`, `sessions`, `audit_events` (DATA_MODEL).
- Transactional email needs a provider: Cloudflare Email Routing/Workers can
  send only to verified addresses — **REQUIRES VERIFICATION** of current
  Cloudflare email-sending options; otherwise an external email API (decision
  then recorded as its own ADR).
- No account → nothing to delete: the anonymous path stays the default.

## Alternatives rejected
- **Passwords:** stuffing/brute-force exposure, reset flows, storage risk.
- **Hosted identity SaaS:** data processor + cost + lock-in for a small feature.
- **JWT access tokens everywhere:** revocation complexity, no benefit here.
