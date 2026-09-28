import { describe, expect, it } from 'vitest';
import { makeForecast } from '../test/helpers';
import type { RouteSample } from '../types/route';
import { exposureFor, planDepartures } from './departurePlanner';

const H = 3_600_000;
const NOW = Date.UTC(2026, 8, 29, 6);
// A 2-hour drive sampled every 20 minutes.
const samples: RouteSample[] = Array.from({ length: 7 }, (_, i) => ({
  id: `s${i}`,
  coordinate: [44 - i * 0.3, 41.8],
  distanceM: i * 30_000,
  travelTimeS: i * 1200,
  reasons: [],
}));

/** Rain band: heavy rain from NOW+1h to NOW+4h everywhere, dry otherwise. */
const rainy = makeForecast({
  startMs: NOW - 3 * H,
  hours: 48,
  hourFn: (t) => {
    const rain = t > NOW + H && t <= NOW + 4 * H;
    return { temperature: 15, code: rain ? 65 : 1, precipitation: rain ? 6 : 0, precipitationProbability: rain ? 90 : 5 };
  },
});

describe('best time to leave', () => {
  it('measures the exposure of one departure at every sample ETA', () => {
    // Leaving now, the second hour of the drive is inside the band.
    const now = exposureFor(samples, () => rainy, NOW)!;
    expect(now.wetMinutes).toBeGreaterThan(40);
    expect(now.wetMinutes).toBeLessThanOrEqual(70);
    expect(now.severeMinutes).toBe(now.wetMinutes);
    const later = exposureFor(samples, () => rainy, NOW + 5 * H)!;
    expect(later.wetMinutes).toBe(0);
  });

  it('suggests the nearest clearly better departure and marks the chosen one', () => {
    const p = planDepartures(samples, 7200, () => rainy, NOW, NOW)!;
    expect(p.options[0].departMs).toBe(NOW);
    expect(p.options).toHaveLength(25); // every 30 min for 12 h
    expect(p.current.departMs).toBe(NOW);
    expect(p.suggestion).not.toBeNull();
    expect(p.suggestion!.score).toBeLessThan(p.current.score * 0.7);
    // After the band ends (NOW+4h) — not arbitrarily late.
    expect(p.suggestion!.departMs).toBeGreaterThanOrEqual(NOW + 3 * H);
    expect(p.suggestion!.departMs).toBeLessThanOrEqual(NOW + 5 * H);
  });

  it('no suggestion when the chosen time is already good, or when coverage ends', () => {
    const p = planDepartures(samples, 7200, () => rainy, NOW + 6 * H, NOW)!;
    expect(p.suggestion).toBeNull();
    const short = makeForecast({ startMs: NOW, hours: 2, hourFn: () => ({ temperature: 10, code: 1 }) });
    expect(planDepartures(samples, 7200, () => short, NOW, NOW)).toBeNull();
  });
});
