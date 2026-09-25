import { describe, expect, it } from 'vitest';
import type { RouteWeatherPoint } from '../types/weather';
import { buildTimelineItems } from './timeline';

function p(id: string, utcMs: number, lon: number, isDay: boolean): RouteWeatherPoint {
  return {
    id,
    latitude: 41.9,
    longitude: lon,
    distanceFromStartKm: 0,
    estimatedTravelMinutes: 0,
    estimatedArrivalUtc: new Date(utcMs).toISOString(),
    arrivalMs: utcMs,
    localTime: '',
    timezone: 'Asia/Tbilisi',
    weather: { condition: 'CLEAR', temperature: 15, isDay, forecastHourUtc: utcMs },
    forecastLeadHours: 0,
    confidence: 'high',
    status: 'upcoming',
    reasons: [],
  };
}

describe('day / night timeline', () => {
  it('inserts a sunrise marker when the drive crosses dawn', () => {
    // 05:30 → 08:30 Tbilisi time on 26 Sep (sunrise ≈ 06:55)
    const items = buildTimelineItems([
      p('a', Date.UTC(2026, 8, 26, 1, 30), 44.8, false),
      p('b', Date.UTC(2026, 8, 26, 4, 30), 43.0, true),
    ]);
    expect(items.map((i) => i.type)).toEqual(['point', 'sun', 'point']);
    const sun = items[1] as Extract<(typeof items)[number], { type: 'sun' }>;
    expect(sun.kind).toBe('sunrise');
    expect(sun.localTime >= '06:40' && sun.localTime <= '07:15').toBe(true);
  });

  it('adds nothing for a drive entirely in daylight', () => {
    const items = buildTimelineItems([
      p('a', Date.UTC(2026, 8, 26, 6, 0), 44.8, true),
      p('b', Date.UTC(2026, 8, 26, 10, 0), 41.6, true),
    ]);
    expect(items.every((i) => i.type === 'point')).toBe(true);
  });
});
