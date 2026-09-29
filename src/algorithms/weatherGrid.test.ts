import { describe, expect, it } from 'vitest';
import { makeForecast } from '../test/helpers';
import { bilinear, colorFor, contains, gridPoints, gridValues, pad, renderField } from './weatherGrid';

describe('weather layer grid', () => {
  it('grid points run north→south rows, west→east columns', () => {
    const g = gridPoints([40, 41, 46, 43], 3);
    expect(g).toHaveLength(9);
    expect(g[0]).toEqual([40, 43]); // NW
    expect(g[2]).toEqual([46, 43]); // NE
    expect(g[8]).toEqual([46, 41]); // SE
  });

  it('bilinear interpolation, tolerant of missing corners', () => {
    const v = [0, 10, 20, 30];
    expect(bilinear(v, 2, 0, 0)).toBe(0);
    expect(bilinear(v, 2, 1, 1)).toBe(30);
    expect(bilinear(v, 2, 0.5, 0.5)).toBe(15);
    expect(bilinear([null, 10, null, 30], 2, 0.5, 0.5)).toBe(20);
    expect(bilinear([null, null, null, null], 2, 0.5, 0.5)).toBeNull();
  });

  it('values come from the forecast hour containing the time', () => {
    const t0 = Date.UTC(2026, 8, 29, 0);
    const f = makeForecast({ startMs: t0, hours: 24, hourFn: (_t, i) => ({ temperature: i, code: i >= 5 ? 63 : 1, precipitation: i >= 5 ? 2 : 0 }) });
    const at = t0 + 5.5 * 3_600_000;
    expect(gridValues([f, undefined], at, 'precip')).toEqual([2, null]);
    expect(gridValues([f], at, 'temp')[0]).toBeCloseTo(5.5, 1);
  });

  it('dry is transparent; heavier rain is more opaque; temperature always visible', () => {
    expect(colorFor('precip', 0)[3]).toBe(0);
    expect(colorFor('precip', 5)[3]).toBeGreaterThan(colorFor('precip', 0.5)[3]);
    expect(colorFor('temp', -20)[3]).toBeGreaterThan(0);
    const buf = renderField([0, 0, 5, 5], 2, 'precip', 4);
    expect(buf[3]).toBe(0); // top-left dry
    expect(buf[(3 * 4 + 3) * 4 + 3]).toBeGreaterThan(150); // bottom-right wet
  });

  it('coverage checks for refetching', () => {
    const outer = pad([44, 41, 45, 42], 0.2);
    expect(contains(outer, [44.1, 41.1, 44.9, 41.9])).toBe(true);
    expect(contains(outer, [43, 41, 45, 42])).toBe(false);
  });
});
