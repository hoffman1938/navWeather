import { describe, expect, it } from 'vitest';
import { placeholderStyleImage } from './mapLayers';

describe('images the basemap style lacks (B-15)', () => {
  it('"circle-11" becomes an 11 px dot with a transparent corner', () => {
    const img = placeholderStyleImage('circle-11');
    expect([img.width, img.height]).toEqual([11, 11]);
    expect(img.data.length).toBe(11 * 11 * 4);
    const alpha = (x: number, y: number) => img.data[(y * 11 + x) * 4 + 3];
    expect(alpha(5, 5)).toBe(255); // centre
    expect(alpha(0, 0)).toBe(0); // corner
  });

  it('anything else (e.g. a fill pattern) is invisible', () => {
    const img = placeholderStyleImage('wood-pattern');
    expect([img.width, img.height]).toEqual([1, 1]);
    expect([...img.data]).toEqual([0, 0, 0, 0]);
  });
});
