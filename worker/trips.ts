import { createTripPlan, findStopPlaces, TripPlanError } from '../src/trip/planning/planner';
import { MAX_STOP_PLACES_BODY_BYTES, MAX_TRIP_BODY_BYTES, sanitizeStopPlacesRequest, sanitizeTripRequest } from '../src/trip/protocol';
import { OverpassTripPlaces, type RawPlace } from '../src/trip/stops/places';
import { TileTripPlaces } from '../src/trip/stops/tilePlaces';
import { PlacesTiles } from '../src/services/places/tiles';
import { crossingsFrom, sanitizeBordersRequest, type BordersResponse } from '../src/trip/borders';
import { countryAt, decodeCountries, type CountriesFile, type CountryIndex } from '../src/trip/countries';
import countriesFile from '../src/trip/data/countries-v1.json';
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
 *   POST /api/v1/trips/borders points along the route → the country of each and where it changes (Natural Earth
 *                              boundaries bundled with the Worker — no third party, no cache needed).
 */

export interface TripEnv {
  /** The app's static assets — our places tiles live under /data/places/v1 (built by `npm run data:osm`). */
  ASSETS?: Fetcher;
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

let tiles: PlacesTiles | null = null;

/** Our places tiles read through the static-assets binding (one instance per isolate, tiles kept in memory). */
function placesTiles(assets: Fetcher): PlacesTiles {
  tiles ??= new PlacesTiles('/data/places/v1', 200, async <T>(path: string): Promise<T | null> => {
    const res = await assets.fetch(new Request(`https://assets.internal${path}`));
    // A missing file is the SPA's index.html (not_found_handling): only JSON counts.
    return res.ok && (res.headers.get('content-type') ?? '').includes('json') ? ((await res.json()) as T) : null;
  });
  return tiles;
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
    const overpass = new OverpassTripPlaces(endpoints.length ? endpoints : DEFAULT_OVERPASS, env.TRIP_USER_AGENT ?? 'navWeather/0.1 (trip planner; Cloudflare Worker)', {
      timeoutMs: 12_000,
      cache: edgeCache(),
    });
    // Our tiles from the static assets (free, no cache needed); Overpass only outside the region they cover.
    const source = env.ASSETS ? new TileTripPlaces(placesTiles(env.ASSETS), overpass) : overpass;
    return json({ places: await findStopPlaces(req, source, ctrl.signal) });
  } finally {
    clearTimeout(timer);
  }
}

let countries: CountryIndex | null = null;

/** Countries of points along a route and where they change — from Natural Earth boundaries bundled with the Worker (DP-4.5). */
export async function tripBorders(request: Request, env: TripEnv): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'unsupported-media-type' }, 415);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.TRIP_LIMITER && !(await env.TRIP_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  const body = await readJson(request, 8_000);
  const req = body === undefined ? null : sanitizeBordersRequest(body);
  if (!req) return json({ error: 'bad-request' }, 400);
  countries ??= decodeCountries(countriesFile as CountriesFile);
  const found = req.points.map((p) => countryAt(countries!, p, req.locale));
  const out: BordersResponse = { countries: found, crossings: crossingsFrom(found, req.alongM) };
  return json(out);
}
