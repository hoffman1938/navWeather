import type { ForecastConfidence, LocationForecast, WeatherAtTime, WeatherCondition } from '../types/weather';
import { lowerIndex } from '../utils/distance';
import { HOUR_MS } from '../utils/time';
import { isDaylight } from '../utils/sun';

/**
 * WEATHER ↔ ARRIVAL-TIME MATCHING — the heart of the product.
 *
 * Given an hourly forecast for a location and the moment the vehicle is
 * expected to be there, derive the weather for that moment:
 *
 *  - Instant numeric values (temperature, feels-like, wind, humidity,
 *    cloud cover, visibility) are linearly interpolated between the two
 *    bracketing forecast hours — only when both exist and are ≤1 h apart.
 *  - Interval values (precipitation, rain, snowfall, precipitation
 *    probability) describe the hour *ending* at their timestamp, so the
 *    value for an arrival at 10:37 is the 11:00 entry (10:00–11:00). They
 *    are never interpolated — that would invent precision the forecast
 *    does not have.
 *  - Categorical values (condition/icon) are never interpolated. They come
 *    from the same forecast hour as precipitation — the hour containing the
 *    arrival. Open-Meteo derives the weather code from that hour's
 *    precipitation, so the icon never contradicts "0 mm" or "Rain 2 mm".
 *  - Wind gusts are the maximum over the preceding hour, so they are also
 *    taken from the hour containing the arrival (never averaged down).
 *  - Arrivals outside the forecast range return null — no extrapolation.
 */
export function matchForecastToTime(forecast: LocationForecast, arrivalMs: number): WeatherAtTime | null {
  const { times, hourly } = forecast;
  const n = times.length;
  if (n === 0 || !Number.isFinite(arrivalMs)) return null;
  if (arrivalMs < times[0] || arrivalMs > times[n - 1]) return null;

  const k = lowerIndex(times, arrivalMs);
  const hasNext = k + 1 < n && times[k + 1] - times[k] <= HOUR_MS + 1000;
  const frac = hasNext ? (arrivalMs - times[k]) / (times[k + 1] - times[k]) : 0;

  // Instant values: controlled linear interpolation.
  const instant = (arr: (number | null)[]): number | undefined => {
    const a = arr[k];
    const b = hasNext ? arr[k + 1] : null;
    if (a !== null && a !== undefined && b !== null && b !== undefined) return a + (b - a) * frac;
    if (frac < 0.5) return a ?? b ?? undefined;
    return b ?? a ?? undefined;
  };

  // Interval values: the hour that contains the arrival.
  const intervalIdx = arrivalMs === times[k] || !hasNext ? k : k + 1;
  const interval = (arr: (number | null)[]): number | undefined => arr[intervalIdx] ?? undefined;

  // Categorical: the hour containing the arrival (consistent with precipitation).
  const nearestIdx = hasNext && frac >= 0.5 ? k + 1 : k;
  const condIdx = hourly.condition[intervalIdx] ? intervalIdx : nearestIdx;
  const condition = hourly.condition[condIdx] ?? null;

  const temperature = instant(hourly.temperature);
  if (temperature === undefined || condition === null) return null;

  const round1 = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 10) / 10);
  const round0 = (v: number | undefined) => (v === undefined ? undefined : Math.round(v));

  return {
    temperature: Math.round(temperature * 10) / 10,
    feelsLike: round1(instant(hourly.apparentTemperature)),
    condition,
    description: hourly.description[condIdx] ?? undefined,
    precipitationProbability: round0(interval(hourly.precipitationProbability)),
    precipitation: round1(interval(hourly.precipitation)),
    rain: round1(interval(hourly.rain)),
    snowfall: round1(interval(hourly.snowfall)),
    windSpeed: round0(instant(hourly.windSpeed)),
    windGusts: round0(interval(hourly.windGusts)),
    windDirection: round0(hourly.windDirection[nearestIdx] ?? undefined),
    visibility: round0(instant(hourly.visibility)),
    cloudCover: round0(instant(hourly.cloudCover)),
    humidity: round0(instant(hourly.humidity)),
    isDay: isDaylight(forecast.latitude, forecast.longitude, arrivalMs),
    forecastHourUtc: times[condIdx],
  };
}

export function isPrecipitating(c: WeatherCondition): boolean {
  return c === 'RAIN' || c === 'HEAVY_RAIN' || c === 'SNOW' || c === 'SLEET' || c === 'THUNDERSTORM';
}

/** How far ahead the forecast reaches → how much to trust it. */
export function forecastConfidence(leadHours: number): ForecastConfidence {
  if (leadHours <= 12) return 'high';
  if (leadHours <= 48) return 'medium';
  return 'low';
}
