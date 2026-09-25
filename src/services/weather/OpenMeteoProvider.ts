import type { LocationForecast } from '../../types/weather';
import { fetchJson, ProviderError } from '../http';
import { normalizeWmoCode } from './weatherCodes';
import type { ForecastRequest, WeatherProvider } from './WeatherProvider';

const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'rain',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'visibility',
  'relative_humidity_2m',
] as const;

type HourlyVar = (typeof HOURLY_VARS)[number];

// Raw response (never leaves this file).
interface OpenMeteoLocation {
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone: string;
  utc_offset_seconds: number;
  hourly: { time: number[] } & Partial<Record<HourlyVar, (number | null)[]>>;
}

/** Open-Meteo — free, no API key, many locations per request. */
export class OpenMeteoProvider implements WeatherProvider {
  readonly name = 'open-meteo';

  constructor(
    private baseUrl: string,
    readonly maxLocationsPerRequest = 50,
    private timeoutMs = 15000,
    /** Global models whose new runs change the default "best match" forecast. */
    private updateModels: string[] = ['ecmwf_ifs025', 'dwd_icon', 'ncep_gfs025'],
  ) {}

  /** Newest `last_run_availability_time` across the tracked models (UTC ms). */
  async getLatestUpdateTime(signal?: AbortSignal): Promise<number | null> {
    const base = this.baseUrl.replace(/\/$/, '');
    const times = await Promise.all(
      this.updateModels.map((m) =>
        fetchJson<{ last_run_availability_time?: number }>(`${base}/data/${m}/static/meta.json`, {
          provider: 'Weather service',
          signal,
          timeoutMs: 8000,
        }).then(
          (d) => (typeof d.last_run_availability_time === 'number' ? d.last_run_availability_time * 1000 : null),
          () => null,
        ),
      ),
    );
    const valid = times.filter((t): t is number => t !== null);
    return valid.length ? Math.max(...valid) : null;
  }

  async getForecasts(req: ForecastRequest): Promise<LocationForecast[]> {
    if (req.locations.length === 0) return [];
    if (req.locations.length > this.maxLocationsPerRequest) {
      throw new Error(`Open-Meteo batch too large (${req.locations.length})`);
    }
    const params = new URLSearchParams({
      latitude: req.locations.map((l) => l.latitude.toFixed(4)).join(','),
      longitude: req.locations.map((l) => l.longitude.toFixed(4)).join(','),
      hourly: HOURLY_VARS.join(','),
      timezone: 'auto',
      timeformat: 'unixtime',
      wind_speed_unit: 'kmh',
      past_hours: String(Math.max(0, Math.round(req.pastHours))),
      forecast_hours: String(Math.max(1, Math.round(req.forecastHours))),
    });
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/forecast?${params}`;
    const data = await fetchJson<OpenMeteoLocation | OpenMeteoLocation[]>(url, {
      provider: 'Weather service',
      signal: req.signal,
      timeoutMs: this.timeoutMs,
    });
    const list = Array.isArray(data) ? data : [data];
    if (list.length !== req.locations.length) {
      throw new ProviderError('Weather service returned an unexpected number of locations', 'invalid-response', 'Weather service');
    }
    const fetchedAt = Date.now();
    return list.map((raw, i) => normalize(raw, req.locations[i], fetchedAt));
  }
}

/** Exported for tests. */
export function normalize(
  raw: OpenMeteoLocation,
  loc: { key: string; latitude: number; longitude: number },
  fetchedAt: number,
): LocationForecast {
  const h = raw.hourly;
  if (!h || !Array.isArray(h.time)) {
    throw new ProviderError('Weather response missing hourly data', 'invalid-response', 'Weather service');
  }
  const n = h.time.length;
  const col = (k: HourlyVar): (number | null)[] => {
    const arr = h[k];
    return Array.isArray(arr) && arr.length === n ? arr : new Array(n).fill(null);
  };
  const codes = col('weather_code').map(normalizeWmoCode);
  return {
    locationKey: loc.key,
    latitude: loc.latitude,
    longitude: loc.longitude,
    elevationM: raw.elevation,
    timezone: raw.timezone,
    times: h.time.map((t) => t * 1000),
    hourly: {
      temperature: col('temperature_2m'),
      apparentTemperature: col('apparent_temperature'),
      precipitationProbability: col('precipitation_probability'),
      precipitation: col('precipitation'),
      rain: col('rain'),
      snowfall: col('snowfall'),
      condition: codes.map((c) => c?.condition ?? null),
      description: codes.map((c) => c?.description ?? null),
      cloudCover: col('cloud_cover'),
      windSpeed: col('wind_speed_10m'),
      windGusts: col('wind_gusts_10m'),
      windDirection: col('wind_direction_10m'),
      visibility: col('visibility'),
      humidity: col('relative_humidity_2m'),
    },
    provider: 'open-meteo',
    fetchedAt,
  };
}
