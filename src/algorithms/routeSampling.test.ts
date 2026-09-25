import { describe, expect, it } from 'vitest';
import { tbilisiBatumiPlaces, tbilisiBatumiRoute } from '../test/helpers';
import type { ElevationProfile, RouteSample } from '../types/route';
import type { WeatherAtTime } from '../types/weather';
import { snapPlacesToRoute } from './placesAlongRoute';
import {
  elevationExtrema,
  headingChangeDistances,
  nameSamples,
  refineSamplesForWeather,
  sampleRoute,
  samplingBudget,
} from './routeSampling';
import { buildTimedRoute, timeAtDistance } from './routeTiming';

const timed = buildTimedRoute(tbilisiBatumiRoute());
const places = snapPlacesToRoute(tbilisiBatumiPlaces(), timed);

describe('samplingBudget', () => {
  it.each([
    [10, 5, 10],
    [120, 10, 20],
    [358, 15, 30],
    [800, 25, 50],
  ])('%i km → between %i and %i points', (km, min, max) => {
    const b = samplingBudget(km);
    expect(b.min).toBe(min);
    expect(b.max).toBe(max);
    expect(b.target).toBeGreaterThanOrEqual(min);
    expect(b.target).toBeLessThanOrEqual(max);
  });

  it('scales adaptively above 1000 km with a cap', () => {
    expect(samplingBudget(1500).target).toBeGreaterThan(samplingBudget(1000).target);
    expect(samplingBudget(20000).target).toBeLessThanOrEqual(150);
  });
});

describe('places along route', () => {
  it('keeps settlements the road passes and drops far ones', () => {
    const names = places.map((p) => p.name);
    for (const n of ['Tbilisi', 'Gori', 'Khashuri', 'Zestaponi', 'Samtredia', 'Batumi']) {
      expect(names).toContain(n);
    }
    // Ozurgeti and Poti are off this route
    expect(names).not.toContain('Poti');
    // ordered along the route
    const gori = places.find((p) => p.name === 'Gori')!;
    const khashuri = places.find((p) => p.name === 'Khashuri')!;
    expect(gori.distanceAlongM).toBeLessThan(khashuri.distanceAlongM);
  });
});

describe('sampleRoute (Tbilisi → Batumi)', () => {
  const samples = sampleRoute({ timed, places, maxIntervalMinutes: 45 });

  it('stays within the 200–500 km budget — never every coordinate', () => {
    expect(samples.length).toBeGreaterThanOrEqual(15);
    expect(samples.length).toBeLessThanOrEqual(30);
    expect(samples.length).toBeLessThan(timed.route.geometry.length / 50);
  });

  it('includes origin and destination', () => {
    expect(samples[0].distanceM).toBe(0);
    expect(samples[0].reasons).toContain('origin');
    expect(samples[0].placeName).toBe('Tbilisi');
    const last = samples[samples.length - 1];
    expect(last.distanceM).toBeCloseTo(timed.totalDistM, 3);
    expect(last.reasons).toContain('destination');
    expect(last.placeName).toBe('Batumi');
  });

  it('anchors samples on settlements', () => {
    const named = samples.filter((s) => s.reasons.includes('settlement')).map((s) => s.placeName);
    expect(named).toEqual(expect.arrayContaining(['Gori', 'Khashuri']));
  });

  it('never leaves more than the max interval between samples', () => {
    for (let i = 1; i < samples.length; i++) {
      const gapS = samples[i].travelTimeS - samples[i - 1].travelTimeS;
      expect(gapS).toBeLessThanOrEqual(45 * 60 + 1);
    }
  });

  it('gives every sample a travel time consistent with the route timing', () => {
    for (const s of samples) {
      expect(s.travelTimeS).toBeCloseTo(timeAtDistance(timed, s.distanceM), 6);
    }
    const sorted = [...samples].sort((a, b) => a.distanceM - b.distanceM);
    expect(sorted.map((s) => s.id)).toEqual(samples.map((s) => s.id));
    expect(new Set(samples.map((s) => s.id)).size).toBe(samples.length);
  });

  it('names unnamed samples after the nearest settlement', () => {
    const named = nameSamples(samples, places, 15000);
    expect(named.filter((s) => s.placeName).length).toBeGreaterThan(samples.filter((s) => s.placeName).length - 1);
    const near = named.find((s) => s.placeRelation === 'near');
    expect(near?.placeName).toBeTruthy();
  });

  it('adds points at significant elevation changes (mountain pass)', () => {
    // Synthetic profile: climb to a 1000 m pass at 60 % of the route.
    const n = 50;
    const profile: ElevationProfile = {
      distancesM: Array.from({ length: n }, (_, i) => (timed.totalDistM * i) / (n - 1)),
      elevationsM: Array.from({ length: n }, (_, i) => 300 + 700 * Math.exp(-(((i - 30) / 4) ** 2))),
    };
    const ext = elevationExtrema(profile, 200);
    expect(ext.map((e) => e.kind)).toContain('peak');
    const withElev = sampleRoute({ timed, places: [], elevation: profile });
    expect(withElev.some((s) => s.reasons.includes('elevation'))).toBe(true);
  });

  it('works for short routes (<50 km): 5–10 points', () => {
    const short = buildTimedRoute({
      ...timed.route,
      id: 'short',
      geometry: timed.route.geometry.slice(0, 400),
      segments: timed.route.segments.slice(0, 399),
      legs: [],
    });
    expect(short.totalDistM).toBeLessThan(50_000);
    const s = sampleRoute({ timed: short });
    expect(s.length).toBeGreaterThanOrEqual(5);
    expect(s.length).toBeLessThanOrEqual(10);
  });
});

