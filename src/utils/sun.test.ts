import { describe, expect, it } from 'vitest';
import { findSunTransition, isDaylight, solarElevationDeg } from './sun';
import { formatLocalTime } from './timezone';

describe('sun position', () => {
  it('knows day from night in Tbilisi', () => {
    expect(isDaylight(41.69, 44.8, Date.UTC(2026, 8, 26, 9, 0))).toBe(true); // 13:00 local
    expect(isDaylight(41.69, 44.8, Date.UTC(2026, 8, 26, 20, 0))).toBe(false); // 00:00 local
    expect(solarElevationDeg(41.69, 44.8, Date.UTC(2026, 8, 26, 8, 50))).toBeGreaterThan(40);
  });

  it('finds sunset near the equinox around 18:50 local', () => {
    const t = findSunTransition(41.69, 44.8, Date.UTC(2026, 8, 26, 12, 0), Date.UTC(2026, 8, 26, 17, 0));
    expect(t?.type).toBe('sunset');
    const local = formatLocalTime(t!.atMs, 'Asia/Tbilisi');
    expect(local >= '18:40' && local <= '19:05').toBe(true);
  });
});
