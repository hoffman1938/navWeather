import { describe, expect, it } from 'vitest';
import type { LngLat } from '../types/geo';
import type { Route, RouteStep } from '../types/route';
import type { WeatherAtTime } from '../types/weather';
import { dueHazard, findSharpCurves, roadSurface, snapLevelCrossings } from './roadHazards';
import { buildTimedRoute, positionAtDistance } from './routeTiming';

const LAT0 = 42;
const toLngLat = ([x, y]: [number, number]): LngLat => [44 + x / (111_320 * Math.cos((LAT0 * Math.PI) / 180)), LAT0 + y / 110_540];

/** Straight east, then a bend of `turnDeg` (radius `r` m, to the left for positive), then straight. */
function bendRoute(turnDeg: number, r: number, speedMps: number, steps: Partial<RouteStep>[] = []): Route {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 1500; x += 25) pts.push([x, 0]);
  const th = (Math.abs(turnDeg) * Math.PI) / 180;
  const sgn = Math.sign(turnDeg);
  for (let a = 0.05; a <= th + 1e-9; a += 0.05) pts.push([1500 + r * Math.sin(a), sgn * r * (1 - Math.cos(a))]);
  const [ex, ey] = pts[pts.length - 1];
  for (let s = 25; s <= 1500; s += 25) pts.push([ex + s * Math.cos(th), ey + sgn * s * Math.sin(th)]);
  const geometry = pts.map(toLngLat);
  const distanceM = 3000 + r * th;
  return {
    id: 'r',
    provider: 'test',
    origin: { id: 'a', name: 'A', label: 'A', coordinate: geometry[0] },
    destination: { id: 'b', name: 'B', label: 'B', coordinate: geometry[geometry.length - 1] },
    geometry,
    distanceM,
    durationS: distanceM / speedMps,
    legs: [
      {
        distanceM,
        durationS: distanceM / speedMps,
        summary: '',
        steps: steps.map((s) => ({ distanceM: 0, durationS: 0, name: '', maneuverType: 'turn', location: geometry[0], ...s })),
      },
    ],
    segments: [],
    segmentSource: 'proportional',
    bbox: [0, 0, 0, 0],
    computedAt: 0,
  };
}

const weather = (w: Partial<WeatherAtTime>): WeatherAtTime => ({ temperature: 12, condition: 'RAIN', isDay: true, forecastHourUtc: 0, ...w });

describe('road hazards', () => {
  it('flags a sharp bend on a fast road, with its direction', () => {
    const timed = buildTimedRoute(bendRoute(90, 40, 80 / 3.6));
    const curves = findSharpCurves(timed);
    expect(curves).toHaveLength(1);
    expect(curves[0].side).toBe('left');
    expect(curves[0].turnDeg).toBeGreaterThanOrEqual(60);
    expect(curves[0].distanceAlongM).toBeGreaterThan(1380);
    expect(curves[0].distanceAlongM).toBeLessThan(1560);
  });

  it('ignores the same bend on a slow road, and gentle bends on fast roads', () => {
    expect(findSharpCurves(buildTimedRoute(bendRoute(90, 40, 40 / 3.6)))).toHaveLength(0);
    expect(findSharpCurves(buildTimedRoute(bendRoute(-30, 600, 90 / 3.6)))).toHaveLength(0);
  });

  it('leaves bends at a maneuver to the turn prompt', () => {
    const plain = buildTimedRoute(bendRoute(-90, 30, 80 / 3.6));
    expect(findSharpCurves(plain)[0]?.side).toBe('right');
    const route = bendRoute(-90, 30, 80 / 3.6);
    const at = positionAtDistance(buildTimedRoute(route), 1520);
    route.legs[0].steps = [{ distanceM: 0, durationS: 0, name: '', maneuverType: 'turn', location: at.coordinate, fromIndex: at.index }];
    expect(findSharpCurves(buildTimedRoute(route))).toHaveLength(0);
  });

  it('level crossings: on the road only, multi-track nodes merged', () => {
    const timed = buildTimedRoute(bendRoute(90, 40, 20));
    const p = (d: number) => positionAtDistance(timed, d).coordinate;
    const off: LngLat = [p(500)[0], p(500)[1] + 0.003];
    const rail = snapLevelCrossings(
      [
        { id: '1', coordinate: p(800) },
        { id: '2', coordinate: p(815) },
        { id: '3', coordinate: off },
      ],
      timed,
    );
    expect(rail.map((r) => r.id)).toEqual(['rail:1']);
  });

  it('announces once, ~300 m (or 15 s) ahead', () => {
    const hz = [{ id: 'c', kind: 'curve' as const, distanceAlongM: 2000, coordinate: [0, 0] as LngLat }];
    const done = new Set<string>();
    expect(dueHazard(hz, 1500, 15, done)).toBeNull();
    expect(dueHazard(hz, 1750, 15, done)?.id).toBe('c');
    done.add('c');
    expect(dueHazard(hz, 1800, 15, done)).toBeNull();
    expect(dueHazard(hz, 1600, 30, new Set())?.id).toBe('c'); // 30 m/s × 15 s = 450 m
  });

  it('road surface from the forecast at that time', () => {
    expect(roadSurface(null)).toBe('dry');
    expect(roadSurface(weather({ precipitation: 0 }))).toBe('dry');
    expect(roadSurface(weather({ precipitation: 1.2 }))).toBe('wet');
    expect(roadSurface(weather({ precipitation: 0.6, temperature: 0 }))).toBe('icy');
    expect(roadSurface(weather({ snowfall: 0.4, temperature: -2 }))).toBe('icy');
  });
});
