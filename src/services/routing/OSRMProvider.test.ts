import { afterEach, describe, expect, it, vi } from 'vitest';
import { rawTbilisiBatumi, tbilisiBatumiRoute, TBILISI, BATUMI } from '../../test/helpers';
import { mergeLegs, normalizeOsrmRoute, OSRMProvider } from './OSRMProvider';

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

describe('routing through silent via points', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The fixture road, split into two legs at the step nearest the middle, as OSRM answers a request with one via point. */
  function twoLegs() {
    const raw = rawTbilisiBatumi();
    const leg = raw.legs[0];
    const cut = Math.floor(leg.steps.length / 2);
    const ann = leg.annotation!;
    const k = leg.steps.slice(0, cut).reduce((n, s) => n + Math.max(0, (s.geometry?.coordinates.length ?? 1) - 1), 0);
    const arrive = { ...leg.steps.at(-1)! };
    const depart = { ...leg.steps[0] };
    const first = [...leg.steps.slice(0, cut), { ...arrive, geometry: { coordinates: [leg.steps[cut].geometry!.coordinates[0]] } }];
    const second = [{ ...depart, geometry: leg.steps[cut].geometry }, ...leg.steps.slice(cut + 1)];
    raw.legs = [
      { ...leg, steps: first, annotation: { duration: ann.duration!.slice(0, k), distance: ann.distance!.slice(0, k) }, distance: 1, duration: 1 },
      { ...leg, steps: second, annotation: { duration: ann.duration!.slice(k), distance: ann.distance!.slice(k) }, distance: 1, duration: 1 },
    ];
    return { raw, expectedSteps: leg.steps.length };
  }

  it('merges the legs into one road: no stop at the via point, no instruction there', () => {
    const { raw } = twoLegs();
    const merged = mergeLegs(raw);
    expect(merged.legs).toHaveLength(1);
    const types = merged.legs[0].steps.map((s) => s.maneuver.type);
    expect(types.filter((t) => t === 'arrive')).toHaveLength(1); // only the destination
    expect(types.filter((t) => t === 'depart')).toHaveLength(1); // only the start
    expect(types).toContain('new name'); // the quiet seam
    const route = normalizeOsrmRoute(merged, { origin: TBILISI, destination: BATUMI });
    expect(route.waypoints).toBeUndefined();
    expect(route.legs).toHaveLength(1);
    // Timing still follows the per-edge annotations, scaled to the whole.
    expect(route.segmentSource).toBe('annotations');
    expect(route.segments).toHaveLength(route.geometry.length - 1);
    // Steps still line up with the geometry end to end.
    const steps = route.legs[0].steps;
    for (let i = 1; i < steps.length; i++) expect(steps[i].fromIndex).toBe(steps[i - 1].toIndex);
    expect(steps.at(-1)!.toIndex).toBe(route.geometry.length - 1);
  });

  it('leaves a single-leg answer alone', () => {
    const raw = rawTbilisiBatumi();
    expect(mergeLegs(raw)).toBe(raw);
  });

  it('asks OSRM through the point, with no alternatives and a snapping radius for the via point only', async () => {
    const urls: URL[] = [];
    const { raw } = twoLegs();
    vi.stubGlobal('fetch', async (input: string) => {
      urls.push(new URL(input));
      return Response.json({ code: 'Ok', routes: [raw] });
    });
    const osrm = new OSRMProvider('https://osrm.test', 'driving', 5000, undefined, 3);
    const routes = await osrm.calculateRoutes({ origin: TBILISI, destination: BATUMI, alternatives: true, via: [[43.5, 42.6]] });
    const u = urls[0];
    expect(u.pathname).toContain('44.801449,41.693459;43.500000,42.600000;41.636009,41.650950');
    expect(u.searchParams.get('alternatives')).toBe('false');
    expect(u.searchParams.get('radiuses')).toBe('unlimited;8000;unlimited');
    expect(routes).toHaveLength(1);
    expect(routes[0].legs).toHaveLength(1);
  });

  it('ignores via points when stops are given, or when the server cannot', async () => {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', async (input: string) => (urls.push(new URL(input)), Response.json({ code: 'Ok', routes: [rawTbilisiBatumi()] })));
    const osrm = new OSRMProvider('https://osrm.test');
    await osrm.calculateRoutes({ origin: TBILISI, destination: BATUMI, waypoints: [BATUMI], via: [[43.5, 42.6]] });
    expect(urls[0].searchParams.get('radiuses')).toBeNull();
    const noVia = new OSRMProvider('https://osrm.test', 'driving', 5000, { alternatives: true, avoid: [], laneGuidance: true, matrix: true, multiStop: true });
    await noVia.calculateRoutes({ origin: TBILISI, destination: BATUMI, via: [[43.5, 42.6]] });
    expect(urls[1].pathname.split(';')).toHaveLength(2);
  });
});

describe("the public servers' 1 request per second", () => {
  afterEach(() => vi.unstubAllGlobals());

  it('spaces requests to one server, across profiles on the same host, and never runs two at once', async () => {
    const starts: number[] = [];
    let inFlight = 0;
    let overlap = false;
    vi.stubGlobal('fetch', async () => {
      starts.push(Date.now());
      overlap ||= ++inFlight > 1;
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return Response.json({ code: 'Ok', routes: [rawTbilisiBatumi()], durations: [[60]], distances: [[900]] });
    });
    // Walking and cycling live on one host (routing.openstreetmap.de): one queue for both.
    const foot = new OSRMProvider('https://limited.test/routed-foot', 'driving', 5000, undefined, 3, 120);
    const bike = new OSRMProvider('https://limited.test/routed-bike', 'driving', 5000, undefined, 3, 120);
    await Promise.all([
      foot.calculateRoutes({ origin: TBILISI, destination: BATUMI }),
      bike.calculateRoutes({ origin: TBILISI, destination: BATUMI }),
      foot.travelMatrix!([TBILISI.coordinate], [BATUMI.coordinate]),
    ]);
    expect(starts).toHaveLength(3);
    expect(overlap).toBe(false);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(115);
  });

  it('a self-hosted router (interval 0) is not slowed down', async () => {
    const starts: number[] = [];
    vi.stubGlobal('fetch', async () => {
      starts.push(Date.now());
      return Response.json({ code: 'Ok', routes: [rawTbilisiBatumi()] });
    });
    const own = new OSRMProvider('https://own.test', 'driving', 5000, undefined, 3, 0);
    await Promise.all([own.calculateRoutes({ origin: TBILISI, destination: BATUMI }), own.calculateRoutes({ origin: TBILISI, destination: BATUMI })]);
    expect(starts[1] - starts[0]).toBeLessThan(50);
  });
});
