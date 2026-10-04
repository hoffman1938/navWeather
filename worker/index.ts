import { API_VERSION, normalizeApiPath } from '../src/api/v1';
import { MAX_BODY_BYTES, sanitizeCreate, SHARE_ID_RE } from '../src/share/protocol';
import { REPORT_ID_RE } from '../src/reports/protocol';
import { json, randomToken, readJson, sha256Hex } from './http';
import { LiveShare } from './liveShare';
import { Reports } from './reports';
import { tripBorders, tripPlaces, tripPlan, type TripEnv } from './trips';
import { geocode, type GeocodeEnv } from './geocode';
import { route, routeMatrix, type RouteEnv } from './route';

export { LiveShare, Reports };

export interface Env extends TripEnv, GeocodeEnv, RouteEnv {
  ASSETS: Fetcher;
  LIVE_SHARE: DurableObjectNamespace<LiveShare>;
  /** Workers rate-limiting binding (wrangler.toml [[ratelimits]]); optional so the relay still runs without it. */
  CREATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** Driver reports (one SQLite Durable Object). */
  REPORTS: DurableObjectNamespace<Reports>;
  /** Abuse guard for reporting and voting (per client IP). */
  REPORT_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** Abuse guard for listing reports (per client IP; generous — a long route asks for several boxes). */
  REPORT_LIST_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

/**
 * navWeather on Cloudflare: static app (assets) + the live-location relay.
 *
 * Every route is served under /api/v1/… (the versioned API for web and future
 * mobile clients, docs/api/API_V1.md) and, for clients from before versioning,
 * under the unversioned /api/… as well. Paths below are shown unversioned.
 *
 *   GET    /api/health             { ok, api } — liveness for uptime checks (no storage touched)
 *
 *   POST   /api/share              create a share → { id, key, expiresAt }
 *   GET    /api/share/:id          latest snapshot (viewers; polling fallback)
 *   GET    /api/share/:id/ws       WebSocket stream of snapshots (viewers)
 *   PUT    /api/share/:id          position update   (Authorization: Bearer key)
 *   DELETE /api/share/:id          stop sharing      (Authorization: Bearer key)
 *
 *   GET    /api/reports?bbox=w,s,e,n       active driver reports in an area
 *   POST   /api/reports                    report { kind, lat, lon }
 *   POST   /api/reports/:id/vote           { vote: 'still' | 'gone' }
 *
 *   GET    /api/whereami           approximate location of the connection (city level)
 *   GET    /api/geocode?q=…        search and suggestions from our index (D1 FTS5; worker/geocode.ts)
 *   POST   /api/route              our routing engine (Valhalla; OSRM-format answer; worker/route.ts)
 *   POST   /api/route/matrix       travel times between points (detours)
 *
 *   POST   /api/trips/plan         long-trip plan for a route (stateless; worker/trips.ts)
 *   POST   /api/trips/places       places around one planned stop (Overpass, edge-cached)
 *   POST   /api/trips/borders      countries along the route and where they change (Overpass, edge-cached)
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = normalizeApiPath(url.pathname);
    if (path === null) return env.ASSETS.fetch(request);
    if (path === 'unsupported') return json({ error: 'unsupported-api-version', supported: [API_VERSION] }, 404);

    // CSRF: browsers label cross-site requests; only same-origin pages may write.
    const site = request.headers.get('Sec-Fetch-Site');
    if (request.method !== 'GET' && site && site !== 'same-origin' && site !== 'none') return json({ error: 'forbidden' }, 403);

    if (path === '/api/health') return request.method === 'GET' ? json({ ok: true, api: API_VERSION }) : json({ error: 'method-not-allowed' }, 405);

    if (path === '/api/reports' || path.startsWith('/api/reports/')) return reports(request, path, url, env);

    if (path === '/api/geocode') return geocode(request, url, env);
    if (path === '/api/route') return route(request, env);
    if (path === '/api/route/matrix') return routeMatrix(request, env);

    if (path === '/api/trips/plan') return tripPlan(request, env);
    if (path === '/api/trips/places') return tripPlaces(request, env);
    if (path === '/api/trips/borders') return tripBorders(request, env);

    // When the device can't say where it is (location off, no GPS on a desktop), a trip can
    // still start from the right city: Cloudflare already knows the connection's rough area.
    // Nothing is stored; no CORS headers, so other sites can't read it.
    if (path === '/api/whereami') {
      if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
      const cf = request.cf as { latitude?: string; longitude?: string; city?: string; country?: string; asn?: number; clientTcpRtt?: number } | undefined;
      const lat = Number(cf?.latitude);
      const lon = Number(cf?.longitude);
      // `wrangler dev` offline fills in a made-up Austin, TX (asn 395747, no round trip): not a location.
      const placeholder = cf?.city === 'Austin' && cf.asn === 395747 && !cf.clientTcpRtt;
      if (!cf?.latitude || !cf?.longitude || !Number.isFinite(lat) || !Number.isFinite(lon) || placeholder) return json({ error: 'unknown' }, 404);
      return json({ lat, lon, city: cf.city ?? null, country: cf.country ?? null });
    }

    if (path === '/api/share') {
      if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
      // JSON only: cross-site pages would need a CORS preflight, which this API never grants.
      if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'unsupported-media-type' }, 415);
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      if (env.CREATE_LIMITER && !(await env.CREATE_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
      const body = await readJson(request, 2_000);
      const opts = body === undefined ? null : sanitizeCreate(body, Date.now());
      if (!opts) return json({ error: 'bad-request' }, 400);
      const id = randomToken(16); // 128-bit capability; 22 chars
      const key = randomToken(32); // sharer secret; only its hash is stored
      const stub = env.LIVE_SHARE.get(env.LIVE_SHARE.idFromName(id));
      const res = await stub.fetch('https://live-share/init', {
        method: 'POST',
        body: JSON.stringify({ keyHash: await sha256Hex(key), startedAt: Date.now(), expiresAt: opts.expiresAt, name: opts.name }),
      });
      if (!res.ok) return json({ error: 'unavailable' }, 503);
      return json({ id, key, expiresAt: opts.expiresAt }, 201);
    }

    const m = /^\/api\/share\/([^/]+)(\/ws)?$/.exec(path);
    if (!m || !SHARE_ID_RE.test(m[1])) return json({ error: 'not-found' }, 404);
    if (!m[2] && request.method === 'PUT' && Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
      return json({ error: 'too-large' }, 413);
    }
    const stub = env.LIVE_SHARE.get(env.LIVE_SHARE.idFromName(m[1]));
    return stub.fetch(new Request(`https://live-share${m[2] ? '/ws' : '/'}`, request));
  },
} satisfies ExportedHandler<Env>;

async function reports(request: Request, path: string, url: URL, env: Env): Promise<Response> {
  const stub = env.REPORTS.get(env.REPORTS.idFromName('global'));
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (path === '/api/reports' && request.method === 'GET') {
    // Every list request reaches the one Reports object: keep a single client from monopolising it.
    if (env.REPORT_LIST_LIMITER && !(await env.REPORT_LIST_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
    return stub.fetch(`https://reports/list?bbox=${encodeURIComponent(url.searchParams.get('bbox') ?? '')}`);
  }
  const vote = /^\/api\/reports\/([^/]+)\/vote$/.exec(path);
  const create = path === '/api/reports';
  if (request.method !== 'POST' || (!create && !vote)) return json({ error: create ? 'method-not-allowed' : 'not-found' }, create ? 405 : 404);
  if (vote && !REPORT_ID_RE.test(vote[1])) return json({ error: 'not-found' }, 404);
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'unsupported-media-type' }, 415);
  if (env.REPORT_LIMITER && !(await env.REPORT_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  // The client IP only reaches the object, which keeps a salted hash of it.
  return stub.fetch(`https://reports/${create ? 'create' : `vote/${vote![1]}`}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-ip': ip, ...(request.headers.get('content-length') ? { 'content-length': request.headers.get('content-length')! } : {}) },
    body: request.body,
  });
}
