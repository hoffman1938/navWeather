import { describe, expect, it } from 'vitest';
import type { LngLat } from '../types/geo';
import {
  bearingDelta,
  bearingDeg,
  cumulativeDistances,
  destinationPoint,
  haversineM,
  lowerIndex,
  pointAtDistance,
  projectOntoLine,
  sliceLine,
} from './distance';

describe('haversineM', () => {
  it('matches known great-circle distances', () => {
    // Tbilisi ↔ Batumi straight line ≈ 264 km
    const d = haversineM([44.8015, 41.6935], [41.636, 41.651]);
    expect(d / 1000).toBeGreaterThan(260);
    expect(d / 1000).toBeLessThan(268);
    // 1° of latitude ≈ 111.2 km
    expect(haversineM([0, 0], [0, 1]) / 1000).toBeCloseTo(111.2, 0);
  });

  it('is zero for identical points and symmetric', () => {
    expect(haversineM([10, 10], [10, 10])).toBe(0);
    const a: LngLat = [44.8, 41.7];
    const b: LngLat = [43.6, 42.0];
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });
});

describe('cumulativeDistances', () => {
  it('accumulates segment lengths', () => {
    const line: LngLat[] = [
      [0, 0],
      [0, 1],
      [0, 2],
    ];
    const cum = cumulativeDistances(line);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeCloseTo(haversineM([0, 0], [0, 1]), 6);
    expect(cum[2]).toBeCloseTo(2 * cum[1], 3);
  });
});

describe('lowerIndex', () => {
  it('finds the bracketing index', () => {
    const arr = [0, 10, 20, 30];
    expect(lowerIndex(arr, -5)).toBe(0);
    expect(lowerIndex(arr, 0)).toBe(0);
    expect(lowerIndex(arr, 15)).toBe(1);
    expect(lowerIndex(arr, 20)).toBe(2);
    expect(lowerIndex(arr, 99)).toBe(3);
  });
});

describe('pointAtDistance / projectOntoLine', () => {
  const line: LngLat[] = [
    [0, 0],
    [0, 1],
    [1, 1],
  ];
  const cum = cumulativeDistances(line);

  it('interpolates along the polyline', () => {
    const mid = pointAtDistance(line, cum, cum[1] / 2);
    expect(mid.coordinate[0]).toBeCloseTo(0, 6);
    expect(mid.coordinate[1]).toBeCloseTo(0.5, 6);
    expect(pointAtDistance(line, cum, 1e12).coordinate).toEqual([1, 1]);
    expect(pointAtDistance(line, cum, -5).coordinate).toEqual([0, 0]);
  });

  it('projects a point onto the nearest segment', () => {
    const p = projectOntoLine(line, cum, [0.001, 0.5]);
    expect(p.index).toBe(0);
    expect(p.distanceFromLineM).toBeCloseTo(111, -1);
    expect(p.distanceAlongM).toBeCloseTo(cum[1] / 2, -2);
  });

  it('respects a search window', () => {
    const p = projectOntoLine(line, cum, [0.001, 0.5], 1, 2);
    expect(p.index).toBe(1);
  });

  it('slices between distances', () => {
    const s = sliceLine(line, cum, cum[1] / 2, cum[1] + 1000);
    expect(s[0][1]).toBeCloseTo(0.5, 5);
    expect(s).toHaveLength(3);
  });
});

describe('bearingDeg', () => {
  it('points north / east correctly', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 3);
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 3);
  });
});

describe('destinationPoint', () => {
  const tbilisi: LngLat = [44.8, 41.69];

  it('lands the asked distance away, in the asked direction', () => {
    for (const [bearing, dist] of [[0, 10_000], [90, 25_000], [180, 40_000], [270, 6_000], [45, 100_000]] as const) {
      const p = destinationPoint(tbilisi, bearing, dist);
      expect(haversineM(tbilisi, p)).toBeCloseTo(dist, -1);
      expect(bearingDelta(bearingDeg(tbilisi, p), bearing)).toBeLessThan(0.5);
    }
  });

  it('north is more latitude, east more longitude; zero distance is where you are', () => {
    expect(destinationPoint(tbilisi, 0, 10_000)[1]).toBeGreaterThan(tbilisi[1]);
    expect(destinationPoint(tbilisi, 90, 10_000)[0]).toBeGreaterThan(tbilisi[0]);
    const same = destinationPoint(tbilisi, 123, 0);
    expect(same[0]).toBeCloseTo(tbilisi[0], 9);
    expect(same[1]).toBeCloseTo(tbilisi[1], 9);
  });

  it('wraps across the date line', () => {
    const p = destinationPoint([179.9, 0], 90, 50_000);
    expect(p[0]).toBeLessThan(-179);
    expect(p[0]).toBeGreaterThanOrEqual(-180);
  });
});
