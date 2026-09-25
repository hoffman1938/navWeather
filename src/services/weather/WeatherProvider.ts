import type { LocationForecast } from '../../types/weather';

export interface ForecastLocation {
  /** Spatial cache key (see utils/cache.spatialKey). */
  key: string;
  latitude: number;
  longitude: number;
}

export interface ForecastRequest {
  locations: ForecastLocation[];
  /** Hours of forecast needed from the current hour. */
  forecastHours: number;
  /** Hours of history to include (so "now" is always bracketed). */
  pastHours: number;
  signal?: AbortSignal;
}

/**
 * Weather provider contract: hourly forecasts for many locations, returned
 * as normalized `LocationForecast`s in the same order as `locations`.
 */
export interface WeatherProvider {
  readonly name: string;
  /** Maximum locations the provider accepts in one request. */
  readonly maxLocationsPerRequest: number;
  getForecasts(request: ForecastRequest): Promise<LocationForecast[]>;
  /**
   * When the newest forecast data became available upstream (UTC ms), if the
   * provider exposes model-run metadata. Lets the app refresh as soon as a new
   * forecast exists instead of only on a timer.
   */
  getLatestUpdateTime?(signal?: AbortSignal): Promise<number | null>;
}
