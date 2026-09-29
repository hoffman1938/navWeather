import { describe, expect, it } from 'vitest';
import { applyVote, parseBbox, REPORT_TTL_MIN, sanitizeReport, sanitizeVote } from './protocol';

const MIN = 60_000;

describe('driver reports protocol', () => {
  it('accepts only known kinds and real coordinates (rounded to ~1 m)', () => {
    expect(sanitizeReport({ kind: 'accident', lat: 41.7151234567, lon: 44.7871234567 })).toEqual({ kind: 'accident', lat: 41.71512, lon: 44.78712 });
    expect(sanitizeReport({ kind: 'police', lat: 41, lon: 44 })).toBeNull();
    expect(sanitizeReport({ kind: 'hazard', lat: 91, lon: 44 })).toBeNull();
    expect(sanitizeReport({ kind: 'hazard', lat: '41', lon: 44 })).toBeNull();
    expect(sanitizeReport(null)).toBeNull();
    expect(sanitizeVote({ vote: 'gone' })).toBe('gone');
    expect(sanitizeVote({ vote: 'maybe' })).toBeNull();
  });

  it('bounding boxes must be valid and not huge', () => {
    expect(parseBbox('41,41,46,43.6')).toEqual([41, 41, 46, 43.6]);
    expect(parseBbox('46,41,41,43')).toBeNull();
    expect(parseBbox('0,0,20,20')).toBeNull(); // 400 deg²
    expect(parseBbox('a,b,c,d')).toBeNull();
    expect(parseBbox(null)).toBeNull();
  });

  it('"still there" extends a report, within limits', () => {
    const t0 = 1_000_000;
    const r = { kind: 'accident' as const, createdAt: t0, expiresAt: t0 + 60 * MIN, confirms: 0, denies: 0 };
    const later = t0 + 50 * MIN;
    expect(applyVote(r, 'still', later)).toEqual({ confirms: 1, denies: 0, expiresAt: later + 30 * MIN });
    // Never beyond 3× the lifetime from creation.
    const veryLate = t0 + 170 * MIN;
    expect(applyVote({ ...r, expiresAt: veryLate + MIN }, 'still', veryLate).expiresAt).toBe(t0 + 3 * REPORT_TTL_MIN.accident * MIN);
  });

  it('"gone" ends a report once two drivers say so and outnumber confirmations', () => {
    const t0 = 1_000_000;
    const r = { kind: 'hazard' as const, createdAt: t0, expiresAt: t0 + 45 * MIN, confirms: 0, denies: 0 };
    const one = applyVote(r, 'gone', t0 + MIN);
    expect(one.expiresAt).toBe(r.expiresAt); // one "gone" is not enough
    const two = applyVote({ ...r, ...one }, 'gone', t0 + 2 * MIN);
    expect(two.expiresAt).toBe(t0 + 2 * MIN);
    const confirmed = applyVote({ ...r, confirms: 3, denies: 1 }, 'gone', t0 + 3 * MIN);
    expect(confirmed.expiresAt).toBe(r.expiresAt); // 2 gone vs 3 still → stays
  });
});
