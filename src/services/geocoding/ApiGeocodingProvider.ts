import type { LngLat, Place } from '../../types/geo';
import { haversineM } from '../../utils/distance';
import { fetchJson, isAbortError } from '../http';
import { parseOverpassElements } from '../places/OverpassPlacesProvider';
import type { PlacesTiles, TilePoint } from '../places/tiles';
import type { AutocompleteProvider, GeocodeOptions, GeocodingProvider } from './GeocodingProvider';

/**
 * Search and suggestions from OUR geocoder (`/api/v1/geocode`, D1 FTS5 over OpenStreetMap — DEVELOPMENT_PLAN
 * DP-4.4, DP-6.4): the search text goes to our Worker only. A `fallback` (Photon, until more regions are indexed)
 * answers only when our index has nothing — a town abroad — or isn't loaded; `reverse` comes from `reverser`.
 */
export class ApiGeocodingProvider implements GeocodingProvider, AutocompleteProvider {
  readonly name = 'navweather-geocoder';

  constructor(
    private readonly url: string,
    private readonly language: string,
    private readonly fallback: (GeocodingProvider & AutocompleteProvider) | null,
    private readonly reverser: GeocodingProvider,
  ) {}

  async suggest(query: string, options: GeocodeOptions = {}): Promise<Place[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const lang = (options.language ?? this.language) === 'ru' ? 'ru' : 'en';
    const params = new URLSearchParams({ q, lang, limit: String(options.limit ?? 6) });
    // Coarse bias only (~10 km): ranking needs the region, not the exact position.
    if (options.near) params.set('near', `${options.near[0].toFixed(1)},${options.near[1].toFixed(1)}`);
    let ours: Place[] = [];
    try {
      const res = await fetchJson<{ places?: Place[] }>(`${this.url}?${params}`, { provider: 'Search service', signal: options.signal, timeoutMs: 8000 });
      ours = (res.places ?? []).filter(validPlace);
    } catch (e) {
      if (isAbortError(e) || !this.fallback) throw e;
    }
    if (ours.length || !this.fallback) return ours;
    return this.fallback.suggest(q, options);
  }

  async geocode(query: string, options: GeocodeOptions = {}): Promise<Place | null> {
    return (await this.suggest(query, { ...options, limit: 1 }))[0] ?? null;
  }

  reverse(coordinate: LngLat, options?: GeocodeOptions): Promise<Place | null> {
    return this.reverser.reverse(coordinate, options);
  }
}

function validPlace(p: Place): boolean {
  const c = p?.coordinate;
  return !!p && typeof p.name === 'string' && Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[1]) <= 90 && Math.abs(c[0]) <= 180;
}

/**
 * The settlement a point is in or near (≤15 km), from OUR settlement tiles — for naming route points and dropped
 * pins without any request beyond the tiles. Outside the region they cover, `fallback` (Photon) answers.
 */
export class TileReverseGeocoder implements GeocodingProvider {
  readonly name = 'tiles-reverse';

  constructor(
    private readonly tiles: PlacesTiles,
    private readonly language: string,
    private readonly fallback: GeocodingProvider | null,
  ) {}

  async geocode(query: string, options?: GeocodeOptions): Promise<Place | null> {
    return this.fallback ? this.fallback.geocode(query, options) : null;
  }

  async reverse(coordinate: LngLat, options: GeocodeOptions = {}): Promise<Place | null> {
    const index = await this.tiles.loadIndex(options.signal);
    if (!index || !this.tiles.covers(index, coordinate)) return this.fallback ? this.fallback.reverse(coordinate, options) : null;
    const features = await this.tiles.features<TilePoint>('settlement', [coordinate], 15_000, options.signal);
    const lang = options.language ?? this.language;
    const places = parseOverpassElements(
      features.map(([id, lon, lat, tags]) => ({ type: 'node', id: Number(id.slice(1)), lat, lon, tags })),
      lang,
    );
    let best: (typeof places)[number] | null = null;
    let bestD = 15_000;
    for (const p of places) {
      const d = haversineM(coordinate, p.coordinate);
      if (d < bestD) [best, bestD] = [p, d];
    }
    return best ? { id: best.id, name: best.name, label: best.name, coordinate: best.coordinate, kind: best.kind } : null;
  }
}
