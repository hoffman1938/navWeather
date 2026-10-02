import type { PlaceCategory, VehicleProfile } from '../types';

/** A place as found in OpenStreetMap (before ranking). */
export interface RawPlace {
  id: string;
  category: PlaceCategory;
  /** hotel/motel/guest_house/hostel · fuel · charging_station · restaurant/fast_food/cafe · rest_area/services/parking */
  type: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

export interface PlaceQuery {
  lat: number;
  lon: number;
  /** Categories to look for, each with its own search radius (km). */
  categories: { category: PlaceCategory; radiusKm: number }[];
  vehicle: VehicleProfile;
}

/** Where the planner gets places from (Overpass on the server; fakes in tests). */
export interface TripPlacesSource {
  find(query: PlaceQuery, signal?: AbortSignal): Promise<RawPlace[]>;
}

/** Fixed OSM filters per category (no user input reaches Overpass QL). */
function filters(category: PlaceCategory, vehicle: VehicleProfile): string[] {
  switch (category) {
    case 'hotel':
      return ['["tourism"~"^(hotel|motel|guest_house|hostel)$"]'];
    case 'fuel':
      return ['["amenity"="fuel"]'];
    case 'charging':
      return ['["amenity"="charging_station"]'];
    case 'food':
      return ['["amenity"~"^(restaurant|fast_food|cafe)$"]'];
    case 'rest':
      return vehicle.kind === 'truck'
        ? ['["highway"~"^(rest_area|services)$"]', '["amenity"="parking"]["hgv"~"^(yes|designated)$"]']
        : ['["highway"~"^(rest_area|services)$"]'];
  }
}

/** Overpass QL for one stop: every requested category around one point, centres for ways/areas. */
export function overpassQueryFor(q: PlaceQuery): string {
  const lat = q.lat.toFixed(5);
  const lon = q.lon.toFixed(5);
  const parts: string[] = [];
  for (const { category, radiusKm } of q.categories) {
    const r = Math.round(Math.max(0.2, Math.min(25, radiusKm)) * 1000);
    for (const f of filters(category, q.vehicle)) parts.push(`nwr(around:${r},${lat},${lon})${f};`);
  }
  return `[out:json][timeout:15];(${parts.join('')});out center tags 200;`;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Overpass answer → places (category from the tags; elements without a position dropped). */
export function parseOverpass(data: { elements?: OverpassElement[] }): RawPlace[] {
  const out: RawPlace[] = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    let category: PlaceCategory | null = null;
    let type = '';
    if (tags.tourism && /^(hotel|motel|guest_house|hostel)$/.test(tags.tourism)) [category, type] = ['hotel', tags.tourism];
    else if (tags.amenity === 'fuel') [category, type] = ['fuel', 'fuel'];
    else if (tags.amenity === 'charging_station') [category, type] = ['charging', 'charging_station'];
    else if (tags.amenity && /^(restaurant|fast_food|cafe)$/.test(tags.amenity)) [category, type] = ['food', tags.amenity];
    else if (tags.highway && /^(rest_area|services)$/.test(tags.highway)) [category, type] = ['rest', tags.highway];
    else if (tags.amenity === 'parking') [category, type] = ['rest', 'truck_parking'];
    if (!category) continue;
    out.push({ id: `${el.type}/${el.id}`, category, type, lat, lon, tags });
  }
  return out;
}

/**
 * Overpass, called from the Worker: identifying User-Agent (Overpass asks
 * for one), endpoints tried in order, a per-query timeout, and an optional
 * cache (the Worker passes the edge cache) keyed by rounded area.
 */
export class OverpassTripPlaces implements TripPlacesSource {
  constructor(
    private readonly endpoints: string[],
    private readonly userAgent: string,
    private readonly options: {
      timeoutMs?: number;
      cache?: { get(key: string): Promise<RawPlace[] | null>; put(key: string, value: RawPlace[]): Promise<void> };
      fetchFn?: typeof fetch;
    } = {},
  ) {}

  async find(q: PlaceQuery, signal?: AbortSignal): Promise<RawPlace[]> {
    const key = `v1:${q.lat.toFixed(2)},${q.lon.toFixed(2)}:${q.vehicle.kind}:${q.categories.map((c) => `${c.category}${c.radiusKm}`).join('+')}`;
    const cached = await this.options.cache?.get(key).catch(() => null);
    if (cached) return cached;
    const body = `data=${encodeURIComponent(overpassQueryFor(q))}`;
    const fetchFn = this.options.fetchFn ?? fetch;
    let lastError: unknown = null;
    for (const endpoint of this.endpoints) {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), this.options.timeoutMs ?? 8000);
      try {
        const res = await fetchFn(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': this.userAgent, accept: 'application/json' },
          body,
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`overpass ${res.status}`);
        const places = parseOverpass((await res.json()) as { elements?: OverpassElement[] });
        await this.options.cache?.put(key, places).catch(() => undefined);
        return places;
      } catch (e) {
        lastError = e;
        if (signal?.aborted) break;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
    throw lastError ?? new Error('overpass unavailable');
  }
}
