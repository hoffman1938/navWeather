import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeErrorOf, sanitizeMatrixRequest, sanitizeRouteRequest, valhallaRouteRequest } from '../../api/route';
import type { Place } from '../../types/geo';
import type { Route } from '../../types/route';
import type { RoutingProvider } from './RoutingProvider';
import { ValhallaProvider } from './ValhallaProvider';

/** Our routing engine through `/api/v1/route` (DP-5.2, DP-6.2): request shape, OSRM-format answer, fallback rules. */

const tbilisi: Place = { id: 'a', name: 'Tbilisi', label: 'Tbilisi', coordinate: [44.8015, 41.6935] };
const batumi: Place = { id: 'b', name: 'Batumi', label: 'Batumi', coordinate: [41.636, 41.651] };

/** A small OSRM-format answer as Valhalla gives it (steps with GeoJSON geometry, a name joined with ";"). */
const answer = {
  code: 'Ok',
  routes: [
    {
      distance: 2000,
      duration: 180,
      geometry: { type: 'LineString', coordinates: [[44.8, 41.69], [44.81, 41.7], [44.82, 41.71]] },
      legs: [
        {
          distance: 2000,
          duration: 180,
          summary: 'Pushkin St',
          steps: [
            { distance: 1000, duration: 90, name: 'პუშკინის ქუჩა; Pushkin St', geometry: { coordinates: [[44.8, 41.69], [44.81, 41.7]] }, maneuver: { type: 'depart', location: [44.8, 41.69] }, intersections: [{ location: [44.8, 41.69], lanes: [{ indications: ['straight'], valid: true }] }] },
            { distance: 1000, duration: 90, name: 'Rustaveli Ave', geometry: { coordinates: [[44.81, 41.7], [44.82, 41.71]] }, maneuver: { type: 'turn', modifier: 'left', location: [44.81, 41.7] } },
            { distance: 0, duration: 0, name: '', geometry: { coordinates: [[44.82, 41.71]] }, maneuver: { type: 'arrive', location: [44.82, 41.71] } },
          ],
        },
      ],
    },
  ],
};

let sent: { url: string; body: Record<string, unknown> }[];
let reply: () => Response;

beforeEach(() => {
  sent = [];
  reply = () => Response.json(answer);
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return reply();
  });
});
afterEach(() => vi.unstubAllGlobals());

function fallbackRouter(): RoutingProvider & { calls: number } {
  return {
    name: 'fake-osrm',
    calls: 0,
    capabilities: { alternatives: true, avoid: [], laneGuidance: true, matrix: false, multiStop: true, via: true },
    async calculateRoutes() {
      this.calls++;
      return [{ id: 'osrm-route' } as Route];
    },
  };
}

