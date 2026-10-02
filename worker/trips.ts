import { createTripPlan, findStopPlaces, TripPlanError } from '../src/trip/planning/planner';
import { MAX_STOP_PLACES_BODY_BYTES, MAX_TRIP_BODY_BYTES, sanitizeStopPlacesRequest, sanitizeTripRequest } from '../src/trip/protocol';
import { OverpassTripPlaces, type RawPlace } from '../src/trip/stops/places';
import { bordersQuery, crossingsFrom, parseBorders, sanitizeBordersRequest, type BordersResponse } from '../src/trip/borders';
import { json, readJson } from './http';

/**
 * The long-trip planner (ADR-013). Stateless: requests are validated,
 * answered and discarded; nothing is stored or logged.
 *
 *   POST /api/v1/trips/plan    route + departure + vehicle + preferences (+ the client's forecasts and
 *                              settlements) → TripPlan. Fast: no place lookups (overnight areas are chosen
 *                              from settlements), so a plan never waits for Overpass.
 *   POST /api/v1/trips/places  one stop → ranked OpenStreetMap places around it, from Overpass (identifying
 *                              User-Agent), cached at the edge by area for a day. Called when a stop is opened.
 *   POST /api/v1/trips/borders points along the route → the country of each and where it changes (one
 *                              Overpass `is_in` query, cached at the edge for a week).
 */

export interface TripEnv {
  /** Abuse guard for planning (per client IP). */
  TRIP_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** Comma-separated Overpass endpoints (defaults: overpass-api.de, kumi.systems). */
  OVERPASS_URLS?: string;
  /** User-Agent sent to Overpass; should name the app and a contact. */
  TRIP_USER_AGENT?: string;
}

const DEFAULT_OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const PLACES_BUDGET_MS = 20_000;
const PLACES_TTL_S = 24 * 3600;

/** Places cached per area for a day, in this data centre (Cache API; absent in some runtimes). */
function edgeCache(): { get(key: string): Promise<RawPlace[] | null>; put(key: string, value: RawPlace[]): Promise<void> } | undefined {
  if (typeof caches === 'undefined' || !('default' in caches)) return undefined;
  const cache = (caches as unknown as { default: Cache }).default;
  const url = (key: string) => `https://trip-places.navweather.internal/${encodeURIComponent(key)}`;
  return {
    async get(key) {
      const hit = await cache.match(url(key));
      return hit ? ((await hit.json()) as RawPlace[]) : null;
    },
    async put(key, value) {
      await cache.put(url(key), new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${PLACES_TTL_S}` } }));
    },
  };
}

export async function tripPlan(request: Request, env: TripEnv): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'unsupported-media-type' }, 415);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.TRIP_LIMITER && !(await env.TRIP_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  if (Number(request.headers.get('content-length') ?? '0') > MAX_TRIP_BODY_BYTES) return json({ error: 'too-large' }, 413);
  const body = await readJson(request, MAX_TRIP_BODY_BYTES);
  const now = Date.now();
  const req = body === undefined ? null : sanitizeTripRequest(body, now);
  if (!req) return json({ error: 'bad-request' }, 400);

  try {
    return json(await createTripPlan(req, { places: null, nowMs: now }));
  } catch (e) {
    if (e instanceof TripPlanError) return json({ error: 'bad-route' }, 400);
    return json({ error: 'unavailable' }, 503);
  }
}

export async function tripPlaces(request: Request, env: TripEnv): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'unsupported-media-type' }, 415);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.TRIP_LIMITER && !(await env.TRIP_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  const body = await readJson(request, MAX_STOP_PLACES_BODY_BYTES);
  const req = body === undefined ? null : sanitizeStopPlacesRequest(body, Date.now());
  if (!req) return json({ error: 'bad-request' }, 400);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PLACES_BUDGET_MS);
  try {
    const endpoints = (env.OVERPASS_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const source = new OverpassTripPlaces(endpoints.length ? endpoints : DEFAULT_OVERPASS, env.TRIP_USER_AGENT ?? 'navWeather/0.1 (trip planner; Cloudflare Worker)', {
      timeoutMs: 12_000,
      cache: edgeCache(),
    });
    return json({ places: await findStopPlaces(req, source, ctrl.signal) });
  } finally {
    clearTimeout(timer);
  }
}

const BORDERS_TTL_S = 7 * 24 * 3600;

export async function tripBorders(request: Request, env: TripEnv): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'unsupported-media-type' }, 415);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.TRIP_LIMITER && !(await env.TRIP_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  const body = await readJson(request, 8_000);
  const req = body === undefined ? null : sanitizeBordersRequest(body);
  if (!req) return json({ error: 'bad-request' }, 400);

  // Countries don't move: cache by the rounded points for a week.
  const key = `https://trip-borders.navweather.internal/v1/${req.locale}/${req.points.map(([lo, la]) => `${lo.toFixed(2)},${la.toFixed(2)}`).join(';')}`;
  const cache = typeof caches !== 'undefined' && 'default' in caches ? (caches as unknown as { default: Cache }).default : null;
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return json(await hit.json());

  const endpoints = (env.OVERPASS_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const body2 = `data=${encodeURIComponent(bordersQuery(req.points))}`;
  for (const endpoint of endpoints.length ? endpoints : DEFAULT_OVERPASS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': env.TRIP_USER_AGENT ?? 'navWeather/0.1 (trip planner; Cloudflare Worker)', accept: 'application/json' },
        body: body2,
        signal: ctrl.signal,
      });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) continue;
      const countries = parseBorders((await res.json()) as { elements?: { type: string; tags?: Record<string, string> }[] }, req.points.length, req.locale);
      const out: BordersResponse = { countries, crossings: crossingsFrom(countries, req.alongM) };
      // Only remember answers that found countries (an overloaded server can answer with nothing).
      if (countries.some(Boolean)) {
        await cache?.put(key, new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${BORDERS_TTL_S}` } })).catch(() => undefined);
      }
      return json(out);
    } catch {
      /* next endpoint */
    } finally {
      clearTimeout(timer);
    }
  }
  return json({ error: 'unavailable' }, 503);
}
