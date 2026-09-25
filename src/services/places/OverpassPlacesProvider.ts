import type { LngLat } from '../../types/geo';
import type { PlaceKind } from '../../types/route';
import { cumulativeDistances } from '../../utils/distance';
import { overpassQuery } from '../overpass';
import type { PlacesProvider, RawPlace } from './PlacesProvider';

interface OverpassElement {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

/**
 * OpenStreetMap settlements via the Overpass API. The route is split into
 * ~60 km chunks and a single query asks for places inside each chunk's
 * padded bounding box (cheap index lookups; much faster than a corridor
 * `around:` query). Precise distance-to-route filtering happens client-side.
 */
export class OverpassPlacesProvider implements PlacesProvider {
  readonly name = 'overpass';

  constructor(
    private endpoints: string[],
    private language: string,
    private timeoutMs = 12000,
  ) {}

  async getPlacesNearRoute(
    geometry: LngLat[],
    options: { includeVillages: boolean; signal?: AbortSignal; language?: string },
  ): Promise<RawPlace[]> {
    if (geometry.length < 2) return [];
    const query = buildOverpassQuery(geometry, options.includeVillages);
    const data = await overpassQuery<{ elements: OverpassElement[] }>(this.endpoints, query, {
      provider: 'Places service',
      signal: options.signal,
      timeoutMs: this.timeoutMs,
    });
    return parseOverpassElements(data.elements ?? [], options.language ?? this.language);
  }
}

export function buildOverpassQuery(geometry: LngLat[], includeVillages: boolean): string {
  const cum = cumulativeDistances(geometry);
  const total = cum[cum.length - 1];
  const chunkM = 60_000;
  const chunks = Math.max(1, Math.ceil(total / chunkM));
  const kinds = includeVillages ? 'city|town|village' : 'city|town';
  const parts: string[] = [];
  let i = 0;
  for (let c = 0; c < chunks; c++) {
    const end = ((c + 1) / chunks) * total;
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (; i < geometry.length; i++) {
      const [lon, lat] = geometry[i];
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      if (cum[i] > end) break;
    }
    if (!Number.isFinite(minLat)) continue;
    const padLat = 0.07; // ≈ 8 km
    const padLon = padLat / Math.max(0.2, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
    parts.push(
      `node(${(minLat - padLat).toFixed(3)},${(minLon - padLon).toFixed(3)},${(maxLat + padLat).toFixed(3)},${(maxLon + padLon).toFixed(3)})[place~"^(${kinds})$"][name];`,
    );
  }
  return `[out:json][timeout:20];(${parts.join('')});out body;`;
}

export function parseOverpassElements(elements: OverpassElement[], language: string): RawPlace[] {
  const seen = new Set<number>();
  const out: RawPlace[] = [];
  for (const e of elements) {
    if (e.type !== 'node' || seen.has(e.id) || !e.tags) continue;
    seen.add(e.id);
    const kind = e.tags.place as PlaceKind;
    if (kind !== 'city' && kind !== 'town' && kind !== 'village') continue;
    const name = e.tags[`name:${language}`] ?? e.tags['int_name'] ?? e.tags['name:en'] ?? e.tags.name;
    if (!name) continue;
    const pop = Number(String(e.tags.population ?? '').replace(/[^\d]/g, ''));
    out.push({
      id: `osm:${e.id}`,
      name,
      kind,
      population: Number.isFinite(pop) && pop > 0 ? pop : undefined,
      coordinate: [e.lon, e.lat],
    });
  }
  return out;
}
