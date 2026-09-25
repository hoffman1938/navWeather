import { describe, expect, it } from 'vitest';
import { initialDeviationState, offRouteThreshold, updateDeviation, type DeviationConfig } from './routeDeviation';

const cfg: DeviationConfig = {
  minThresholdM: 30,
  maxThresholdM: 100,
  maxUsableAccuracyM: 150,
  persistReadings: 3,
  persistSeconds: 8,
};

function run(readings: { d: number; acc?: number; t: number; speed?: number }[]) {
  let s = initialDeviationState;
  const statuses: string[] = [];
  for (const r of readings) {
    s = updateDeviation(s, { distanceFromRouteM: r.d, accuracyM: r.acc, timestampMs: r.t * 1000, roadSpeedMps: r.speed }, cfg);
    statuses.push(s.status);
  }
  return { s, statuses };
}

describe('route deviation detection', () => {
  it('threshold stays within 30–100 m and grows with GPS inaccuracy and road type', () => {
    expect(offRouteThreshold({ distanceFromRouteM: 0, accuracyM: 5, timestampMs: 0 }, cfg)).toBeGreaterThanOrEqual(30);
    expect(offRouteThreshold({ distanceFromRouteM: 0, accuracyM: 500, timestampMs: 0 }, cfg)).toBe(100);
    const city = offRouteThreshold({ distanceFromRouteM: 0, accuracyM: 10, timestampMs: 0, roadSpeedMps: 10 }, cfg);
    const highway = offRouteThreshold({ distanceFromRouteM: 0, accuracyM: 10, timestampMs: 0, roadSpeedMps: 30 }, cfg);
    expect(highway).toBeGreaterThan(city);
  });

  it('ignores a single GPS glitch', () => {
    const { statuses } = run([
      { d: 5, acc: 10, t: 0 },
      { d: 200, acc: 10, t: 1 },
      { d: 5, acc: 10, t: 2 },
    ]);
    expect(statuses).toEqual(['on-route', 'uncertain', 'on-route']);
  });

  it('flags off-route only after persistent deviation (count AND time)', () => {
    const quick = run([
      { d: 200, acc: 10, t: 0 },
      { d: 210, acc: 10, t: 1 },
      { d: 220, acc: 10, t: 2 },
    ]);
    expect(quick.s.status).toBe('uncertain'); // 3 readings but only 2 s
    const persistent = run([
      { d: 200, acc: 10, t: 0 },
      { d: 210, acc: 10, t: 4 },
      { d: 220, acc: 10, t: 9 },
    ]);
    expect(persistent.s.status).toBe('off-route');
  });

  it('does not decide on unusable fixes', () => {
    const { s } = run([
      { d: 400, acc: 300, t: 0 },
      { d: 400, acc: 300, t: 10 },
      { d: 400, acc: 300, t: 20 },
    ]);
    expect(s.status).toBe('on-route');
    expect(s.consecutiveOff).toBe(0);
  });

  it('tolerates poor-but-usable accuracy with a wider threshold', () => {
    const { s } = run([
      { d: 80, acc: 90, t: 0 },
      { d: 85, acc: 90, t: 5 },
      { d: 90, acc: 90, t: 10 },
    ]);
    expect(s.status).toBe('on-route');
  });
});
