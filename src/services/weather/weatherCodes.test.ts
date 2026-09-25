import { describe, expect, it } from 'vitest';
import { WEATHER_CONDITIONS } from '../../types/weather';
import { normalizeWmoCode } from './weatherCodes';

describe('weather normalization', () => {
  it.each([
    [0, 'CLEAR'],
    [1, 'CLEAR'],
    [2, 'PARTLY_CLOUDY'],
    [3, 'CLOUDY'],
    [45, 'FOG'],
    [48, 'FOG'],
    [51, 'RAIN'],
    [61, 'RAIN'],
    [63, 'RAIN'],
    [65, 'HEAVY_RAIN'],
    [80, 'RAIN'],
    [82, 'HEAVY_RAIN'],
    [56, 'SLEET'],
    [67, 'SLEET'],
    [71, 'SNOW'],
    [86, 'SNOW'],
    [95, 'THUNDERSTORM'],
    [99, 'THUNDERSTORM'],
  ])('WMO %i → %s', (code, condition) => {
    expect(normalizeWmoCode(code)?.condition).toBe(condition);
  });

  it('never invents a condition for unknown/missing codes', () => {
    expect(normalizeWmoCode(null)).toBeNull();
    expect(normalizeWmoCode(undefined)).toBeNull();
    expect(normalizeWmoCode(42)).toBeNull();
  });

  it('only produces the normalized condition set', () => {
    for (let c = 0; c < 100; c++) {
      const n = normalizeWmoCode(c);
      if (n) expect(WEATHER_CONDITIONS).toContain(n.condition);
    }
  });
});
