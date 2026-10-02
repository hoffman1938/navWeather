import { describe, expect, it } from 'vitest';
import { buildTimedRoute } from '../../algorithms/routeTiming';
import { BATUMI, TBILISI } from '../../test/helpers';
import { haversineM } from '../../utils/distance';
import { FLIGHT_CRUISE_KMH, FLIGHT_OVERHEAD_S, FlightEstimateProvider, greatCircle } from './FlightEstimateProvider';

describe('greatCircle', () => {
  it('starts and ends exactly at the two places and never strays from the great-circle length', () => {
    const pts = greatCircle(TBILISI.coordinate, BATUMI.coordinate);
    expect(pts[0]).toEqual(TBILISI.coordinate);
    expect(pts.at(-1)).toEqual(BATUMI.coordinate);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += haversineM(pts[i - 1], pts[i]);
    expect(len).toBeCloseTo(haversineM(TBILISI.coordinate, BATUMI.coordinate), -2);
  });

  it('is a curve on the globe: halfway between London and Tokyo passes far north of the straight map line', () => {
    const pts = greatCircle([-0.13, 51.5], [139.7, 35.7], 100_000);
    const mid = pts[Math.floor(pts.length / 2)];
    expect(mid[1]).toBeGreaterThan(60);
  });

  it('a very short hop and the same place both stay valid', () => {
    expect(greatCircle([44.8, 41.7], [44.8001, 41.7001]).length).toBe(2);
    expect(greatCircle([44.8, 41.7], [44.8, 41.7])).toEqual([[44.8, 41.7], [44.8, 41.7]]);
  });
});

describe('FlightEstimateProvider', () => {
  const provider = new FlightEstimateProvider();

  it('is an estimate: the straight line, 25 minutes on the ground, then 800 km/h', async () => {
    const [route] = await provider.calculateRoutes({ origin: TBILISI, destination: BATUMI });
    const straightKm = haversineM(TBILISI.coordinate, BATUMI.coordinate) / 1000;
    expect(route.distanceM / 1000).toBeCloseTo(straightKm, 0);
    expect(route.durationS).toBeCloseTo(FLIGHT_OVERHEAD_S + (route.distanceM / 1000 / FLIGHT_CRUISE_KMH) * 3600, 0);
    expect(route.durationS / 60).toBeGreaterThan(40); // Tbilisi → Batumi ≈ 45 min
    expect(route.durationS / 60).toBeLessThan(50);
    expect(route.provider).toBe('flight-estimate');
  });

  it('is a normal route to the rest of the app: timed, aligned steps, depart and arrive only', async () => {
    const [route] = await provider.calculateRoutes({ origin: TBILISI, destination: BATUMI });
    const timed = buildTimedRoute(route);
    expect(timed.totalTimeS).toBeCloseTo(route.durationS, 3);
    expect(timed.timingSource).toBe('proportional');
    const steps = route.legs[0].steps;
    expect(steps.map((s) => s.maneuverType)).toEqual(['depart', 'arrive']);
    expect(steps[0].fromIndex).toBe(0);
    expect(steps[1].toIndex).toBe(route.geometry.length - 1);
    expect(route.bbox[0]).toBeLessThanOrEqual(BATUMI.coordinate[0]);
    expect(route.bbox[2]).toBeGreaterThanOrEqual(TBILISI.coordinate[0]);
  });

  it('offers one route, no alternatives, no extras', async () => {
    const routes = await provider.calculateRoutes({ origin: TBILISI, destination: BATUMI, alternatives: true });
    expect(routes).toHaveLength(1);
    expect(provider.capabilities).toMatchObject({ alternatives: false, multiStop: false, matrix: false });
  });
});
