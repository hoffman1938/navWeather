import type { LngLat, Place } from '../../types/geo';
import { fetchJson, RateLimiter } from '../http';
import type { GeocodeOptions, GeocodingProvider } from './GeocodingProvider';

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  addresstype?: string;
  type?: string;
  address?: Record<string, string>;
}

/**
 * Nominatim (OpenStreetMap). Usage policy: ≤1 request/second, no
 * autocomplete, results cached by the client. Browsers send a Referer,
 * which satisfies the identification requirement for a prototype.
 */
export class NominatimProvider implements GeocodingProvider {
  readonly name = 'nominatim';
  private limiter: RateLimiter;
  private cache = new Map<string, Place | null>();

  constructor(
    private baseUrl: string,
    private language: string,
    minIntervalMs: number,
  ) {
    this.limiter = new RateLimiter(minIntervalMs);
  }

  async geocode(query: string, options: GeocodeOptions = {}): Promise<Place | null> {
    const q = query.trim();
    if (!q) return null;
    const key = `g:${q.toLowerCase()}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const params = new URLSearchParams({
      q,
      format: 'jsonv2',
      limit: '1',
      addressdetails: '1',
      'accept-language': this.language,
    });
    const results = await this.limiter.schedule(() =>
      fetchJson<NominatimResult[]>(`${this.base}/search?${params}`, {
        provider: 'Geocoding service',
        signal: options.signal,
      }),
    );
    const place = results[0] ? toPlace(results[0]) : null;
    this.cache.set(key, place);
    return place;
  }

  async reverse(coordinate: LngLat, options: GeocodeOptions = {}): Promise<Place | null> {
    const [lon, lat] = coordinate;
    const key = `r:${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const params = new URLSearchParams({
      lat: lat.toFixed(6),
      lon: lon.toFixed(6),
      format: 'jsonv2',
      zoom: '14',
      addressdetails: '1',
      'accept-language': this.language,
    });
    const result = await this.limiter.schedule(() =>
      fetchJson<NominatimResult & { error?: string }>(`${this.base}/reverse?${params}`, {
        provider: 'Geocoding service',
        signal: options.signal,
      }),
    );
    const place = result && !result.error ? toPlace(result, coordinate) : null;
    this.cache.set(key, place);
    return place;
  }

  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }
}

function toPlace(r: NominatimResult, exact?: LngLat): Place {
  const a = r.address ?? {};
  const settlement = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.municipality;
  const name = r.name || settlement || r.display_name.split(',')[0];
  const parts = r.display_name.split(',').map((s) => s.trim());
  const label = parts.length > 2 ? `${parts[0]}, ${parts[parts.length - 1]}` : r.display_name;
  return {
    id: `nominatim:${r.place_id}`,
    name,
    label,
    coordinate: exact ?? [Number(r.lon), Number(r.lat)],
    kind: r.addresstype ?? r.type,
  };
}
