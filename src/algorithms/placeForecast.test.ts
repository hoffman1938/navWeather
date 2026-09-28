import { describe, expect, it } from 'vitest';
import { makeForecast } from '../test/helpers';
import { dailySummary, nextHours } from './placeForecast';

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 27, 0); // 04:00 in Tbilisi

describe('place forecast views', () => {
  it('hourly slots start at the next full hour', () => {
    const f = makeForecast({ startMs: T0, hours: 72, hourFn: (_t, i) => ({ temperature: 10 + (i % 24) / 2, code: 3 }) });
    const slots = nextHours(f, T0 + 20 * 60_000, 24);
    expect(slots).toHaveLength(24);
    expect(slots[0].timeMs).toBe(T0 + H);
    expect(slots[1].timeMs - slots[0].timeMs).toBe(H);
  });

  it('stops at the end of the forecast instead of extrapolating', () => {
    const f = makeForecast({ startMs: T0, hours: 10, hourFn: () => ({ temperature: 10, code: 0 }) });
    expect(nextHours(f, T0, 24).length).toBeLessThan(10);
  });

  it('daily rows: min/max in the local day, a lasting shower wins the icon, a single stray hour does not', () => {
    // Day 1 (local): rain from 13:00 to 16:00. Day 2: one drizzly hour only.
    const f = makeForecast({
      startMs: T0 - 4 * H, // local midnight
      hours: 72,
      timezone: 'Asia/Tbilisi',
      hourFn: (_t, i) => {
        const local = i % 24;
        const day = Math.floor(i / 24);
        const rain = (day === 0 && local >= 13 && local <= 16) || (day === 1 && local === 10);
        return { temperature: 8 + local / 2 + day, code: rain ? 63 : 2, precipitationProbability: rain ? 80 : 5, precipitation: rain ? 1.5 : 0 };
      },
    });
    const days = dailySummary(f, T0 - 4 * H, 3);
    expect(days).toHaveLength(3);
    expect(days[0].condition).toBe('RAIN');
    expect(days[0].precipitationProbability).toBe(80);
    expect(days[0].min).toBeLessThan(days[0].max);
    expect(days[1].condition).not.toBe('RAIN');
    expect(days[0].dateKey).toBe('2026-09-27');
  });
});
