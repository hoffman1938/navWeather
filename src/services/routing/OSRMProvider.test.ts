import { describe, expect, it } from 'vitest';
import { rawTbilisiBatumi, tbilisiBatumiRoute, TBILISI, BATUMI } from '../../test/helpers';
import { normalizeOsrmRoute } from './OSRMProvider';

describe('OSRM normalization (Tbilisi → Batumi)', () => {
  const route = tbilisiBatumiRoute();

  it('keeps the full road geometry — never a straight line', () => {
    expect(route.geometry.length).toBeGreaterThan(3000);
    expect(route.distanceM / 1000).toBeCloseTo(357.7, 0);
    expect(route.durationS / 3600).toBeGreaterThan(4.5);
    // Road distance is much longer than the straight line (~264 km)
    expect(route.distanceM / 1000).toBeGreaterThan(300);
  });

  it('uses per-edge annotations for timing, scaled to the leg duration', () => {
    expect(route.segmentSource).toBe('annotations');
    expect(route.segments).toHaveLength(route.geometry.length - 1);
    const sum = route.segments.reduce((a, s) => a + s.durationS, 0);
    expect(sum).toBeCloseTo(route.durationS, 3);
  });

  it('aligns steps with geometry indices', () => {
    const steps = route.legs[0].steps;
    expect(steps[0].fromIndex).toBe(0);
    for (let i = 1; i < steps.length; i++) expect(steps[i].fromIndex).toBe(steps[i - 1].toIndex);
    expect(steps[steps.length - 1].toIndex).toBe(route.geometry.length - 1);
  });

  it('falls back to step durations when annotations are missing', () => {
    const raw = rawTbilisiBatumi();
    delete (raw.legs[0] as { annotation?: unknown }).annotation;
    const r = normalizeOsrmRoute(raw, { origin: TBILISI, destination: BATUMI });
    expect(r.segmentSource).toBe('steps');
    expect(r.segments.reduce((a, s) => a + s.durationS, 0)).toBeCloseTo(r.durationS, 0);
  });

  it('falls back to proportional timing without annotations or step geometry', () => {
    const raw = rawTbilisiBatumi();
    delete (raw.legs[0] as { annotation?: unknown }).annotation;
    raw.legs[0].steps.forEach((s) => delete (s as { geometry?: unknown }).geometry);
    const r = normalizeOsrmRoute(raw, { origin: TBILISI, destination: BATUMI });
    expect(r.segmentSource).toBe('proportional');
    expect(r.segments).toHaveLength(1);
  });
});
