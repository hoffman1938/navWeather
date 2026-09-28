import { describe, expect, it } from 'vitest';
import { buildTimedRoute, timeAtDistance } from '../algorithms/routeTiming';
import type { RouteWeatherPoint } from '../types/weather';
import { solarPosition } from '../utils/sun';
import { en } from '../i18n/en';
import { tbilisiBatumiRoute } from '../test/helpers';
import { buildRouteIntelligence, type IntelligenceInput } from './routeIntelligence';

const timed = buildTimedRoute(tbilisiBatumiRoute());

function input(patch: Partial<IntelligenceInput>): IntelligenceInput {
  return {
    timed,
    maneuvers: [],
    progressM: 0,
    clock: { mode: 'planning', departureMs: Date.UTC(2026, 8, 26, 4) },
    weatherPoints: [],
    currentPoint: null,
    weatherPrefs: { level: 'all', types: { rain: true, snow: true, fog: true, wind: true, temperature: true } },
    speedLimits: null,
    fuelRangeKm: null,
    m: en,
    units: { distance: 'metric', temperature: 'c', wind: 'kmh' },
    ...patch,
  };
}

describe('range-based stop advice (user-entered only)', () => {
  it('suggests nothing without a range', () => {
    const r = buildRouteIntelligence(input({}));
    expect(r.events.some((e) => e.type === 'FUEL_STOP' || e.type === 'CHARGE_STOP')).toBe(false);
  });

  it('suggests nothing when the range covers the trip', () => {
    const r = buildRouteIntelligence(input({ fuelRangeKm: 600 }));
    expect(r.events.some((e) => e.category === 'fuel')).toBe(false);
  });

  it('fuel: a stop at 70% of the declared range', () => {
    const r = buildRouteIntelligence(input({ fuelRangeKm: 200 }));
    const stop = r.events.find((e) => e.type === 'FUEL_STOP')!;
    expect(stop.distanceAlongM).toBeCloseTo(140_000, -3);
    expect(stop.voiceMessage).toBe('Consider a fuel stop: gas station, 140 kilometers ahead.');
    expect(stop.source).toBe('user-range');
  });

  it('EV: the same rule produces charging advice', () => {
    const r = buildRouteIntelligence(input({ fuelRangeKm: 200, vehicle: 'ev' }));
    expect(r.events.some((e) => e.type === 'FUEL_STOP')).toBe(false);
    const stop = r.events.find((e) => e.type === 'CHARGE_STOP')!;
    expect(stop).toMatchObject({ category: 'charging', icon: 'charging', title: 'Charging stop' });
    expect(stop.voiceMessage).toBe('Consider charging within the next 140 kilometers.');
  });
});

describe('break reminders', () => {
  it('about every 2 hours of driving on a long trip, low severity (never spoken over navigation)', () => {
    const r = buildRouteIntelligence(input({}));
    const breaks = r.events.filter((e) => e.type === 'REST_BREAK');
    expect(timed.totalTimeS).toBeGreaterThan(4 * 3600);
    expect(breaks.length).toBe(Math.floor((timed.totalTimeS - 1800) / 7200));
    expect(breaks[0].estimatedMinutesFromCurrent).toBe(120);
    expect(breaks.every((b) => b.severity === 'low')).toBe(true);
  });

  it('can be turned off, and passed breaks disappear', () => {
    expect(buildRouteIntelligence(input({ breakReminders: false })).events.some((e) => e.type === 'REST_BREAK')).toBe(false);
    const late = buildRouteIntelligence(input({ progressM: timed.totalDistM * 0.9 }));
    expect(late.events.some((e) => e.type === 'REST_BREAK')).toBe(false);
  });
});

describe('sun and clock events', () => {
  const pts = (tz: (i: number) => string, cond: 'CLEAR' | 'CLOUDY') =>
    Array.from({ length: 12 }, (_, i) => {
      const d = (i / 11) * timed.totalDistM;
      return {
        id: `p${i}`,
        distanceFromStartKm: d / 1000,
        arrivalMs: Date.UTC(2026, 8, 26, 4) + timeAtDistance(timed, d) * 1000,
        timezone: tz(i),
        placeName: i === 9 ? 'Samtredia' : undefined,
        weather: { condition: cond, temperature: 20, cloudCover: cond === 'CLEAR' ? 5 : 95, isDay: true },
      } as unknown as RouteWeatherPoint;
    });

  it('sun position: east in the morning, south at noon, west in the evening (Tbilisi)', () => {
    const at = (h: number) => solarPosition(41.7, 44.8, Date.UTC(2026, 8, 26, h));
    expect(at(3).azimuthDeg).toBeGreaterThan(70); // ~07:00 local
    expect(at(3).azimuthDeg).toBeLessThan(110);
    expect(Math.abs(at(9).azimuthDeg - 180)).toBeLessThan(25); // ~13:00 local
    expect(at(14).azimuthDeg).toBeGreaterThan(250); // ~18:00 local
  });

  it('driving west towards a low sun under a clear sky: one glare notice; none when overcast', () => {
    // Leave Tbilisi 13:10 UTC (17:10 local, late September): the western half is driven into the setting sun.
    const clock = { mode: 'planning' as const, departureMs: Date.UTC(2026, 8, 26, 13, 10) };
    const clear = buildRouteIntelligence(input({ clock, weatherPoints: pts(() => 'Asia/Tbilisi', 'CLEAR') }));
    const glare = clear.events.filter((e) => e.type === 'SUN_GLARE');
    expect(glare.length).toBeGreaterThan(0);
    expect(glare[0].severity).toBe('medium');
    expect(glare[0].voiceMessage).toMatch(/^Low sun ahead in about/);
    const cloudy = buildRouteIntelligence(input({ clock, weatherPoints: pts(() => 'Asia/Tbilisi', 'CLOUDY') }));
    expect(cloudy.events.some((e) => e.type === 'SUN_GLARE')).toBe(false);
    const midday = buildRouteIntelligence(input({ clock: { mode: 'planning', departureMs: Date.UTC(2026, 8, 26, 6) }, weatherPoints: pts(() => 'Asia/Tbilisi', 'CLEAR') }));
    expect(midday.events.some((e) => e.type === 'SUN_GLARE')).toBe(false);
  });

  it('a time zone change on the route (e.g. Georgia → Turkey) says which way the clocks go', () => {
    const r = buildRouteIntelligence(input({ weatherPoints: pts((i) => (i < 8 ? 'Asia/Tbilisi' : 'Europe/Istanbul'), 'CLOUDY') }));
    const tz = r.events.filter((e) => e.type === 'TIMEZONE_CHANGE');
    expect(tz).toHaveLength(1);
    expect(tz[0].shortMessage).toBe('Clocks go back 1 h · GMT+3');
    expect(tz[0].severity).toBe('low');
  });
});
