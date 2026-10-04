import { localizeScript } from '../../i18n/script';
import type { LngLat } from '../../types/geo';
import { cumulativeDistances } from '../../utils/distance';
import { overpassQuery } from '../overpass';
import { parseCharging } from './evCharging';
import type { Poi, PoiCategory, PoiProvider } from './PoiProvider';

/** OSM tag filters per category (fixed strings — no user input reaches Overpass QL). */
const FILTERS: Record<PoiCategory, string[]> = {
  fuel: ['["amenity"="fuel"]'],
  ev_charging: ['["amenity"="charging_station"]'],
  restaurant: ['["amenity"~"^(restaurant|fast_food)$"]'],
  cafe: ['["amenity"="cafe"]'],
  hotel: ['["tourism"~"^(hotel|motel|guest_house|hostel)$"]'],
  parking: ['["amenity"="parking"]'],
  atm: ['["amenity"="atm"]', '["amenity"="bank"]["atm"="yes"]'],
  pharmacy: ['["amenity"="pharmacy"]'],
  supermarket: ['["shop"~"^(supermarket|convenience)$"]'],
  rest_area: ['["highway"~"^(rest_area|services)$"]'],
  car_wash: ['["amenity"="car_wash"]'],
  car_repair: ['["shop"~"^(car_repair|tyres)$"]'],
  attraction: ['["tourism"~"^(attraction|viewpoint)$"]'],
  toilets: ['["amenity"="toilets"]'],
  hospital: ['["amenity"="hospital"]'],
};

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Places near a route corridor from OpenStreetMap (Overpass). The corridor
 * is split into ~15 km boxes padded by the corridor width; exact
 * distance-to-route filtering and detours are computed client-side.
 */
export class OverpassPoiProvider implements PoiProvider {
  readonly name = 'overpass-poi';

  constructor(
    private endpoints: string[],
    private language: string,
    private timeoutMs = 15000,
  ) {}

  async search(
    category: PoiCategory,
    corridor: LngLat[],
    options: { corridorM: number; signal?: AbortSignal; language?: string },
  ): Promise<Poi[]> {
    if (corridor.length < 2) return [];
    const query = buildPoiQuery(category, corridor, options.corridorM);
    const data = await overpassQuery<{ elements: OverpassElement[] }>(this.endpoints, query, {
      provider: 'Places service',
      signal: options.signal,
      timeoutMs: this.timeoutMs,
    });
    return parsePois(data.elements ?? [], category, options.language ?? this.language);
  }

  async searchNear(category: PoiCategory, [lon, lat]: LngLat, radiusM: number, options: { signal?: AbortSignal; language?: string } = {}): Promise<Poi[]> {
    const r = Math.round(Math.min(Math.max(radiusM, 300), 25_000));
    const parts = FILTERS[category].map((f) => `nwr(around:${r},${lat.toFixed(5)},${lon.toFixed(5)})${f};`);
    const data = await overpassQuery<{ elements: OverpassElement[] }>(this.endpoints, `[out:json][timeout:15];(${parts.join('')});out center tags 80;`, {
      provider: 'Places service',
      signal: options.signal,
      timeoutMs: this.timeoutMs,
    });
    return parsePois(data.elements ?? [], category, options.language ?? this.language);
  }
}

export function buildPoiQuery(category: PoiCategory, corridor: LngLat[], corridorM: number): string {
  const cum = cumulativeDistances(corridor);
  const total = cum[cum.length - 1];
  const chunks = Math.max(1, Math.ceil(total / 15_000));
  const padLat = corridorM / 111_000;
  const parts: string[] = [];
  let i = 0;
  for (let c = 0; c < chunks; c++) {
    const end = ((c + 1) / chunks) * total;
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (; i < corridor.length; i++) {
      const [lon, lat] = corridor[i];
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      if (cum[i] > end) break;
    }
    if (!Number.isFinite(minLat)) continue;
    const padLon = padLat / Math.max(0.2, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
    const bbox = `${(minLat - padLat).toFixed(4)},${(minLon - padLon).toFixed(4)},${(maxLat + padLat).toFixed(4)},${(maxLon + padLon).toFixed(4)}`;
    for (const f of FILTERS[category]) parts.push(`nwr(${bbox})${f};`);
  }
  return `[out:json][timeout:15];(${parts.join('')});out center tags 300;`;
}

/** Brand (or operator) in the UI language when mapped, else transliterated like names. */
function brandOf(t: Record<string, string>, language: string): string | undefined {
  const raw = t[`brand:${language}`] ?? t['brand:en'] ?? t.brand ?? t[`operator:${language}`] ?? t['operator:en'] ?? t.operator;
  return raw ? localizeScript(raw, language) : undefined;
}

export function parsePois(elements: OverpassElement[], category: PoiCategory, language: string): Poi[] {
  const seen = new Set<string>();
  const out: Poi[] = [];
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = `osm:${e.type}/${e.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = e.tags ?? {};
    out.push({
      id,
      category,
      name: t[`name:${language}`] ?? t['name:en'] ?? (t.name ? localizeScript(t.name, language) : undefined),
      brand: brandOf(t, language),
      coordinate: [lon, lat],
      openingHours: t.opening_hours,
      ...(category === 'ev_charging' ? { charging: parseCharging(t) } : {}),
      source: 'openstreetmap',
    });
  }
  return out;
}
