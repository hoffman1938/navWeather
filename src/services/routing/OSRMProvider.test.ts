import { afterEach, describe, expect, it, vi } from 'vitest';
import { rawTbilisiBatumi, tbilisiBatumiRoute, TBILISI, BATUMI } from '../../test/helpers';
import { normalizeOsrmRoute, OSRMProvider } from './OSRMProvider';

describe('OSRM alternatives request', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(handler: (url: URL) => Response) {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      const url = new URL(input);
      urls.push(url);
      return handler(url);
    });
    return urls;
  }
  const ok = () => Response.json({ code: 'Ok', routes: [rawTbilisiBatumi(), rawTbilisiBatumi()] });
  const osrm = new OSRMProvider('https://osrm.test', 'driving', 5000, undefined, 3);

  it('asks for several alternatives — `true` would give at most one', async () => {
    const urls = stubFetch(ok);
    const routes = await osrm.calculateRoutes({ origin: TBILISI, destination: BATUMI, alternatives: true });
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.get('alternatives')).toBe('3');
    expect(routes).toHaveLength(2);
  });

  it('asks for none when none are wanted, or when stops make them impossible', async () => {
    const urls = stubFetch(ok);
    await osrm.calculateRoutes({ origin: TBILISI, destination: BATUMI });
    await osrm.calculateRoutes({ origin: TBILISI, destination: BATUMI, alternatives: true, waypoints: [BATUMI] });
    expect(urls.map((u) => u.searchParams.get('alternatives'))).toEqual(['false', 'false']);
  });

  it('retries with `true` when an older OSRM rejects the number', async () => {
    const urls = stubFetch((u) => (u.searchParams.get('alternatives') === '3' ? new Response('bad', { status: 400 }) : ok()));
    const routes = await osrm.calculateRoutes({ origin: TBILISI, destination: BATUMI, alternatives: true });
    expect(urls.map((u) => u.searchParams.get('alternatives'))).toEqual(['3', 'true']);
    expect(routes).toHaveLength(2);
  });

  it('does not retry other failures', async () => {
    const urls = stubFetch(() => new Response('down', { status: 503 }));
    await expect(osrm.calculateRoutes({ origin: TBILISI, destination: BATUMI, alternatives: true })).rejects.toMatchObject({ kind: 'http', status: 503 });
    expect(urls).toHaveLength(1);
  });
});

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
