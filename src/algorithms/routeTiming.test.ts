import { describe, expect, it } from 'vitest';
import { rawTbilisiBatumi, tbilisiBatumiRoute, TBILISI, BATUMI } from '../test/helpers';
import { normalizeOsrmRoute } from '../services/routing/OSRMProvider';
import { buildTimedRoute, computeArrivals, distanceAtTime, timeAtDistance, whereAtTime } from './routeTiming';
import type { Route } from '../types/route';

const HOUR = 3600_000;

describe('route timing', () => {
  const timed = buildTimedRoute(tbilisiBatumiRoute());

  it('produces monotonic cumulative distance and time per vertex', () => {
    const { cumDistM, cumTimeS } = timed;
    expect(cumDistM[0]).toBe(0);
    expect(cumTimeS[0]).toBe(0);
    for (let i = 1; i < cumDistM.length; i++) {
      expect(cumDistM[i]).toBeGreaterThanOrEqual(cumDistM[i - 1]);
      expect(cumTimeS[i]).toBeGreaterThanOrEqual(cumTimeS[i - 1]);
    }
    expect(timed.totalTimeS).toBeCloseTo(timed.route.durationS, 1);
    // Haversine length within 1% of OSRM's reported distance
    expect(Math.abs(timed.totalDistM - timed.route.distanceM) / timed.route.distanceM).toBeLessThan(0.01);
  });

  it('does NOT assume constant speed when segment durations exist', () => {
    // City driving at the start is slower than the average speed.
    const avg = timed.totalDistM / timed.totalTimeS;
    const cityTime = timeAtDistance(timed, 10_000);
    expect(10_000 / cityTime).toBeLessThan(avg * 0.8);
    // A proportional model would give a different time for the first 10 km.
    expect(Math.abs(cityTime - 10_000 / avg)).toBeGreaterThan(120);
  });

  it('inverts time ↔ distance', () => {
    for (const s of [0, 600, 3600, 10_000, timed.totalTimeS]) {
      expect(timeAtDistance(timed, distanceAtTime(timed, s))).toBeCloseTo(s, 3);
    }
  });

  it('answers "where will the driver be at 10:30?"', () => {
    const depart = Date.UTC(2026, 8, 26, 4, 0); // 08:00 Tbilisi
    const at = Date.UTC(2026, 8, 26, 6, 30); // 10:30 Tbilisi
    const w = whereAtTime(timed, depart, at)!;
    expect(w.travelTimeS).toBe(2.5 * 3600);
    expect(w.distanceM).toBeGreaterThan(150_000);
    expect(w.distanceM).toBeLessThan(250_000);
    // Somewhere in western Georgia past Khashuri (lon 43.6)
    expect(w.coordinate[0]).toBeLessThan(43.6);
    expect(whereAtTime(timed, depart, depart - 1)).toBeNull();
    expect(whereAtTime(timed, depart, depart + 99 * HOUR)?.arrived).toBe(true);
  });

  it('prefers traffic-adjusted durations when a traffic provider sets them', () => {
    const route = tbilisiBatumiRoute();
    const slowed: Route = {
      ...route,
      segments: route.segments.map((s) => ({ ...s, currentDurationS: s.durationS * 1.5 })),
    };
    expect(buildTimedRoute(slowed).totalTimeS).toBeCloseTo(route.durationS * 1.5, 1);
  });

  it('proportional fallback divides time by distance', () => {
    const raw = rawTbilisiBatumi();
    delete (raw.legs[0] as { annotation?: unknown }).annotation;
    raw.legs[0].steps.forEach((s) => delete (s as { geometry?: unknown }).geometry);
    const t = buildTimedRoute(normalizeOsrmRoute(raw, { origin: TBILISI, destination: BATUMI }));
    const half = t.totalDistM / 2;
    expect(timeAtDistance(t, half)).toBeCloseTo(t.totalTimeS / 2, 0);
  });
});

describe('computeArrivals', () => {
  const samples = [
    { travelTimeS: 0 },
    { travelTimeS: 3600 },
    { travelTimeS: 7200 },
  ] as never[];

  it('planning: departure + cumulative travel time', () => {
    const d = Date.UTC(2026, 8, 26, 4, 0);
    expect(computeArrivals(samples, { mode: 'planning', departureMs: d })).toEqual([d, d + HOUR, d + 2 * HOUR]);
  });

  it('navigating: now + remaining time; passed samples keep their time', () => {
    const d = 0;
    const now = 5000 * 1000;
    const arr = computeArrivals(samples, { mode: 'navigating', nowMs: now, modelTimeS: 4000, departureMs: d });
    expect(arr[0]).toBe(0);
    expect(arr[1]).toBe(HOUR);
    expect(arr[2]).toBe(now + 3200 * 1000);
  });
});
