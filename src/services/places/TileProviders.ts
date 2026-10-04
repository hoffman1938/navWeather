import type { LngLat } from '../../types/geo';
import { haversineM } from '../../utils/distance';
import { parseMaxspeed } from '../speed/OverpassSpeedLimitProvider';
import type { SpeedCamera, SpeedLimitProvider, SpeedLimitWay } from '../speed/SpeedLimitProvider';
import { parseOverpassElements } from './OverpassPlacesProvider';
import { parsePois } from './OverpassPoiProvider';
import type { PlacesProvider, RawPlace } from './PlacesProvider';
import type { Poi, PoiCategory, PoiProvider } from './PoiProvider';
import { PlacesTiles, splitByCoverage, type TilePoint, type TileRoad } from './tiles';

/**
 * Settlements, places and road data from OUR tiles (DP-6.5) — no third-party request inside the region the tiles
 * cover. Outside it (a trip leaving Georgia), the `fallback` provider answers for that stretch only, until the
 * region is added (DEVELOPMENT_PLAN DP-13.9); without a fallback those stretches simply have no places.
 * Results have the same shape as before: the Overpass parsers are reused on our features.
 */

type Element = { type: 'node' | 'way'; id: number; lat: number; lon: number; tags: Record<string, string> };

function toElement([id, lon, lat, tags]: TilePoint): Element {
  return { type: id[0] === 'w' ? 'way' : 'node', id: Number(id.slice(1)), lat, lon, tags };
}

function dedupe<T extends { id: string }>(lists: T[][]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists) for (const x of list) if (!seen.has(x.id)) (seen.add(x.id), out.push(x));
  return out;
}

/**
 * Answer from tiles where they cover the line and from the fallback elsewhere. When nothing is covered the
 * fallback's own errors surface (the caller says "unavailable"); for a partly covered line they are swallowed,
 * so our part still shows.
 */
async function byCoverage<T extends { id: string }>(
  tiles: PlacesTiles,
  line: LngLat[],
  signal: AbortSignal | undefined,
  fromTiles: (points: LngLat[]) => Promise<T[]>,
  fallback: ((points: LngLat[]) => Promise<T[]>) | null,
): Promise<T[]> {
  const index = await tiles.loadIndex(signal);
  if (!index) return fallback ? fallback(line) : [];
  const runs = splitByCoverage(tiles, index, line);
  if (runs.every((r) => !r.covered)) return fallback ? fallback(line) : [];
  const parts = await Promise.all(
    runs.map((r) => (r.covered ? fromTiles(r.points) : fallback && r.points.length >= 2 ? fallback(r.points).catch(() => [] as T[]) : Promise.resolve([] as T[]))),
  );
  return dedupe(parts);
}

export class TilePlacesProvider implements PlacesProvider {
  readonly name = 'tiles';
  constructor(
    private readonly tiles: PlacesTiles,
    private readonly language: string,
    private readonly fallback: PlacesProvider | null = null,
  ) {}

  getPlacesNearRoute(geometry: LngLat[], options: { includeVillages: boolean; signal?: AbortSignal; language?: string }): Promise<RawPlace[]> {
    if (geometry.length < 2) return Promise.resolve([]);
    const language = options.language ?? this.language;
    return byCoverage(
      this.tiles,
      geometry,
      options.signal,
      async (points) => {
        const features = await this.tiles.features('settlement', points, 8000, options.signal);
        const kinds = options.includeVillages ? /^(city|town|village)$/ : /^(city|town)$/;
        return parseOverpassElements(features.filter((f) => kinds.test(f[3].place ?? '')).map(toElement), language);
      },
      this.fallback ? (points) => this.fallback!.getPlacesNearRoute(points, options) : null,
    );
  }
}

export class TilePoiProvider implements PoiProvider {
  readonly name = 'tiles-poi';
  constructor(
    private readonly tiles: PlacesTiles,
    private readonly language: string,
    private readonly fallback: PoiProvider | null = null,
  ) {}

  search(category: PoiCategory, corridor: LngLat[], options: { corridorM: number; signal?: AbortSignal; language?: string }): Promise<Poi[]> {
    if (corridor.length < 2) return Promise.resolve([]);
    const language = options.language ?? this.language;
    return byCoverage(
      this.tiles,
      corridor,
      options.signal,
      async (points) => parsePois((await this.tiles.features(category, points, options.corridorM, options.signal)).map(toElement), category, language),
      this.fallback ? (points) => this.fallback!.search(category, points, options) : null,
    );
  }

  async searchNear(category: PoiCategory, center: LngLat, radiusM: number, options: { signal?: AbortSignal; language?: string } = {}): Promise<Poi[]> {
    const index = await this.tiles.loadIndex(options.signal);
    if (!index || !this.tiles.covers(index, center)) {
      return this.fallback?.searchNear ? this.fallback.searchNear(category, center, radiusM, options) : [];
    }
    const r = Math.min(Math.max(radiusM, 300), 25_000);
    const features = (await this.tiles.features(category, [center], r, options.signal)).filter((f) => haversineM(center, [f[1], f[2]]) <= r);
    return parsePois(features.map(toElement), category, options.language ?? this.language);
  }
}

export class TileSpeedLimitProvider implements SpeedLimitProvider {
  readonly name = 'tiles-maxspeed';
  constructor(
    private readonly tiles: PlacesTiles,
    private readonly fallback: SpeedLimitProvider | null = null,
  ) {}

  async getSpeedLimits(route: LngLat[], signal?: AbortSignal): Promise<SpeedLimitWay[]> {
    const ways = await byCoverage(
      this.tiles,
      route,
      signal,
      async (points) =>
        (await this.tiles.features<TileRoad>('maxspeed', points, 450, signal)).flatMap(([id, maxspeed, geometry]) => {
          const kmh = parseMaxspeed(maxspeed);
          return kmh && geometry.length >= 2 ? [{ id, kmh, geometry }] : [];
        }),
      this.fallback ? async (points) => (await this.fallback!.getSpeedLimits(points, signal)).map((w, i) => ({ ...w, id: `fallback:${i}:${w.geometry[0]?.join(',')}` })) : null,
    );
    return ways.map(({ kmh, geometry }) => ({ kmh, geometry }));
  }

  getSpeedCameras(route: LngLat[], signal?: AbortSignal): Promise<SpeedCamera[]> {
    return byCoverage(
      this.tiles,
      route,
      signal,
      async (points) =>
        (await this.tiles.features('speed_camera', points, 220, signal)).map(([id, lon, lat, tags]) => ({
          id: `osm:${id.slice(1)}`,
          coordinate: [lon, lat] as LngLat,
          kmh: parseMaxspeed(tags.maxspeed) ?? undefined,
        })),
      this.fallback?.getSpeedCameras ? (points) => this.fallback!.getSpeedCameras!(points, signal) : null,
    );
  }

  getLevelCrossings(route: LngLat[], signal?: AbortSignal): Promise<{ id: string; coordinate: LngLat }[]> {
    return byCoverage(
      this.tiles,
      route,
      signal,
      async (points) => (await this.tiles.features('level_crossing', points, 220, signal)).map(([id, lon, lat]) => ({ id: `osm:${id.slice(1)}`, coordinate: [lon, lat] as LngLat })),
      this.fallback?.getLevelCrossings ? (points) => this.fallback!.getLevelCrossings!(points, signal) : null,
    );
  }
}
