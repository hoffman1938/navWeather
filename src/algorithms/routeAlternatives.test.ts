import { describe, expect, it } from 'vitest';
import { normalizeOsrmRoute } from '../services/routing/OSRMProvider';
import { BATUMI, rawTbilisiBatumi, TBILISI, tbilisiBatumiDetour, tbilisiBatumiRoute } from '../test/helpers';
import type { LngLat } from '../types/geo';
import { routeVia, selectDistinctRoutes, sharedFraction } from './routeAlternatives';

const base = tbilisiBatumiRoute();

const detour = tbilisiBatumiDetour;

describe('sharedFraction', () => {
  it('is 1 for the same road and ~0 for a road elsewhere', () => {
    expect(sharedFraction(base, base)).toBe(1);
    const far = detour(0.0, 1.0, 0.5);
    expect(sharedFraction(far, base)).toBeLessThan(0.1);
  });

  it('measures how much of a detour is its own road', () => {
    const d = detour(0.3, 0.6, 0.15); // the middle 30 % pushed ~17 km away
    const shared = sharedFraction(d, base);
    expect(shared).toBeGreaterThan(0.6);
    expect(shared).toBeLessThan(0.8);
  });
});

describe('selectDistinctRoutes', () => {
  it('drops a copy of the best road shifted by a few metres', () => {
    const copy = detour(0.3, 0.6, 0.0003); // ~30 m
    const kept = selectDistinctRoutes([base, copy], { max: 3 });
    expect(kept).toEqual([base]);
  });

  it('keeps a road that really goes another way, after the best one', () => {
    const other = detour(0.3, 0.6, 0.15);
    const kept = selectDistinctRoutes([base, other], { max: 3 });
    expect(kept).toEqual([base, other]);
  });

  it('keeps the router\'s best road first and orders the rest fastest first', () => {
    const slower = detour(0.2, 0.45, 0.2, 1.3);
    const faster = detour(0.55, 0.8, -0.2, 1.1);
    const kept = selectDistinctRoutes([base, slower, faster], { max: 3 });
    expect(kept[0]).toBe(base);
    expect(kept.slice(1)).toEqual([faster, slower]);
  });

  it('caps the number of roads, best first', () => {
    const a = detour(0.1, 0.3, 0.2, 1.1);
    const b = detour(0.4, 0.6, -0.2, 1.2);
    const c = detour(0.7, 0.9, 0.2, 1.3);
    const kept = selectDistinctRoutes([base, a, b, c], { max: 3 });
    expect(kept).toEqual([base, a, b]);
  });

  it('skips a road that duplicates one it already kept', () => {
    const a = detour(0.3, 0.6, 0.15, 1.1);
    const aCopy = detour(0.3, 0.6, 0.1502, 1.12); // ≈ the same road as `a`
    const kept = selectDistinctRoutes([base, a, aCopy], { max: 3 });
    expect(kept).toEqual([base, a]);
  });

  it('drops a road that is absurdly slower than the best', () => {
    const crawl = detour(0.3, 0.6, 0.15, 2.5);
    expect(selectDistinctRoutes([base, crawl], { max: 3 })).toEqual([base]);
  });

  it('passes a single route (or none) through', () => {
    expect(selectDistinctRoutes([base], { max: 3 })).toEqual([base]);
    expect(selectDistinctRoutes([], { max: 3 })).toEqual([]);
  });
});

describe('routeVia', () => {
  it('names the roads that carry most of the trip, longest first', () => {
    const raw = rawTbilisiBatumi();
    const named = normalizeOsrmRoute(raw, { origin: TBILISI, destination: BATUMI });
    const via = routeVia(named);
    expect(via.length).toBeGreaterThan(0);
    expect(via.length).toBeLessThanOrEqual(2);
    expect(new Set(via).size).toBe(via.length);
  });

  it('prefers a road number to a name, ignores short roads and joins nothing for unnamed roads', () => {
    const step = (name: string, ref: string | undefined, distanceM: number) => ({
      distanceM,
      durationS: distanceM / 20,
      name,
      ref,
      maneuverType: 'turn',
      location: [0, 0] as LngLat,
    });
    const route = {
      ...base,
      legs: [
        {
          distanceM: 100_000,
          durationS: 5000,
          summary: '',
          steps: [step('Tbilisi–Batumi highway', 'E60;S1', 60_000), step('Ring road', undefined, 30_000), step('Lane', 'S99', 4_000), step('', undefined, 6_000)],
        },
      ],
    };
    expect(routeVia(route)).toEqual(['E60', 'Ring road']);
    expect(routeVia({ ...route, legs: [{ ...route.legs[0], steps: [step('', undefined, 1000)] }] })).toEqual([]);
  });
});
