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

/**
 * Where the API is: '' = the page's own origin (the web app on the Worker); an absolute origin for clients served
 * from elsewhere (a native shell, a dev server on another host). Set once from the client's config
 * (`VITE_API_ORIGIN`, DEVELOPMENT_PLAN DP-2.3).
 */
let origin = '';
export function setApiOrigin(value: string): void {
  origin = value.replace(/\/+$/, '');
}
export const apiOrigin = (): string => origin;

/** URLs the clients call. */
export const apiPaths = {
  get share() {
    return `${origin}${API_BASE}/share`;
  },
  shareItem: (id: string) => `${origin}${API_BASE}/share/${encodeURIComponent(id)}`,
  /** Path only: the WebSocket URL needs a ws(s) origin (see `share/viewer.ts`). */
  shareSocket: (id: string) => `${API_BASE}/share/${encodeURIComponent(id)}/ws`,
  get reports() {
    return `${origin}${API_BASE}/reports`;
  },
  get whereami() {
    return `${origin}${API_BASE}/whereami`;
  },
  get health() {
    return `${origin}${API_BASE}/health`;
  },
  get tripsPlan() {
    return `${origin}${API_BASE}/trips/plan`;
  },
  get tripsPlaces() {
    return `${origin}${API_BASE}/trips/places`;
  },
  get tripsBorders() {
    return `${origin}${API_BASE}/trips/borders`;
  },
};

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
