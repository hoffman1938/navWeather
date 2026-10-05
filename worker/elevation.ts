import {
  cellOf,
  decodeHeader,
  ELEV_HEADER_BYTES,
  ELEV_INDEX_BYTES,
  ELEV_INDEX_KEY,
  ELEV_MISSING,
  elevTileKey,
  elevTileOf,
  parseElevationQuery,
  tileStatus,
  type ElevationIndex,
  type TileHeader,
} from '../src/api/elevation';
import { json } from './http';

/**
 * GET /api/v1/elevation?latitude=a,b&longitude=c,d — ground height at up to 100 points from our Copernicus DEM tiles
 * in R2 (DP-4.7; `npm run data:elevation` → pipelines/elevation/build.mjs; format in src/api/elevation.ts). Answer as
 * Open-Meteo's: `{ elevation: [...] }`, with `null` where we have no tiles (outside the areas built) — the client
 * asks its fallback for those. The forecast uses the same heights (worker/weather.ts). Nothing stored or logged.
 */

export interface ElevationEnv {
  DATA?: R2Bucket;
  ELEVATION_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

let current: { index: ElevationIndex; tiles: Set<string>; sea: Set<string>; at: number } | null = null;
const INDEX_TTL_MS = 5 * 60_000;
/** Decoded blocks (120 × 120 int16 ≈ 29 KB each) and tile headers, newest last; a small bound per isolate. */
const blocks = new Map<string, Promise<Int16Array | null>>();
const headers = new Map<string, Promise<TileHeader | null>>();
const MAX_BLOCKS = 160;
const MAX_HEADERS = 256;

function remember<T>(map: Map<string, T>, key: string, max: number, make: () => T): T {
  const hit = map.get(key);
  if (hit !== undefined) {
    map.delete(key);
    map.set(key, hit);
    return hit;
  }
  const v = make();
  map.set(key, v);
  if (map.size > max) map.delete(map.keys().next().value!);
  return v;
}

async function index(env: ElevationEnv) {
  if (current && Date.now() - current.at < INDEX_TTL_MS) return current;
  const obj = await env.DATA?.get(ELEV_INDEX_KEY).catch(() => null);
  if (!obj) return (current = null);
  const value = await obj.json<ElevationIndex>();
  current = { index: value, tiles: new Set(value.tiles), sea: new Set(value.sea ?? []), at: Date.now() };
  return current;
}

async function inflate(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

function header(env: ElevationEnv, key: string) {
  return remember(headers, key, MAX_HEADERS, async () => {
    const obj = await env.DATA!.get(key, { range: { offset: 0, length: ELEV_HEADER_BYTES + ELEV_INDEX_BYTES } });
    return obj ? decodeHeader(await obj.arrayBuffer()) : null;
  });
}

function block(env: ElevationEnv, key: string, h: TileHeader, b: number) {
  return remember(blocks, `${key}#${b}`, MAX_BLOCKS, async () => {
    if (!h.lengths[b]) return null;
    const obj = await env.DATA!.get(key, { range: { offset: h.offsets[b], length: h.lengths[b] } });
    return obj ? new Int16Array(await inflate(await obj.arrayBuffer())) : null;
  });
}

/** Heights in metres; `null` outside the areas our tiles cover (or when there are none here). */
export async function elevations(env: ElevationEnv, points: { lat: number; lon: number }[]): Promise<(number | null)[]> {
  const c = env.DATA ? await index(env) : null;
  if (!c) return points.map(() => null);
  return Promise.all(
    points.map(async ({ lat, lon }) => {
      const status = tileStatus(c, lat, lon);
      if (status === 'unknown') return null;
      if (status === 'sea') return 0;
      const t = elevTileOf(lat, lon);
      const key = elevTileKey(t.lat, t.lon);
      const h = await header(env, key).catch(() => null);
      if (!h) return null;
      const cell = cellOf(h, lat, lon);
      const values = await block(env, key, h, cell.block).catch(() => null);
      if (!values) return h.lengths[cell.block] ? null : 0;
      const v = values[cell.i];
      return v === ELEV_MISSING ? 0 : v;
    }),
  );
}

export async function elevation(request: Request, url: URL, env: ElevationEnv): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.ELEVATION_LIMITER && !(await env.ELEVATION_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  const points = parseElevationQuery(url.searchParams);
  if (typeof points === 'string') return json({ error: 'bad-request', reason: points }, 400);
  if (!env.DATA || !(await index(env))) return json({ error: 'unavailable' }, 503);
  return json({ elevation: await elevations(env, points) });
}
