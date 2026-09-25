import { describe, expect, it } from 'vitest';
import { makeForecast } from '../test/helpers';
import { forecastConfidence, matchForecastToTime } from './weatherMatching';

const H = 3600_000;
const T0 = Date.UTC(2026, 8, 26, 6, 0); // 10:00 Tbilisi

// 10:00 cloudy 16°, 11:00 rain 18° (rain falls 10:00–11:00), 12:00 cloudy 20°
const forecast = makeForecast({
  startMs: T0,
  hours: 3,
  latitude: 42.0,
  longitude: 43.6,
  hourFn: (_t, i) =>
    [
      { temperature: 16, code: 3, precipitationProbability: 20, precipitation: 0, windSpeed: 10 },
      { temperature: 18, code: 63, precipitationProbability: 65, precipitation: 1.4, windSpeed: 20 },
      { temperature: 20, code: 3, precipitationProbability: 30, precipitation: 0, windSpeed: 30 },
    ][i],
});

describe('getWeatherForArrivalTime / matchForecastToTime', () => {
  it('interpolates instant numeric values (temperature, wind) at 10:37', () => {
    const w = matchForecastToTime(forecast, T0 + 37 * 60000)!;
    expect(w.temperature).toBeCloseTo(16 + 2 * (37 / 60), 1);
    expect(w.windSpeed).toBe(Math.round(10 + 10 * (37 / 60)));
  });

  it('never interpolates the condition — uses the nearest/relevant forecast state', () => {
    // 10:37 → nearest hour is 11:00 (rain)
    expect(matchForecastToTime(forecast, T0 + 37 * 60000)!.condition).toBe('RAIN');
    // 11:50 → nearest is 12:00 (cloudy): categorical, not blended
    expect(matchForecastToTime(forecast, T0 + 110 * 60000)!.condition).toBe('CLOUDY');
  });

  it('uses the forecast interval containing the arrival for precipitation', () => {
    // 10:05: the 10:00–11:00 interval (stored at 11:00) has rain 1.4 mm / 65 %
    const w = matchForecastToTime(forecast, T0 + 5 * 60000)!;
    expect(w.precipitation).toBe(1.4);
    expect(w.precipitationProbability).toBe(65);
    // …and the icon does not contradict it (escalated from cloudy to rain)
    expect(w.condition).toBe('RAIN');
    // 11:30 → interval 11:00–12:00 (stored at 12:00)
    expect(matchForecastToTime(forecast, T0 + 90 * 60000)!.precipitationProbability).toBe(30);
  });

  it('does not create artificial precision for probability', () => {
    const w = matchForecastToTime(forecast, T0 + 30 * 60000)!;
    expect(Number.isInteger(w.precipitationProbability)).toBe(true);
    expect([20, 65, 30]).toContain(w.precipitationProbability);
  });

  it('returns exact hourly values on the hour', () => {
    const w = matchForecastToTime(forecast, T0 + H)!;
    expect(w.temperature).toBe(18);
    expect(w.condition).toBe('RAIN');
    expect(w.forecastHourUtc).toBe(T0 + H);
  });

  it('refuses to extrapolate outside the forecast range', () => {
    expect(matchForecastToTime(forecast, T0 - 1)).toBeNull();
    expect(matchForecastToTime(forecast, T0 + 2 * H + 1)).toBeNull();
  });

  it('marks day/night from the sun at that place and time', () => {
    expect(matchForecastToTime(forecast, T0)!.isDay).toBe(true); // 10:00 local
    const night = makeForecast({ startMs: Date.UTC(2026, 8, 26, 19), hours: 2, latitude: 42, longitude: 43.6, hourFn: () => ({}) });
    expect(matchForecastToTime(night, Date.UTC(2026, 8, 26, 19, 30))!.isDay).toBe(false);
  });

  it('lowers confidence the further ahead the forecast is', () => {
    expect(forecastConfidence(2)).toBe('high');
    expect(forecastConfidence(30)).toBe('medium');
    expect(forecastConfidence(80)).toBe('low');
  });
});

describe('arrival-hour semantics (audit regressions)', () => {
  // 00:00 rain (00–01 had rain stored at 01:00), 01:00–02:00 dry.
  const f = makeForecast({
    startMs: T0,
    hours: 3,
    latitude: 42,
    longitude: 43.6,
    hourFn: (_t, i) =>
      [
        { temperature: 15, code: 3, precipitation: 0, windGusts: 20 },
        { temperature: 15, code: 61, precipitation: 0.8, precipitationProbability: 60, windGusts: 75 },
        { temperature: 15, code: 3, precipitation: 0, precipitationProbability: 5, windGusts: 25 },
      ][i],
  });

  it('never shows a rain icon for a dry arrival hour', () => {
    // 11:20 falls in 11:00–12:00 (stored at 12:00): dry.
    const w = matchForecastToTime(f, T0 + H + 20 * 60000)!;
    expect(w.condition).toBe('CLOUDY');
    expect(w.precipitation).toBe(0);
  });

  it('uses the hourly maximum for gusts, not an average', () => {
    // 10:30 falls in 10:00–11:00 whose gust maximum is 75 km/h.
    expect(matchForecastToTime(f, T0 + 30 * 60000)!.windGusts).toBe(75);
  });
});
