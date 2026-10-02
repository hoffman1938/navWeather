import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTimedRoute, timeAtDistance } from '../../algorithms/routeTiming';
import fixture from '../../test/fixtures/transitous-tbilisi.json';
import type { Place } from '../../types/geo';
import { haversineM } from '../../utils/distance';
import { ProviderError } from '../http';
import { decodePolyline, motisToRoutes, TransitousProvider, vehicleOf, type MotisPlan } from './TransitousProvider';

/** A real Transitous answer (trimmed): Tbilisi, Dighomi → Zahesi on Tbilisi Transport Company buses. */
const plan = fixture as unknown as MotisPlan;
const origin: Place = { id: 'o', name: 'Your location', label: 'Your location', coordinate: [44.720083, 41.7234622] };
const destination: Place = { id: 'd', name: 'Zahesi', label: 'Zahesi', coordinate: [44.7752, 41.8105] };

afterEach(() => vi.unstubAllGlobals());

describe('decodePolyline', () => {
  it("decodes Google's reference example (precision 5)", () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(pts).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it('keeps precision 7 longitudes far from Greenwich intact (no 32-bit overflow)', () => {
    // Encode one point at precision 7 by hand: lat 41.7, lon 179.9.
    const enc = (v: number) => {
      let n = v < 0 ? ~(v * 2) : v * 2;
      let out = '';
      while (n >= 0x20) {
        out += String.fromCharCode((0x20 | (n % 32)) + 63);
        n = Math.floor(n / 32);
      }
      return out + String.fromCharCode(n + 63);
    };
    const [p] = decodePolyline(enc(417_000_000) + enc(1_799_000_000), 7);
    expect(p[0]).toBeCloseTo(179.9, 6);
    expect(p[1]).toBeCloseTo(41.7, 6);
  });
});

describe('vehicleOf', () => {
  it('folds the many GTFS modes into what the app draws', () => {
    expect(['WALK', 'BUS', 'COACH', 'TRAM', 'SUBWAY', 'METRO', 'REGIONAL_RAIL', 'HIGHSPEED_RAIL', 'SUBURBAN', 'FERRY', 'AERIAL_LIFT', 'AIRPLANE', 'ODM'].map(vehicleOf)).toEqual([
      'walk', 'bus', 'bus', 'tram', 'subway', 'subway', 'rail', 'rail', 'rail', 'ferry', 'cable', 'plane', 'other',
    ]);
  });
});

describe('motisToRoutes', () => {
  const routes = motisToRoutes(plan, { origin, destination });
  const [first] = routes;
  const trip = first.transit!;

  it('turns each itinerary into a route, earliest arrival first', () => {
    expect(routes).toHaveLength(2);
    expect(routes[0].transit!.arriveMs).toBeLessThan(routes[1].transit!.arriveMs);
    expect(new Set(routes.map((r) => r.id)).size).toBe(2);
  });

  it('keeps the timetable: start, end, transfers, and each leg with its line, colours and stops', () => {
    expect(trip.departMs).toBe(Date.parse('2026-10-02T09:58:00Z'));
    expect(trip.arriveMs).toBe(Date.parse('2026-10-02T10:57:00Z'));
    expect(trip.transfers).toBe(2);
    expect(trip.legs.filter((l) => l.vehicle !== 'walk').map((l) => l.line)).toEqual(['476', '539', '333']);
    const bus = trip.legs[1];
    expect(bus).toMatchObject({ vehicle: 'bus', color: '#0033b4', textColor: '#ffffff', agency: 'Tbilisi Transport Company' });
    expect(bus.fromName).toBe('Residential Complex "Shatili"'); // GTFS' doubled quotes cleaned
    expect(bus.stops).toBeGreaterThan(1);
    expect(trip.legs[0].fromName).toBe(''); // the router's "START" is not a stop name
  });

  it('joins the legs into one line that starts and ends at the trip ends', () => {
    const g = first.geometry;
    expect(haversineM(g[0], origin.coordinate)).toBeLessThan(50);
    expect(haversineM(g[g.length - 1], destination.coordinate)).toBeLessThan(300);
    // Legs follow each other along the line.
    for (let i = 1; i < trip.legs.length; i++) expect(trip.legs[i].fromIndex).toBe(trip.legs[i - 1].toIndex);
    // No zero-length steps from the polyline's repeated points.
    for (let i = 1; i < g.length; i++) expect(g[i]).not.toEqual(g[i - 1]);
  });

  it("times the line to the timetable: the trip's length exactly, each stop reached when the bus gets there", () => {
    const timed = buildTimedRoute(first);
    expect(timed.totalTimeS).toBeCloseTo((trip.arriveMs - trip.departMs) / 1000, 3);
    for (const leg of trip.legs) {
      const at = trip.departMs + timeAtDistance(timed, timed.cumDistM[leg.toIndex]) * 1000;
      expect(Math.abs(at - leg.arriveMs)).toBeLessThan(1000);
    }
  });

  it('offers nothing when there are only walks (that is the walking mode) or no itineraries', () => {
    const walkOnly: MotisPlan = { itineraries: [{ ...plan.itineraries![0], legs: [plan.itineraries![0].legs[0]] }] };
    expect(motisToRoutes(walkOnly, { origin, destination })).toEqual([]);
    expect(motisToRoutes({ itineraries: [], direct: [] }, { origin, destination })).toEqual([]);
  });
});

describe('TransitousProvider', () => {
  it('asks for trips from the departure time, in the UI language, and says plainly when there are none', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify(calls.length === 1 ? plan : { itineraries: [], direct: [] }), { status: 200 });
      }),
    );
    const p = new TransitousProvider('https://api.transitous.org/');
    const at = Date.parse('2026-10-02T09:55:00Z');
    const routes = await p.calculateRoutes({ origin, destination, departAtMs: at, alternatives: true, language: 'ru' });
    expect(routes).toHaveLength(2);
    const u = new URL(calls[0]);
    expect(u.origin + u.pathname).toBe('https://api.transitous.org/api/v5/plan');
    expect(u.searchParams.get('fromPlace')).toBe('41.723462,44.720083');
    expect(u.searchParams.get('time')).toBe('2026-10-02T09:55:00.000Z');
    expect(u.searchParams.get('language')).toBe('ru');
    // Only the best one when no alternatives are wanted.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(plan), { status: 200 })));
    expect(await p.calculateRoutes({ origin, destination, departAtMs: at })).toHaveLength(1);
    // Nothing found → a "no route" error the app words for public transport.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ itineraries: [], direct: [] }), { status: 200 })));
    const err = await p.calculateRoutes({ origin, destination, departAtMs: at }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe('no-route');
  });
});
