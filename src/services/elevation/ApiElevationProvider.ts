import type { LngLat } from '../../types/geo';
import { fetchJson, isAbortError, ProviderError } from '../http';
import type { ElevationProvider } from './ElevationProvider';

/**
 * Ground heights from OUR DEM (`/api/v1/elevation`, Copernicus GLO-90 tiles — DEVELOPMENT_PLAN DP-4.7, DP-6.6): route
 * profiles and passes without the Open-Meteo Elevation API. The `fallback` (Open-Meteo, while VITE_ELEVATION_FALLBACK
 * allows it) answers only the points our tiles don't cover, or everything when our Worker can't answer.
 */
export class ApiElevationProvider implements ElevationProvider {
  readonly name = 'navweather-elevation';

  constructor(
    private url: string,
    private fallback: ElevationProvider | null,
  ) {}

  async getElevations(coords: LngLat[], signal?: AbortSignal): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < coords.length; i += 100) out.push(...(await this.batch(coords.slice(i, i + 100), signal)));
    return out;
  }

  private async batch(batch: LngLat[], signal?: AbortSignal): Promise<number[]> {
    const params = new URLSearchParams({
      latitude: batch.map((c) => c[1].toFixed(5)).join(','),
      longitude: batch.map((c) => c[0].toFixed(5)).join(','),
    });
    let ours: (number | null)[];
    try {
      const data = await fetchJson<{ elevation?: (number | null)[] }>(`${this.url}?${params}`, { provider: 'Elevation service', signal, timeoutMs: 8000 });
      if (!Array.isArray(data.elevation) || data.elevation.length !== batch.length) {
        throw new ProviderError('Unexpected elevation response', 'invalid-response', 'Elevation service');
      }
      ours = data.elevation;
    } catch (e) {
      if (isAbortError(e) || !this.fallback) throw e;
      return this.fallback.getElevations(batch, signal);
    }
    const missing = batch.filter((_, i) => ours[i] === null);
    if (!missing.length) return ours as number[];
    if (!this.fallback) throw new ProviderError('No elevation data here', 'not-found', 'Elevation service');
    const theirs = await this.fallback.getElevations(missing, signal);
    let j = 0;
    return ours.map((v) => v ?? theirs[j++]);
  }
}