describe('refineSamplesForWeather', () => {
  const samples = sampleRoute({ timed, places });
  const w = (condition: WeatherAtTime['condition'], temperature: number, p = 0): WeatherAtTime => ({
    condition,
    temperature,
    precipitationProbability: p,
    isDay: true,
    forecastHourUtc: 0,
  });

  it('adds a midpoint only where neighbouring weather differs a lot', () => {
    const weather = new Map<string, WeatherAtTime>();
    samples.forEach((s: RouteSample, i) => weather.set(s.id, i < 8 ? w('CLOUDY', 18, 10) : w('RAIN', 16, 80)));
    const extra = refineSamplesForWeather(samples, weather, timed, { maxAdditional: 10, minGapM: 2000 });
    expect(extra).toHaveLength(1);
    expect(extra[0].reasons).toEqual(['weather-change']);
    expect(extra[0].distanceM).toBeGreaterThan(samples[7].distanceM);
    expect(extra[0].distanceM).toBeLessThan(samples[8].distanceM);
  });

  it('adds nothing when the weather is uniform', () => {
    const weather = new Map(samples.map((s) => [s.id, w('CLOUDY', 18)]));
    expect(refineSamplesForWeather(samples, weather, timed, { maxAdditional: 10, minGapM: 2000 })).toHaveLength(0);
  });
});

describe('route geometry changes', () => {
  // Synthetic L-shaped road: 60 km east along 42°N, then 60 km north.
  function lRoute() {
    const geometry: [number, number][] = [];
    const kmLon = 1 / (111.32 * Math.cos((42 * Math.PI) / 180));
    for (let k = 0; k <= 60; k++) geometry.push([42 + k * kmLon, 42]);
    for (let k = 1; k <= 60; k++) geometry.push([42 + 60 * kmLon, 42 + k / 111.2]);
    const base = tbilisiBatumiRoute();
    return buildTimedRoute({
      ...base,
      id: 'L',
      geometry,
      legs: [],
      distanceM: 120_000,
      durationS: 5400,
      segmentSource: 'proportional',
      segments: [{ fromIndex: 0, toIndex: geometry.length - 1, distanceM: 120_000, durationS: 5400 }],
    });
  }

  it.each([10_000, 8_000, 13_000])('finds the corner with %i m windows (aligned or not)', (w) => {
    const turns = headingChangeDistances(lRoute(), w);
    expect(turns).toHaveLength(1);
    expect(Math.abs(turns[0] - 60_000)).toBeLessThanOrEqual(w);
  });

  it('ignores a straight road', () => {
    const t = lRoute();
    const straight = buildTimedRoute({
      ...t.route,
      geometry: t.route.geometry.slice(0, 61),
      segments: [{ fromIndex: 0, toIndex: 60, distanceM: 60_000, durationS: 2700 }],
    });
    expect(headingChangeDistances(straight, 10_000)).toHaveLength(0);
  });

  it('places a sample at the corner', () => {
    const samples = sampleRoute({ timed: lRoute(), maxIntervalMinutes: 45 });
    const corner = samples.find((s) => s.reasons.includes('turn'));
    expect(corner).toBeDefined();
    expect(Math.abs(corner!.distanceM - 60_000)).toBeLessThan(12_000);
  });
});
