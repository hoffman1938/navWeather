import { localizeScript } from '../../i18n/script';
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
    const lang = options.language ?? this.language;
    const key = `g:${lang}:${q.toLowerCase()}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const params = new URLSearchParams({
      q,
      format: 'jsonv2',
      limit: '1',
      addressdetails: '1',
      'accept-language': lang,
    });
    const results = await this.limiter.schedule(() =>
      fetchJson<NominatimResult[]>(`${this.base}/search?${params}`, {
        provider: 'Geocoding service',
        signal: options.signal,
      }),
    );
    const place = results[0] ? toPlace(results[0], lang) : null;
    this.cache.set(key, place);
    return place;
  }

  async reverse(coordinate: LngLat, options: GeocodeOptions = {}): Promise<Place | null> {
    const [lon, lat] = coordinate;
    const lang = options.language ?? this.language;
    const key = `r:${lang}:${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    // ~100 m precision is plenty for a street/town name; don't send exact GPS.
    const params = new URLSearchParams({
      lat: lat.toFixed(3),
      lon: lon.toFixed(3),
      format: 'jsonv2',
      zoom: '14',
      addressdetails: '1',
      'accept-language': lang,
    });
    const result = await this.limiter.schedule(() =>
      fetchJson<NominatimResult & { error?: string }>(`${this.base}/reverse?${params}`, {
        provider: 'Geocoding service',
        signal: options.signal,
      }),
    );
    const place = result && !result.error ? toPlace(result, lang, coordinate) : null;
    this.cache.set(key, place);
    return place;
  }

  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }
}

function validCoord(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function toPlace(r: NominatimResult, lang: string, exact?: LngLat): Place | null {
  const a = r.address ?? {};
  const settlement = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.municipality;
  const name = r.name || settlement || r.display_name.split(',')[0];
  const parts = r.display_name.split(',').map((s) => s.trim());
  const label = parts.length > 2 ? `${parts[0]}, ${parts[parts.length - 1]}` : r.display_name;
  const coordinate: LngLat = exact ?? [Number(r.lon), Number(r.lat)];
  if (!validCoord(coordinate[0], coordinate[1])) return null;
  return {
    id: `nominatim:${r.place_id}`,
    name: localizeScript(name, lang),
    label: localizeScript(label, lang),
    coordinate,
    kind: r.addresstype ?? r.type,
  };
}
