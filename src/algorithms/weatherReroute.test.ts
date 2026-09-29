import { describe, expect, it } from 'vitest';
import type { RouteSample } from '../types/route';
import { pickWeatherReroute, remainingSamples, worthChecking, type Exposure } from './weatherReroute';

const ex = (severe: number, wet = severe, fog = 0): Exposure => ({ severeMinutes: severe, wetMinutes: wet, fogMinutes: fog, score: wet + 3 * severe + 1.5 * fog });

describe('weather reroute while driving', () => {
  it('only looks for another route when severe weather or fog is ahead', () => {
    expect(worthChecking(null)).toBe(false);
    expect(worthChecking(ex(0, 40))).toBe(false); // plain rain: not worth a detour
    expect(worthChecking(ex(8))).toBe(true);
    expect(worthChecking(ex(0, 0, 15))).toBe(true);
  });

  it('re-times the rest of the route from the vehicle', () => {
    const s = (d: number, t: number) => ({ id: `${d}`, coordinate: [0, 0], distanceM: d, travelTimeS: t }) as unknown as RouteSample;
    const rest = remainingSamples([s(0, 0), s(10_000, 600), s(20_000, 1200)], 5_000, 300);
    expect(rest.map((x) => [x.distanceM, x.travelTimeS])).toEqual([
      [10_000, 300],
      [20_000, 900],
    ]);
  });

  it('offers a clearly better route for a reasonable extra time', () => {
    const cur = ex(20, 30); // 90
    const pick = pickWeatherReroute(cur, 3600, [
      { exposure: ex(20, 30), durationS: 3500 }, // same weather
      { exposure: ex(0, 10), durationS: 3600 + 8 * 60 }, // 10, +8 min
      { exposure: ex(0, 0), durationS: 3600 + 45 * 60 }, // best weather but too long
    ]);
    expect(pick?.index).toBe(1);
    expect(pick?.extraS).toBe(480);
  });

  it('never offers a marginal gain, more severe weather, or unknown weather', () => {
    const cur = ex(6, 10); // 28
    expect(pickWeatherReroute(cur, 3600, [{ exposure: ex(4, 8), durationS: 3600 }])).toBeNull(); // 20: gain 8 < 15
    expect(pickWeatherReroute(ex(10, 10), 3600, [{ exposure: ex(11, 0), durationS: 3600 }])).toBeNull();
    expect(pickWeatherReroute(ex(20, 20), 3600, [{ exposure: null, durationS: 3000 }])).toBeNull();
  });
});
