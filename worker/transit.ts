import { json } from './http';

/**
 * GET /api/v1/transit/plan — public transport from our MOTIS (DEVELOPMENT_PLAN DP-5.3): the region's open timetables
 * (`npm run data:transit`), engine in Docker on localhost (`npm run engines:up` → MOTIS_URL) and in Cloudflare
 * Containers later. The query is MOTIS `plan` (as the app sends it to Transitous), checked and passed on; the answer
 * is MOTIS's. A trip with an end outside `TRANSIT_BBOX` (the timetables' region) is `422 outside-region`: the app asks
 * Transitous then. 503 without an engine. Nothing stored or logged.
 */

export interface TransitEnv {
  MOTIS_URL?: string;
  /** "w,s,e,n" — where our timetables are. */
  TRANSIT_BBOX?: string;
  TRANSIT_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const PLACE = /^(-?\d{1,2}(\.\d+)?),(-?\d{1,3}(\.\d+)?)$/;

export function parsePlace(v: string | null): [number, number] | null {
  const m = v ? PLACE.exec(v) : null;
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[3]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? [lat, lon] : null;
}

export async function transitPlan(request: Request, url: URL, env: TransitEnv): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.TRANSIT_LIMITER && !(await env.TRANSIT_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  const p = url.searchParams;
  const from = parsePlace(p.get('fromPlace'));
  const to = parsePlace(p.get('toPlace'));
  const time = p.get('time');
  const n = Number(p.get('numItineraries') ?? '1');
  if (!from || !to || (time !== null && Number.isNaN(Date.parse(time))) || !Number.isInteger(n) || n < 1 || n > 8) {
    return json({ error: 'bad-request' }, 400);
  }
  const box = (env.TRANSIT_BBOX ?? '').split(',').map(Number);
  if (box.length === 4 && box.every(Number.isFinite)) {
    const inside = ([lat, lon]: [number, number]) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
    if (!inside(from) || !inside(to)) return json({ error: 'outside-region' }, 422);
  }
  const base = (env.MOTIS_URL ?? '').replace(/\/$/, '');
  if (!base) return json({ error: 'unavailable' }, 503);
  const q = new URLSearchParams({ fromPlace: `${from[0]},${from[1]}`, toPlace: `${to[0]},${to[1]}`, numItineraries: String(n) });
  if (time) q.set('time', new Date(time).toISOString());
  if (p.get('arriveBy') === 'true') q.set('arriveBy', 'true');
  const lang = p.get('language');
  if (lang && /^[a-z]{2}$/.test(lang)) q.set('language', lang);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${base}/api/v5/plan?${q}`, { signal: ctrl.signal });
    if (!res.ok) return json({ error: res.status === 400 ? 'bad-request' : 'engine-error' }, res.status === 400 ? 400 : 502);
    return json(await res.json());
  } catch {
    return json({ error: 'unavailable' }, 503);
  } finally {
    clearTimeout(timer);
  }
}
