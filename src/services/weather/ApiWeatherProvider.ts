import type { LocationForecast } from '../../types/weather';
import { fetchJson, isAbortError, ProviderError } from '../http';
import { forecastParams, normalize, type OpenMeteoLocation } from './OpenMeteoProvider';
import type { ForecastLocation, ForecastRequest, WeatherProvider } from './WeatherProvider';

type Answer = (OpenMeteoLocation & { missing?: undefined }) | { latitude: number; longitude: number; timezone?: string; missing: true };

/**
 * Our forecast (`/api/v1/weather`, DEVELOPMENT_PLAN DP-4.6, DP-6.6): anywhere on Earth, built from open model data
 * (ECMWF IFS, NOAA GFS) — the same query and answer as Open-Meteo, so one reader serves both. The coordinates go to
 * our Worker only. The `fallback` (the public Open-Meteo API, while VITE_WEATHER_FALLBACK allows it) answers only
 * where our data are not there: not built on this machine, too old, the Worker down, or a point far out at sea.
 */
export class ApiWeatherProvider implements WeatherProvider {
  readonly name = 'navweather';

  constructor(
    private baseUrl: string,
    private fallback: WeatherProvider | null,
    readonly maxLocationsPerRequest = 50,
    private timeoutMs = 15000,
  ) {}

  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }

  /** When our current forecast became available — or the fallback's, while ours is missing or old. */
  async getLatestUpdateTime(signal?: AbortSignal): Promise<number | null> {
    const meta = await fetchJson<{ last_run_availability_time?: number; fresh?: boolean }>(`${this.base}/meta`, {
      provider: 'Weather service',
      signal,
      timeoutMs: 8000,
    }).catch(() => null);
    if (meta?.fresh !== false && typeof meta?.last_run_availability_time === 'number') return meta.last_run_availability_time * 1000;
    return this.fallback?.getLatestUpdateTime ? this.fallback.getLatestUpdateTime(signal) : null;
  }

  async getForecasts(req: ForecastRequest): Promise<LocationForecast[]> {
    if (req.locations.length === 0) return [];
    let data: Answer | Answer[];
    try {
      data = await fetchJson<Answer | Answer[]>(`${this.base}/forecast?${forecastParams(req)}`, {
        provider: 'Weather service',
        signal: req.signal,
        timeoutMs: this.timeoutMs,
      });
    } catch (e) {
      // No data here (503), the Worker down or unreachable: the fallback answers. A refused request (4xx) is not
      // the fallback's business — it would refuse it too, or it is a throttled client.
      if (isAbortError(e) || !this.fallback || !ourDataMissing(e)) throw e;
      return this.fallback.getForecasts(req);
    }
    const list = Array.isArray(data) ? data : [data];
    if (list.length !== req.locations.length) {
      throw new ProviderError('Weather service returned an unexpected number of locations', 'invalid-response', 'Weather service');
    }
    const fetchedAt = Date.now();
    const out = list.map((raw, i) => (raw.missing ? null : { ...normalize(raw, req.locations[i], fetchedAt), provider: this.name }));
    const missing = req.locations.filter((_, i) => !out[i]);
    if (!missing.length) return out as LocationForecast[];
    const extra = this.fallback
      ? await this.fallback.getForecasts({ ...req, locations: missing })
      : missing.map((loc) => noForecast(loc, list[req.locations.indexOf(loc)], fetchedAt));
    let j = 0;
    return out.map((f) => f ?? extra[j++]);
  }
}

function ourDataMissing(e: unknown): boolean {
  if (!(e instanceof ProviderError)) return true;
  if (e.kind === 'network' || e.kind === 'timeout' || e.kind === 'invalid-response') return true;
  return e.kind === 'http' && (e.status ?? 0) >= 500;
}

/** "No forecast here" without a fallback: an empty series (nothing matches it), never invented values. */
function noForecast(loc: ForecastLocation, raw: Answer, fetchedAt: number): LocationForecast {
  return {
    locationKey: loc.key,
    latitude: loc.latitude,
    longitude: loc.longitude,
    timezone: raw.timezone ?? 'UTC',
    times: [],
    hourly: {
      temperature: [],
      apparentTemperature: [],
      precipitationProbability: [],
      precipitation: [],
      rain: [],
      snowfall: [],
      condition: [],
      description: [],
      cloudCover: [],
      windSpeed: [],
      windGusts: [],
      windDirection: [],
      visibility: [],
      humidity: [],
    },
    provider: 'navweather',
    fetchedAt,
  };
}
