import type { LngLat, Place } from '../../types/geo';
import { fetchJson } from '../http';
import type { AutocompleteProvider, GeocodeOptions, GeocodingProvider } from './GeocodingProvider';

interface PhotonFeature {
  geometry: { coordinates: LngLat };
  properties: {
    osm_id?: number;
    osm_type?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

/**
 * Photon (komoot) — OSM geocoder designed for search-as-you-type. Also
 * used as a lightweight reverse geocoder for naming route points.
 */
export class PhotonProvider implements AutocompleteProvider, GeocodingProvider {
  readonly name = 'photon';
  private reverseCache = new Map<string, Place | null>();

  constructor(
    private baseUrl: string,
    private language: string,
  ) {}

  async suggest(query: string, options: GeocodeOptions = {}): Promise<Place[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const params = new URLSearchParams({ q, limit: String(options.limit ?? 6) });
    // Photon only supports a few languages; others fall back to local names.
    const lang = options.language ?? this.language;
    if (['en', 'de', 'fr', 'it'].includes(lang)) params.set('lang', lang);
    // Coarse bias only (~10 km) — ranking needs the region, not the start point.
    if (options.near) {
      params.set('lon', options.near[0].toFixed(1));
      params.set('lat', options.near[1].toFixed(1));
    }
    const data = await fetchJson<{ features: PhotonFeature[] }>(`${this.base}/api/?${params}`, {
      provider: 'Search service',
      signal: options.signal,
      timeoutMs: 8000,
    });
    const seen = new Set<string>();
    const out: Place[] = [];
    for (const f of data.features ?? []) {
      const [lon, lat] = f.geometry?.coordinates ?? [];
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const p = toPlace(f);
      const dedupe = `${p.name}|${p.label}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push(p);
    }
    return out;
  }

  async geocode(query: string, options: GeocodeOptions = {}): Promise<Place | null> {
    const results = await this.suggest(query, { ...options, limit: 1 });
    return results[0] ?? null;
  }

  async reverse(coordinate: LngLat, options: GeocodeOptions = {}): Promise<Place | null> {
    const [lon, lat] = coordinate;
    const key = `${options.language ?? this.language}:${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (this.reverseCache.has(key)) return this.reverseCache.get(key) ?? null;
    const params = new URLSearchParams({
      lon: lon.toFixed(5),
      lat: lat.toFixed(5),
      limit: '1',
      radius: '15',
    });
    params.append('layer', 'city');
    params.append('layer', 'locality');
    const lang = options.language ?? this.language;
    // Unsupported languages (ka, ru) get local names — Georgian names for a Georgian UI.
    if (['en', 'de', 'fr', 'it'].includes(lang)) params.set('lang', lang);
    const data = await fetchJson<{ features: PhotonFeature[] }>(`${this.base}/reverse?${params}`, {
      provider: 'Search service',
      signal: options.signal,
      timeoutMs: 8000,
    });
    const f = data.features?.[0];
    const valid = f && Number.isFinite(f.geometry?.coordinates?.[0]) && Number.isFinite(f.geometry?.coordinates?.[1]);
    const place = valid ? toPlace(f) : null;
    this.reverseCache.set(key, place);
    return place;
  }

  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }
}

function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : undefined;
  const name = p.name ?? street ?? p.city ?? 'Unnamed place';
  const context = [p.name && p.city && p.city !== p.name ? p.city : undefined, p.state, p.country]
    .filter((s): s is string => !!s && s !== name);
  const label = context.length ? `${name}, ${context.join(', ')}` : name;
  return {
    id: `photon:${p.osm_type ?? ''}${p.osm_id ?? `${f.geometry.coordinates.join(',')}`}`,
    name,
    label,
    coordinate: f.geometry.coordinates,
    kind: p.type ?? p.osm_value,
  };
}
