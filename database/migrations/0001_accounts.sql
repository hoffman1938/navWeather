-- navWeather D1 schema — optional accounts (Phase 3).
--
-- STATUS: PROPOSED — NOT APPLIED. There is no D1 binding in wrangler.toml yet.
-- Design and justification: docs/database/DATA_MODEL.md, ADR-007, ADR-008.
-- To adopt: create the database (`wrangler d1 create navweather`), add a
-- [[d1_databases]] binding with migrations_dir = "database/migrations", then
-- `wrangler d1 migrations apply navweather`.
--
-- Rules: no positions, routes or trip history; tokens and codes stored only as
-- SHA-256 hashes; all times are UTC epoch milliseconds (INTEGER).

-- D1 enforces foreign keys by default; local sqlite3 tests need `PRAGMA foreign_keys = ON`.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,                -- random 128-bit, base64url
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  display_name  TEXT CHECK (display_name IS NULL OR length(display_name) <= 60),
  locale        TEXT NOT NULL DEFAULT 'en' CHECK (length(locale) <= 10)
);

-- One user, several ways to sign in. provider_subject: normalised email
-- (lower-case) for 'email', credential-independent user handle for 'passkey',
-- the provider's stable subject for 'apple'/'google' (future).
CREATE TABLE auth_identities (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('email', 'passkey', 'apple', 'google')),
  provider_subject  TEXT NOT NULL,
  verified_at       INTEGER,
  created_at        INTEGER NOT NULL,
  UNIQUE (provider, provider_subject)
);
CREATE INDEX auth_identities_user ON auth_identities(user_id);

CREATE TABLE passkey_credentials (
  credential_id  TEXT PRIMARY KEY,               -- base64url WebAuthn credential id
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key     BLOB NOT NULL,                  -- COSE public key
  sign_count     INTEGER NOT NULL DEFAULT 0,
  transports     TEXT,                           -- comma-separated hints
  name           TEXT CHECK (name IS NULL OR length(name) <= 60),
  created_at     INTEGER NOT NULL,
  last_used_at   INTEGER
);
CREATE INDEX passkey_credentials_user ON passkey_credentials(user_id);

-- Single-use login codes / magic links. Strongly consistent single use is the
-- reason this is in D1, not KV.
CREATE TABLE email_challenges (
  id            TEXT PRIMARY KEY,
  email_hash    TEXT NOT NULL,                   -- SHA-256 of the normalised email
  code_hash     TEXT NOT NULL,                   -- SHA-256 of the code/token
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER,
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts <= 10)
);
CREATE INDEX email_challenges_email ON email_challenges(email_hash, created_at);
CREATE INDEX email_challenges_expires ON email_challenges(expires_at);

-- Sessions: web cookie sessions and mobile refresh-token families.
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,          -- SHA-256 of the session / refresh token
  family_id       TEXT NOT NULL,                 -- refresh rotation family (reuse ⇒ revoke family)
  client          TEXT NOT NULL CHECK (client IN ('web', 'ios', 'android')),
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  revoked_at      INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_family ON sessions(family_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

-- Synced preferences as one versioned JSON document (shape evolves without migrations).
CREATE TABLE user_settings (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL DEFAULT 1,
  settings    TEXT NOT NULL CHECK (json_valid(settings) AND length(settings) <= 16000),
  updated_at  INTEGER NOT NULL
);

-- Saved places the user created. Tombstones (deleted_at) let devices merge offline edits.
CREATE TABLE saved_places (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('home', 'work', 'favorite')),
  name        TEXT NOT NULL CHECK (length(name) <= 120),
  label       TEXT CHECK (label IS NULL OR length(label) <= 240),
  lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon         REAL NOT NULL CHECK (lon BETWEEN -180 AND 180),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX saved_places_user ON saved_places(user_id, updated_at);
-- At most one Home and one Work per user (favourites unlimited, app caps them).
CREATE UNIQUE INDEX saved_places_one_home_work ON saved_places(user_id, kind)
  WHERE kind IN ('home', 'work') AND deleted_at IS NULL;

-- Security events only. No IP addresses, no coordinates. 90-day retention.
CREATE TABLE audit_events (
  id           TEXT PRIMARY KEY,
  user_ref     TEXT NOT NULL,                    -- user id, or salted hash after account deletion
  type         TEXT NOT NULL CHECK (type IN ('account-created', 'sign-in', 'sign-in-failed',
                 'passkey-added', 'passkey-removed', 'session-revoked', 'refresh-reuse', 'account-deleted')),
  client       TEXT CHECK (client IS NULL OR client IN ('web', 'ios', 'android')),
  created_at   INTEGER NOT NULL
);
CREATE INDEX audit_events_user ON audit_events(user_ref, created_at);
CREATE INDEX audit_events_created ON audit_events(created_at);
