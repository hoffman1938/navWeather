import { describe, expect, it } from 'vitest';
import { buildTimedRoute } from '../algorithms/routeTiming';
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
