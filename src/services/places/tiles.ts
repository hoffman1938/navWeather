import type { LngLat } from '../../types/geo';
import { cumulativeDistances } from '../../utils/distance';
import { fetchJson, isAbortError } from '../http';

/**
 * OUR PLACES TILES (DEVELOPMENT_PLAN DP-4.2, DP-6.5): small static JSON files built from OpenStreetMap by
 * `pipelines/osm/build.mjs` — settlements, points of interest by category, speed cameras, level crossings and
 * roads with a posted limit. Served as static assets (free on Cloudflare, `public/` on localhost), fetched only
 * along the route and kept in memory. Replaces the public Overpass API inside the region the tiles cover.
 */

export type TileLayer =
  | 'settlement'
  | 'fuel'
  | 'ev_charging'
  | 'restaurant'
  | 'cafe'
  | 'hotel'
  | 'parking'
  | 'atm'
  | 'pharmacy'
  | 'supermarket'
  | 'rest_area'
  | 'car_wash'
  | 'car_repair'
  | 'attraction'
  | 'toilets'
  | 'hospital'
  | 'speed_camera'
  | 'level_crossing'
  | 'maxspeed';

/** A point feature: [id ("n123" / "w45"), lon, lat, tags]. */
export type TilePoint = [string, number, number, Record<string, string>];
/** A road with a posted limit: [id, maxspeed tag, [[lon, lat], …], highway]. */
export type TileRoad = [string, string, LngLat[], string];

export interface TilesIndex {
  v: 1;
  region: string;
  source: string;
  license: string;
  dataDate: string;
  coverage: { z: number; tiles: string[] };
  layers: Partial<Record<TileLayer, { z: number; tiles: string[] }>>;
}

/** Slippy-map tile of a point. */
export function tileOf([lon, lat]: LngLat, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)));
  return [x, y];
}

/** Every tile within `padM` of a polyline (or a point), at zoom `z`. */
export function tilesAlong(line: LngLat[], padM: number, z: number): string[] {
  const out = new Set<string>();
  if (!line.length) return [];
  // Walk the line in steps shorter than a tile, so no tile it crosses is missed.
  const cum = cumulativeDistances(line);
  const stepM = Math.max(200, Math.min(2000, 40_000_000 / 2 ** z / 4));
  const pts: LngLat[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const seg = cum[i] - cum[i - 1];
    const n = Math.ceil(seg / stepM);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      pts.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]);
    }
  }
  for (const [lon, lat] of pts) {
    const dLat = padM / 111_000;
    const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const [x0, y0] = tileOf([lon - dLon, lat + dLat], z);
    const [x1, y1] = tileOf([lon + dLon, lat - dLat], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.add(`${x}/${y}`);
  }
  return [...out];
}

/** Loads one JSON file of the tiles (null when it doesn't exist). Default: a same-origin fetch. */
export type TileLoader = <T>(url: string, signal?: AbortSignal) => Promise<T | null>;

const fetchLoader: TileLoader = <T>(url: string, signal?: AbortSignal) => fetchJson<T>(url, { provider: 'Places', signal, timeoutMs: 15_000 });

export class PlacesTiles {
  private index: Promise<TilesIndex | null> | null = null;
  private cache = new Map<string, Promise<unknown[]>>();

  constructor(
    private readonly baseUrl: string,
    private readonly maxTiles = 600,
    /** The Worker reads the same files from its static assets (`env.ASSETS`). */
    private readonly load: TileLoader = fetchLoader,
  ) {}

  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }

  /** The tiles' index; null when no tiles are deployed (then the fallback provider answers). */
  loadIndex(signal?: AbortSignal): Promise<TilesIndex | null> {
    this.index ??= this.load<TilesIndex>(`${this.base}/index.json`, signal)
      .then((i) => (i?.v === 1 ? i : null))
      .catch((e) => {
        this.index = null; // try again next time (offline, aborted)
        if (isAbortError(e)) throw e;
        return null;
      });
    return this.index;
  }

  /** Is this point inside the region the tiles were built for? */
  covers(index: TilesIndex, p: LngLat): boolean {
    const [x, y] = tileOf(p, index.coverage.z);
    return coverageSet(index).has(`${x}/${y}`);
  }

  /** Features of one layer within `padM` of a line (or around a point). */
  async features<T = TilePoint>(layer: TileLayer, line: LngLat[], padM: number, signal?: AbortSignal): Promise<T[]> {
    const index = await this.loadIndex(signal);
    const meta = index?.layers[layer];
    if (!meta) return [];
    const present = presentSet(meta);
    const wanted = tilesAlong(line, padM, meta.z).filter((t) => present.has(t));
    const seen = new Set<string>();
    const out: T[] = [];
    const lists = await Promise.all(wanted.map((t) => this.tile(layer, meta.z, t, signal)));
    for (const list of lists) {
      for (const f of list as (T & { 0: string })[]) {
        if (seen.has(f[0])) continue; // a road can lie in several tiles
        seen.add(f[0]);
        out.push(f);
      }
    }
    return out;
  }

  private tile(layer: TileLayer, z: number, xy: string, signal?: AbortSignal): Promise<unknown[]> {
    const key = `${layer}/${z}/${xy}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.load<{ v: 1; e: unknown[] }>(`${this.base}/${key}.json`, signal).then((t) => t?.e ?? []);
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
      if (this.cache.size > this.maxTiles) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }
}

const coverageSets = new WeakMap<TilesIndex, Set<string>>();
function coverageSet(index: TilesIndex): Set<string> {
  let s = coverageSets.get(index);
  if (!s) coverageSets.set(index, (s = new Set(index.coverage.tiles)));
  return s;
}

const presentSets = new WeakMap<object, Set<string>>();
function presentSet(meta: { tiles: string[] }): Set<string> {
  let s = presentSets.get(meta);
  if (!s) presentSets.set(meta, (s = new Set(meta.tiles)));
  return s;
}

/**
 * Split a line into stretches inside and outside the tiles' region (consecutive points with the same answer),
 * so a route leaving the region can ask the fallback provider about the rest only.
 */
export function splitByCoverage(tiles: PlacesTiles, index: TilesIndex, line: LngLat[]): { covered: boolean; points: LngLat[] }[] {
  const runs: { covered: boolean; points: LngLat[] }[] = [];
  for (const p of line) {
    const covered = tiles.covers(index, p);
    const last = runs.at(-1);
    if (last && last.covered === covered) last.points.push(p);
    else runs.push({ covered, points: last ? [last.points.at(-1)!, p] : [p] });
  }
  return runs;
}
