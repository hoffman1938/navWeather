import type { LngLat } from '../../types/geo';
import { fetchJson } from '../http';

export interface AirQuality {
  /** European AQI (0 good … 100+ extremely poor). */
  europeanAqi: number;
  observedAt: number;
}

export interface AirQualityProvider {
  readonly name: string;
  current(coordinate: LngLat, signal?: AbortSignal): Promise<AirQuality | null>;
}

/** Open-Meteo Air Quality API (CAMS), free, no key. Cached ~30 min per ~5 km cell. */
export class OpenMeteoAirQualityProvider implements AirQualityProvider {
  readonly name = 'open-meteo-air';
  private cache = new Map<string, { at: number; value: AirQuality | null }>();

  constructor(private baseUrl: string) {}

  async current([lon, lat]: LngLat, signal?: AbortSignal): Promise<AirQuality | null> {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.value;
    const params = new URLSearchParams({ latitude: lat.toFixed(2), longitude: lon.toFixed(2), current: 'european_aqi', timeformat: 'unixtime' });
    const data = await fetchJson<{ current?: { time?: number; european_aqi?: number | null } }>(`${this.baseUrl.replace(/\/$/, '')}/v1/air-quality?${params}`, {
      provider: 'Air quality service',
      signal,
      timeoutMs: 8000,
    });
    const aqi = data.current?.european_aqi;
    const value = typeof aqi === 'number' && Number.isFinite(aqi) ? { europeanAqi: Math.round(aqi), observedAt: (data.current?.time ?? Date.now() / 1000) * 1000 } : null;
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}

export type AqiLevel = 'good' | 'fair' | 'moderate' | 'poor' | 'veryPoor' | 'extremelyPoor';

/** European AQI bands (EEA). */
export function aqiLevel(aqi: number): AqiLevel {
  if (aqi <= 20) return 'good';
  if (aqi <= 40) return 'fair';
  if (aqi <= 60) return 'moderate';
  if (aqi <= 80) return 'poor';
  if (aqi <= 100) return 'veryPoor';
  return 'extremelyPoor';
}
