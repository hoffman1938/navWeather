import { AIR_LATEST_KEY, AIR_MAX_AGE_H, AIR_NONE, airCell, airTileKey, type AirIndex } from '../src/api/air';
import { json } from './http';

/**
 * GET /api/v1/air?latitude=…&longitude=… — the European Air Quality Index now at one point (DP-4.6), from our CAMS
 * tiles in R2 (`npm run data:air` → pipelines/air/build.mjs; format in src/api/air.ts). Open-Meteo's `current` shape:
 * `{ latitude, longitude, current: { time, european_aqi } }`; `european_aqi: null` at sea or where the model has no
 * value. 503 without tiles or when they are too old — the client then uses its fallback. Nothing stored or logged.
 */

export interface AirEnv {
  WEATHER?: R2Bucket;
  AIR_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

let current: { index: AirIndex; tiles: Set<string>; at: number } | null = null;

async function latest(env: AirEnv) {
  if (current && Date.now() - current.at < 60_000) return current;
  const obj = await env.WEATHER?.get(AIR_LATEST_KEY).catch(() => null);
  if (!obj) return (current = null);
  const index = await obj.json<AirIndex>();
  current = { index, tiles: new Set(index.tiles), at: Date.now() };
  return current;
}

export async function air(request: Request, url: URL, env: AirEnv): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.AIR_LIMITER && !(await env.AIR_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  const lat = Number(url.searchParams.get('latitude'));
  const lon = Number(url.searchParams.get('longitude'));
  if (!url.searchParams.has('latitude') || !url.searchParams.has('longitude') || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) {
    return json({ error: 'bad-request', reason: 'one latitude and one longitude' }, 400);
  }
  const c = await latest(env);
  if (!c) return json({ error: 'unavailable' }, 503);
  const nowS = Date.now() / 1000;
  if (nowS - c.index.referenceTime > AIR_MAX_AGE_H * 3600) return json({ error: 'unavailable', reason: 'stale' }, 503);
  const hour = Math.floor(nowS / 3600) * 3600;
  const h = c.index.times.indexOf(hour);
  const cell = airCell(lat, lon);
  const head = { latitude: -90 + cell.row * 0.4, longitude: -180 + cell.col * 0.4 };
  if (h < 0) return json({ error: 'unavailable', reason: 'stale' }, 503);
  if (!c.tiles.has(`${cell.ty}/${cell.tx}`)) return json({ ...head, current: { time: hour, european_aqi: null } });
  const H = c.index.times.length;
  const obj = await env.WEATHER!.get(airTileKey(c.index.run, cell.ty, cell.tx), { range: { offset: cell.i * H + h, length: 1 } });
  const v = obj ? new Uint8Array(await obj.arrayBuffer())[0] : AIR_NONE;
  return json({ ...head, current: { time: hour, european_aqi: v === AIR_NONE ? null : v } });
}
