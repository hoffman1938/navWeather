import { describe, expect, it } from 'vitest';
import { spatialKey, TtlCache } from './cache';

describe('TtlCache', () => {
  it('returns fresh values and expires them after the TTL', () => {
    let now = 0;
    const c = new TtlCache<string>(20 * 60000, 10, () => now);
    c.set('a', 'x');
    expect(c.get('a')).toBe('x');
    now = 19 * 60000;
    expect(c.get('a')).toBe('x');
    now = 20 * 60000;
    expect(c.get('a')).toBeUndefined();
    // stale data is still available for fallback
    expect(c.peek('a')?.value).toBe('x');
  });

  it('evicts least recently used entries', () => {
    const c = new TtlCache<number>(1e9, 2, () => 0);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // touch a
    c.set('c', 3);
    expect(c.peek('b')).toBeUndefined();
    expect(c.peek('a')?.value).toBe(1);
    expect(c.size).toBe(2);
  });
});

describe('spatialKey', () => {
  it('treats nearby coordinates as the same weather location', () => {
    expect(spatialKey(41.98231, 44.11242, 0.02)).toBe(spatialKey(41.98252, 44.11261, 0.02));
  });

  it('keeps coordinates a few km apart distinct (mountains/coasts)', () => {
    expect(spatialKey(41.98, 44.11, 0.02)).not.toBe(spatialKey(42.02, 44.11, 0.02));
  });
});
