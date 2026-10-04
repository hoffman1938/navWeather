import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline } from './polyline';

describe('polyline', () => {
  it("encodes Google's reference example (precision 5)", () => {
    expect(encodePolyline([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]], 5)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('round-trips at precision 5 and 7', () => {
    const pts: [number, number][] = [[44.80145, 41.69346], [41.63601, 41.65095], [179.99999, -89.5], [-179.9, 0]];
    for (const p of [5, 7]) {
      const back = decodePolyline(encodePolyline(pts, p), p);
      back.forEach((q, i) => {
        expect(q[0]).toBeCloseTo(pts[i][0], p - 1);
        expect(q[1]).toBeCloseTo(pts[i][1], p - 1);
      });
    }
  });
});
