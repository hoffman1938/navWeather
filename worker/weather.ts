import tzlookup from '@photostructure/tz-lookup';
import {
  gridCell,
  hoursFor,
  HOURLY_UNITS,
  LATEST_KEY,
  MAX_RUN_AGE_H,
  parseForecastQuery,
  planHours,
  pointForecast,
  recordBytes,
  tileKey,
  tileReads,
  type WeatherIndex,
} from '../src/api/weather';
import { timeZoneOffsetMinutes } from '../src/utils/timezone';
import { json } from './http';

/**
 * GET /api/v1/weather/forecast — our forecast for up to 100 points anywhere on Earth (DP-4.6, DP-6.6), in Open-Meteo's
 * query and JSON shape; GET /api/v1/weather/meta — which model runs it is built from. The data are weather tiles in
 * R2 (`npm run data:weather` → pipelines/weather/build.mjs; format in src/api/weather.ts): one range read per point
 * (neighbours share one), records kept in the edge cache until the next build. No third party sees the coordinates;
 * nothing is stored or logged. 503 when there are no tiles (not built here) or they are too old — the client then
 * uses its fallback.
 */

export interface WeatherEnv {
  WEATHER?: R2Bucket;
  WEATHER_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

interface Current {
  index: WeatherIndex;
  tiles: Set<string>;
  recBytes: number;
  at: number;
}

let current: Current | null = null;
/** How long one isolate trusts the index before looking for a newer build. */
const INDEX_TTL_MS = 60_000;
/** Records are cached per build, so a new build never meets old records; this only bounds the cache. */
const RECORD_TTL_S = 12 * 3600;

async function latest(env: WeatherEnv): Promise<Current | null> {
  if (current && Date.now() - current.at < INDEX_TTL_MS) return current;
  const obj = await env.WEATHER?.get(LATEST_KEY).catch(() => null);
  if (!obj) return (current = null);
  const index = await obj.json<WeatherIndex>();
  current = { index, tiles: new Set(index.tiles), recBytes: recordBytes(index), at: Date.now() };
  return current;
}

const fresh = (c: Current) => Date.now() / 1000 - c.index.referenceTime <= MAX_RUN_AGE_H * 3600;
const cacheUrl = (run: string, row: number, col: number) => `https://weather-records.navweather.internal/${run}/${row}/${col}`;

type Cell = ReturnType<typeof gridCell>;

/** The records of these grid cells (by "row/col"): edge cache first, then range reads from the tiles. */
async function records(env: WeatherEnv, ctx: ExecutionContext | undefined, c: Current, cells: Cell[]): Promise<Map<string, Int16Array>> {
  const out = new Map<string, Int16Array>();
  const run = c.index.run;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const unique = [...new Map(cells.map((cell) => [`${cell.row}/${cell.col}`, cell])).values()].filter((cell) => c.tiles.has(`${cell.ty}/${cell.tx}`));
  const misses: Cell[] = [];
  await Promise.all(
    unique.map(async (cell) => {
      const hit = cache ? await cache.match(cacheUrl(run, cell.row, cell.col)).catch(() => undefined) : undefined;
      if (hit) out.set(`${cell.row}/${cell.col}`, new Int16Array(await hit.arrayBuffer()));
      else misses.push(cell);
    }),
  );
  const byTile = new Map<string, Cell[]>();
  for (const cell of misses) {
    const k = `${cell.ty}/${cell.tx}`;
    byTile.set(k, [...(byTile.get(k) ?? []), cell]);
  }
  const reads = [...byTile.values()].flatMap((list) => tileReads(list.map((cell) => cell.i), c.recBytes).map((r) => ({ ...r, list })));
  await Promise.all(
    reads.map(async (r) => {
      const { ty, tx } = r.list[0];
      const obj = await env.WEATHER!.get(tileKey(run, ty, tx), { range: { offset: r.offset, length: r.length } });
      if (!obj) return;
      const buf = await obj.arrayBuffer();
      for (const cell of r.list) {
        if (!r.points.includes(cell.i)) continue;
        const start = cell.i * c.recBytes - r.offset;
        const bytes = buf.slice(start, start + c.recBytes);
        if (bytes.byteLength !== c.recBytes) continue;
        out.set(`${cell.row}/${cell.col}`, new Int16Array(bytes));
        if (cache) {
          const put = cache.put(cacheUrl(run, cell.row, cell.col), new Response(bytes.slice(0), { headers: { 'cache-control': `public, max-age=${RECORD_TTL_S}` } })).catch(() => undefined);
          if (ctx) ctx.waitUntil(put);
        }
      }
    }),
  );
  return out;
}

function zoneOf(lat: number, lon: number): string {
  try {
    return tzlookup(lat, lon);
  } catch {
    return 'GMT';
  }
}

export async function weatherForecast(request: Request, url: URL, env: WeatherEnv, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.WEATHER_LIMITER && !(await env.WEATHER_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  const q = parseForecastQuery(url.searchParams);
  if (typeof q === 'string') return json({ error: 'bad-request', reason: q }, 400);
  const c = await latest(env);
  if (!c) return json({ error: 'unavailable' }, 503);
  if (!fresh(c)) return json({ error: 'unavailable', reason: 'stale' }, 503);

  const started = Date.now();
  const cells = q.points.map((p) => gridCell(p.lat, p.lon));
  const recs = await records(env, ctx, c, cells);
  const plan = planHours(c.index, hoursFor(c.index, started / 1000, q.pastHours, q.forecastHours));
  const units = { time: 'unixtime', ...Object.fromEntries(q.hourly.map((h) => [h, h === 'wind_speed_10m' || h === 'wind_gusts_10m' ? (q.windUnit === 'ms' ? 'm/s' : 'km/h') : HOURLY_UNITS[h]])) };
  const answer = q.points.map((p, n) => {
    const cell = cells[n];
    const timezone = zoneOf(p.lat, p.lon);
    const head = { latitude: cell.lat, longitude: cell.lon, timezone, utc_offset_seconds: timeZoneOffsetMinutes(started, timezone) * 60 };
    const rec = recs.get(`${cell.row}/${cell.col}`);
    // Open sea far from any coast (or a tile the build left out): no forecast here — the client asks its fallback.
    if (!rec) return { ...head, missing: true };
    return { ...head, generationtime_ms: Date.now() - started, hourly_units: units, ...pointForecast(c.index, rec, plan, { hourly: q.hourly, windUnit: q.windUnit, elevation: p.elevation }) };
  });
  return json(answer.length === 1 ? answer[0] : answer);
}

export async function weatherMeta(request: Request, env: WeatherEnv): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.WEATHER_LIMITER && !(await env.WEATHER_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  const c = await latest(env);
  if (!c) return json({ error: 'unavailable' }, 503);
  const { index } = c;
  return json({
    run: index.run,
    reference_time: index.referenceTime,
    last_run_availability_time: index.createdAt,
    until: index.times[index.times.length - 1],
    models: index.models,
    source: index.source,
    fresh: fresh(c),
  });
}
