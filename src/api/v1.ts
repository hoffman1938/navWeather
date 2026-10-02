/**
 * The app's own HTTP API, versioned for every client — the web app today,
 * iOS/Android later (docs/api/API_V1.md, ADR-009). Shared by the Worker
 * (routing) and the web client (paths), like the share/reports protocols.
 *
 * Rules: a published version never changes incompatibly; new fields are
 * additive; a breaking change is a new version (`/api/v2/…`) served next to
 * the old one until clients have moved.
 */
export const API_VERSION = 1;
export const API_BASE = '/api/v1';

/** Paths the web client calls (same origin). */
export const apiPaths = {
  share: `${API_BASE}/share`,
  shareItem: (id: string) => `${API_BASE}/share/${encodeURIComponent(id)}`,
  shareSocket: (id: string) => `${API_BASE}/share/${encodeURIComponent(id)}/ws`,
  reports: `${API_BASE}/reports`,
  whereami: `${API_BASE}/whereami`,
  health: `${API_BASE}/health`,
} as const;

/**
 * The Worker's internal route for a request path. `/api/v1/…` and the
 * original unversioned `/api/…` (app shells cached before versioning, smoke
 * scripts) map to the same route, `/api/…`. Returns `'unsupported'` for an
 * API version this Worker doesn't serve, and null for anything that isn't the
 * API (static assets).
 */
export function normalizeApiPath(pathname: string): string | 'unsupported' | null {
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return null;
  const versioned = /^\/api\/v(\d+)(\/.*)?$/.exec(pathname);
  if (!versioned) return pathname;
  if (Number(versioned[1]) !== API_VERSION) return 'unsupported';
  return `/api${versioned[2] ?? '/'}`;
}