describe('the route API request (shared with the Worker)', () => {
  it('validates and builds the engine request: modes, stops, silent via points, heading, avoid options', () => {
    const req = sanitizeRouteRequest({
      mode: 'drive',
      points: [{ lon: 44.8, lat: 41.69 }, { lon: 43.5, lat: 41.6, via: true }, { lon: 41.64, lat: 41.65 }],
      avoid: ['tolls', 'ferries', 'nonsense'],
      bearingDeg: 370,
      alternatives: 3, // Valhalla offers at most 2
    })!;
    expect(req).toMatchObject({ mode: 'drive', avoid: ['tolls', 'ferries'], bearingDeg: 10, alternatives: 2 });
    const v = valhallaRouteRequest(req);
    expect(v.costing).toBe('auto');
    expect(v.format).toBe('osrm');
    expect(v.locations.map((l) => l.type)).toEqual(['break', 'through', 'break']);
    expect(v.locations[0]).toMatchObject({ heading: 10, heading_tolerance: 60 });
    expect(v.locations[1]).toMatchObject({ search_cutoff: 8000 });
    expect(v.costing_options).toEqual({ auto: { use_tolls: 0, use_ferry: 0 } });
    expect('alternates' in v).toBe(false); // alternatives only between two points
    expect(valhallaRouteRequest(sanitizeRouteRequest({ mode: 'walk', points: [{ lon: 1, lat: 1 }, { lon: 2, lat: 2 }], avoid: ['tolls'] })!).costing_options).toBeUndefined();
  });

  it('refuses bad requests', () => {
    expect(sanitizeRouteRequest({ mode: 'fly', points: [{ lon: 1, lat: 1 }, { lon: 2, lat: 2 }] })).toBeNull();
    expect(sanitizeRouteRequest({ mode: 'drive', points: [{ lon: 1, lat: 1 }] })).toBeNull();
    expect(sanitizeRouteRequest({ mode: 'drive', points: [{ lon: 1, lat: 91 }, { lon: 2, lat: 2 }] })).toBeNull();
    expect(sanitizeRouteRequest({ mode: 'drive', points: Array.from({ length: 21 }, () => ({ lon: 1, lat: 1 })) })).toBeNull();
    expect(sanitizeMatrixRequest({ mode: 'drive', sources: [[1, 1]], destinations: [[2, 2]] })).not.toBeNull();
    expect(sanitizeMatrixRequest({ mode: 'drive', sources: [[1, 100]], destinations: [[2, 2]] })).toBeNull();
  });

  it('maps engine errors to our words: outside the region, no route', () => {
    expect(routeErrorOf({ code: 'NoSegment' })).toEqual({ status: 422, error: 'outside-region' });
    expect(routeErrorOf({ code: 'NoRoute' })).toEqual({ status: 404, error: 'no-route' });
    expect(routeErrorOf(null)).toEqual({ status: 502, error: 'engine-error' });
  });
});

describe('ValhallaProvider in the app', () => {
  it('asks our API, reads the OSRM-format answer into a Route (first of several names, lanes kept)', async () => {
    const routes = await new ValhallaProvider('/api/v1/route', 'drive').calculateRoutes({ origin: tbilisi, destination: batumi, alternatives: true, avoid: ['tolls'], startBearingDeg: 90 });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/v1/route');
    expect(sent[0].body).toMatchObject({ mode: 'drive', alternatives: 2, avoid: ['tolls'], bearingDeg: 90 });
    const [r] = routes;
    expect(r.provider).toBe('valhalla');
    expect(r.legs[0].steps[0].name).toBe('პუშკინის ქუჩა');
    expect(r.legs[0].steps[0].lanes).toEqual([{ indications: ['straight'], valid: true }]);
    expect(r.segmentSource).toBe('steps'); // no per-edge annotations: timing by step
  });

  it('the fallback answers only when our engine is not there or the trip is outside its region — never for avoid options', async () => {
    const fallback = fallbackRouter();
    const p = new ValhallaProvider('/api/v1/route', 'drive', fallback);
    reply = () => Response.json({ error: 'unavailable' }, { status: 503 });
    expect((await p.calculateRoutes({ origin: tbilisi, destination: batumi }))[0].id).toBe('osrm-route');
    reply = () => Response.json({ error: 'outside-region' }, { status: 422 });
    expect((await p.calculateRoutes({ origin: tbilisi, destination: batumi }))[0].id).toBe('osrm-route');
    expect(fallback.calls).toBe(2);
    await expect(p.calculateRoutes({ origin: tbilisi, destination: batumi, avoid: ['tolls'] })).rejects.toThrow();
    reply = () => Response.json({ error: 'no-route' }, { status: 404 });
    await expect(p.calculateRoutes({ origin: tbilisi, destination: batumi })).rejects.toMatchObject({ kind: 'no-route' });
    expect(fallback.calls).toBe(2); // "no road" is an answer, not a reason to ask elsewhere
  });

  it('travel times for detours come from our matrix', async () => {
    reply = () => Response.json({ durations: [[60, null]], distances: [[1000, null]] });
    const m = await new ValhallaProvider('/api/v1/route', 'drive').travelMatrix([[44.8, 41.69]], [[44.81, 41.7], [0, 0]]);
    expect(sent[0]).toMatchObject({ url: '/api/v1/route/matrix', body: { mode: 'drive' } });
    expect(m).toEqual({ durations: [[60, null]], distances: [[1000, null]] });
  });
});
