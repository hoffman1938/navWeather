import { describe, expect, it } from 'vitest';
import { cleanText, mergeUpdate, needsRoute, sanitizeCreate, sanitizeUpdate, type ShareState } from './protocol';

const NOW = Date.UTC(2026, 8, 27, 12);
const empty: ShareState = { pos: null, trip: null, sim: false, updatedAt: null };

describe('share protocol validation', () => {
  it('create: bounded duration, cleaned name', () => {
    expect(sanitizeCreate({ minutes: 60, name: ' Gio\n' }, NOW)).toEqual({ expiresAt: NOW + 3_600_000, name: 'Gio' });
    expect(sanitizeCreate({ minutes: 5 }, NOW)).toBeNull();
    expect(sanitizeCreate({ minutes: 25 * 60 }, NOW)).toBeNull();
    expect(sanitizeCreate('60', NOW)).toBeNull();
    expect(sanitizeCreate({ minutes: 60, name: 'x'.repeat(100) }, NOW)!.name).toHaveLength(40);
  });

  it('update: rejects impossible coordinates and non-objects', () => {
    expect(sanitizeUpdate(null, NOW)).toBeNull();
    expect(sanitizeUpdate({ pos: { c: [200, 0], t: NOW } }, NOW)).toBeNull();
    expect(sanitizeUpdate({ pos: { c: [0, 95], t: NOW } }, NOW)).toBeNull();
    expect(sanitizeUpdate({ pos: { c: ['1', '2'], t: NOW } }, NOW)).toBeNull();
  });

  it('update: keeps valid fields, drops junk, clamps the sender clock', () => {
    const u = sanitizeUpdate({ pos: { c: [44.80123456, 41.7], acc: 12.4, hdg: 400, spd: 23.456, t: NOW - 3_600_000, evil: 1 }, sim: 'yes' }, NOW)!;
    expect(u.pos).toEqual({ c: [44.801235, 41.7], acc: 12, spd: 23.5, t: NOW });
    expect(u.sim).toBeUndefined();
  });

  it('update: trip needs a destination; route needs an id and sane size', () => {
    const base = { pos: { c: [44.8, 41.7], t: NOW } };
    expect(sanitizeUpdate({ ...base, trip: { dest: { name: '', c: [1, 1] } } }, NOW)!.trip).toBeUndefined();
    expect(sanitizeUpdate({ ...base, trip: null }, NOW)!.trip).toBeNull();
    const route = Array.from({ length: 3 }, (_, i) => [44 + i * 0.1, 41.7]);
    const t = sanitizeUpdate({ ...base, trip: { dest: { name: 'Batumi', c: [41.64, 41.65] }, eta: NOW + 3_600_000, remM: 1e5, routeId: 'r:1', route } }, NOW)!.trip!;
    expect(t.route).toHaveLength(3);
    expect(sanitizeUpdate({ ...base, trip: { dest: { name: 'B', c: [1, 1] }, routeId: 'r', route: Array(501).fill([1, 1]) } }, NOW)!.trip).toBeUndefined();
    expect(sanitizeUpdate({ ...base, trip: { dest: { name: 'B', c: [1, 1] }, routeId: '<script>' } }, NOW)!.trip!.routeId).toBeUndefined();
  });

  it('display text: control characters and line separators become spaces', () => {
    expect(cleanText('a\u0000b c\td', 20)).toBe('a b c d');
    expect(cleanText('   ', 20)).toBeUndefined();
  });
});

describe('merging updates', () => {
  const trip = { dest: { name: 'Batumi', c: [41.64, 41.65] as [number, number] }, routeId: 'r1' };
  it('keeps the route geometry while the route id is unchanged (sent once)', () => {
    let s = mergeUpdate(empty, { pos: { c: [1, 1], t: NOW }, trip }, NOW);
    expect(needsRoute(s)).toBe(true);
    s = mergeUpdate(s, { pos: { c: [1, 1], t: NOW }, trip: { ...trip, route: [[1, 1], [2, 2]] } }, NOW);
    expect(needsRoute(s)).toBe(false);
    s = mergeUpdate(s, { pos: { c: [1.1, 1], t: NOW }, trip }, NOW + 1000);
    expect(s.trip!.route).toHaveLength(2);
    expect(s.updatedAt).toBe(NOW + 1000);
    s = mergeUpdate(s, { pos: { c: [1.2, 1], t: NOW }, trip: { ...trip, routeId: 'r2' } }, NOW);
    expect(needsRoute(s)).toBe(true);
  });

  it('only the latest position is kept (no trail)', () => {
    let s = mergeUpdate(empty, { pos: { c: [1, 1], t: NOW } }, NOW);
    s = mergeUpdate(s, { pos: { c: [2, 2], t: NOW } }, NOW);
    expect(JSON.stringify(s)).not.toContain('[1,1]');
  });

  it('a missing trip keeps the old one; null clears it', () => {
    let s = mergeUpdate(empty, { pos: { c: [1, 1], t: NOW }, trip }, NOW);
    s = mergeUpdate(s, { pos: { c: [1, 1], t: NOW } }, NOW);
    expect(s.trip?.dest.name).toBe('Batumi');
    s = mergeUpdate(s, { pos: { c: [1, 1], t: NOW }, trip: null }, NOW);
    expect(s.trip).toBeNull();
  });
});

describe('invisible characters', () => {
  it('strips bidi overrides and zero-width characters from names', () => {
    expect(cleanText('Gio‮txt.exe​', 40)).toBe('Gio txt.exe');
  });
});
