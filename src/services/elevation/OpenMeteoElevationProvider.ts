import type { LngLat } from '../../types/geo';
import { fetchJson, ProviderError } from '../http';
import type { ElevationProvider } from './ElevationProvider';

/** Open-Meteo elevation API (90 m DEM), up to 100 coordinates per request. */
export class OpenMeteoElevationProvider implements ElevationProvider {
  readonly name = 'open-meteo-elevation';

  constructor(private baseUrl: string) {}

  async getElevations(coords: LngLat[], signal?: AbortSignal): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < coords.length; i += 100) {
      const batch = coords.slice(i, i + 100);
      const params = new URLSearchParams({
        latitude: batch.map((c) => c[1].toFixed(4)).join(','),
        longitude: batch.map((c) => c[0].toFixed(4)).join(','),
      });
      const data = await fetchJson<{ elevation: number[] }>(
        `${this.baseUrl.replace(/\/$/, '')}/v1/elevation?${params}`,
        { provider: 'Elevation service', signal, timeoutMs: 8000 },
      );
      if (!Array.isArray(data.elevation) || data.elevation.length !== batch.length) {
        throw new ProviderError('Unexpected elevation response', 'invalid-response', 'Elevation service');
      }
      out.push(...data.elevation);
    }
    return out;
  }
}
