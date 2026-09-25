import { describe, expect, it } from 'vitest';
import { autoThemeFor } from './useEffectiveTheme';

const KHASHURI: [number, number] = [43.6, 42.0];
const sim = (nowMs: number) => ({ playing: true, speed: 60, nowMs, modelTimeS: 0, startMs: 0, arrived: false });

describe('automatic day/night while driving', () => {
  it('follows the system theme while planning', () => {
    expect(autoThemeFor({ mode: 'planning', vehicle: null, sim: sim(0) })).toBeNull();
  });

  it('uses the sun at the vehicle position and simulated time', () => {
    const vehicle = { coordinate: KHASHURI, timestampMs: 0 };
    // 13:00 and 00:30 local (UTC+4)
    expect(autoThemeFor({ mode: 'simulating', vehicle, sim: sim(Date.UTC(2026, 8, 26, 9, 0)) })).toBe('light');
    expect(autoThemeFor({ mode: 'simulating', vehicle, sim: sim(Date.UTC(2026, 8, 25, 20, 30)) })).toBe('dark');
  });

  it('uses the real clock for live navigation', () => {
    const vehicle = { coordinate: KHASHURI, timestampMs: 0 };
    const noon = () => Date.UTC(2026, 8, 26, 8, 0);
    expect(autoThemeFor({ mode: 'navigating', vehicle, sim: sim(0) }, noon)).toBe('light');
  });
});
