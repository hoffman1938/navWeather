import type { LngLat } from '../../types/geo';
import { cumulativeDistances } from '../../utils/distance';
import { overpassQuery } from '../overpass';
import type { SpeedCamera, SpeedLimitProvider, SpeedLimitWay } from './SpeedLimitProvider';

/** Overpass bbox strings covering the route in ~chunkM pieces (padded). */
function routeBoxes(route: LngLat[], chunkM: number, pad: number): string[] {
  const cum = cumulativeDistances(route);
  const total = cum[cum.length - 1];
  const chunks = Math.max(1, Math.ceil(total / chunkM));
  const boxes: string[] = [];
  let i = 0;
  for (let c = 0; c < chunks; c++) {
    const end = ((c + 1) / chunks) * total;
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (; i < route.length; i++) {
      const [lon, lat] = route[i];
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      if (cum[i] > end) break;
    }
    if (!Number.isFinite(minLat)) continue;
    boxes.push(`${(minLat - pad).toFixed(4)},${(minLon - pad).toFixed(4)},${(maxLat + pad).toFixed(4)},${(maxLon + pad).toFixed(4)}`);
  }
  return boxes;
}

/** Parse OSM maxspeed ("110", "70 mph"); implicit zones ("GE:urban") are skipped. */
export function parseMaxspeed(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(mph)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] ? Math.round(n * 1.609344) : n;
}

/**
 * OSM speed limits via Overpass: roads with an explicit `maxspeed` inside
 * small boxes along the route. Best effort — coverage varies by country and
 * the public Overpass servers are often busy.
 */
export class OverpassSpeedLimitProvider implements SpeedLimitProvider {
  readonly name = 'overpass-maxspeed';

  constructor(
    private endpoints: string[],
    private timeoutMs = 25000,
  ) {}

  async getSpeedLimits(route: LngLat[], signal?: AbortSignal): Promise<SpeedLimitWay[]> {
    const parts = routeBoxes(route, 25_000, 0.004).map(
      (b) => `way(${b})[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)(_link)?$"][maxspeed];`,
    );
    const query = `[out:json][timeout:25];(${parts.join('')});out geom;`;
    const data = await overpassQuery<{ elements: { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] }>(
      this.endpoints,
      query,
      { provider: 'Speed limit service', signal, timeoutMs: this.timeoutMs },
    );
    const out: SpeedLimitWay[] = [];
    for (const e of data.elements ?? []) {
      const kmh = parseMaxspeed(e.tags?.maxspeed);
      if (!kmh || !e.geometry || e.geometry.length < 2) continue;
      out.push({ kmh, geometry: e.geometry.map((g) => [g.lon, g.lat] as LngLat) });
    }
    return out;
  }

  async getSpeedCameras(route: LngLat[], signal?: AbortSignal): Promise<SpeedCamera[]> {
    const parts = routeBoxes(route, 25_000, 0.002).map((b) => `node(${b})["highway"="speed_camera"];`);
    const data = await overpassQuery<{ elements: { id: number; lat?: number; lon?: number; tags?: Record<string, string> }[] }>(
      this.endpoints,
      `[out:json][timeout:25];(${parts.join('')});out body;`,
      { provider: 'Speed camera service', signal, timeoutMs: this.timeoutMs },
    );
    const out: SpeedCamera[] = [];
    for (const e of data.elements ?? []) {
      if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
      out.push({ id: `osm:${e.id}`, coordinate: [e.lon!, e.lat!], kmh: parseMaxspeed(e.tags?.maxspeed) ?? undefined });
    }
    return out;
  }

  async getLevelCrossings(route: LngLat[], signal?: AbortSignal): Promise<{ id: string; coordinate: LngLat }[]> {
    const parts = routeBoxes(route, 25_000, 0.002).map((b) => `node(${b})["railway"="level_crossing"];`);
    const data = await overpassQuery<{ elements: { id: number; lat?: number; lon?: number }[] }>(
      this.endpoints,
      `[out:json][timeout:25];(${parts.join('')});out skel;`,
      { provider: 'Road hazards', signal, timeoutMs: this.timeoutMs },
    );
    return (data.elements ?? [])
      .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon))
      .map((e) => ({ id: `osm:${e.id}`, coordinate: [e.lon!, e.lat!] as LngLat }));
  }
}
