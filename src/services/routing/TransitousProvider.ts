import type { LngLat } from '../../types/geo';
import type { Route, RouteSegment, RouteStep, TransitLeg, TransitTrip, TransitVehicle } from '../../types/route';
import { bboxOf, haversineM } from '../../utils/distance';
import { decodePolyline } from '../../utils/polyline';
import { fetchJson, ProviderError } from '../http';
import type { RouteRequest, RoutingCapabilities, RoutingProvider } from './RoutingProvider';

/**
 * Public transport from Transitous (https://transitous.org): a free,
 * community-run journey planner over the open timetables (GTFS) that
 * transport operators publish — no API key, called from the browser. It
 * runs MOTIS; this uses its `plan` endpoint.
 *
 * Coverage is whatever operators publish: Tbilisi's buses and metro are
 * there, intercity trains and minibuses in Georgia are not. An empty answer
 * is "no public transport found", never an invented trip. Terms: open-source,
 * non-commercial use, with a visible link to https://transitous.org/sources/.
 */

/** MOTIS `plan` response (only what is used). */
export interface MotisPlace {
  name: string;
  lat: number;
  lon: number;
}
export interface MotisLeg {
  mode: string;
  from: MotisPlace;
  to: MotisPlace;
  startTime: string;
  endTime: string;
  realTime?: boolean;
  distance?: number;
  headsign?: string;
  routeShortName?: string;
  displayName?: string;
  routeColor?: string;
  routeTextColor?: string;
  agencyName?: string;
  intermediateStops?: MotisPlace[];
  legGeometry?: { points: string; precision?: number };
}
export interface MotisItinerary {
  startTime: string;
  endTime: string;
  transfers: number;
  legs: MotisLeg[];
}
export interface MotisPlan {
  itineraries?: MotisItinerary[];
  direct?: MotisItinerary[];
}

/** Itineraries to ask for: departures to choose from. */
const ITINERARIES = 5;

export { decodePolyline };

export class TransitousProvider implements RoutingProvider {
  readonly name = 'transitous';
  readonly capabilities: RoutingCapabilities = { alternatives: true, avoid: [], laneGuidance: false, matrix: false, multiStop: false };

  constructor(
    private readonly baseUrl: string,
    private readonly language = 'en',
    private readonly timeoutMs = 20000,
  ) {}

  async calculateRoutes(req: RouteRequest): Promise<Route[]> {
    const [olon, olat] = req.origin.coordinate;
    const [dlon, dlat] = req.destination.coordinate;
    const params = new URLSearchParams({
      fromPlace: `${olat.toFixed(6)},${olon.toFixed(6)}`,
      toPlace: `${dlat.toFixed(6)},${dlon.toFixed(6)}`,
      time: new Date(req.departAtMs ?? Date.now()).toISOString(),
      numItineraries: String(req.alternatives ? ITINERARIES : 1),
      language: req.language ?? this.language,
    });
    const data = await fetchJson<MotisPlan>(`${this.baseUrl.replace(/\/$/, '')}/api/v5/plan?${params}`, {
      provider: 'Transitous',
      signal: req.signal,
      timeoutMs: this.timeoutMs,
    });
    const routes = motisToRoutes(data, req);
    if (routes.length === 0) throw new ProviderError('No public transport found', 'no-route', 'Transitous');
    return req.alternatives ? routes : routes.slice(0, 1);
  }
}

/**
 * Itineraries → routes, earliest arrival first. Only trips that use a
 * vehicle: a walk-only answer belongs to the walking mode.
 */
export function motisToRoutes(data: MotisPlan, req: Pick<RouteRequest, 'origin' | 'destination'>): Route[] {
  return (data.itineraries ?? [])
    .filter((it) => it.legs?.some((l) => vehicleOf(l.mode) !== 'walk'))
    .map((it) => itineraryToRoute(it, req))
    .filter((r): r is Route => r !== null)
    .sort((a, b) => a.transit!.arriveMs - b.transit!.arriveMs || a.durationS - b.durationS);
}

/** GTFS / MOTIS modes → what the app draws. */
export function vehicleOf(mode: string): TransitVehicle {
  switch (mode) {
    case 'WALK':
      return 'walk';
    case 'BUS':
    case 'COACH':
    case 'TROLLEYBUS':
      return 'bus';
    case 'TRAM':
      return 'tram';
    case 'SUBWAY':
    case 'METRO':
      return 'subway';
    case 'FERRY':
      return 'ferry';
    case 'AIRPLANE':
      return 'plane';
    case 'CABLE_CAR':
    case 'AERIAL_LIFT':
    case 'FUNICULAR':
      return 'cable';
    default:
      return /RAIL|TRAIN|SUBURBAN|LONG_DISTANCE/.test(mode) ? 'rail' : 'other';
  }
}

function hexColor(c?: string): string | undefined {
  return c && /^[0-9a-f]{6}$/i.test(c) ? `#${c.toLowerCase()}` : undefined;
}

/**
 * One itinerary as a Route: the legs' geometry joined into one line, a
 * timing segment per leg, and the legs themselves on `route.transit`.
 * Waiting at a stop is counted in the leg that follows it, so the times along
 * the line still end exactly at the timetable's arrival.
 */
export function itineraryToRoute(it: MotisItinerary, req: Pick<RouteRequest, 'origin' | 'destination'>): Route | null {
  const departMs = Date.parse(it.startTime);
  const arriveMs = Date.parse(it.endTime);
  if (!Number.isFinite(departMs) || !Number.isFinite(arriveMs) || arriveMs <= departMs) return null;
  const geometry: LngLat[] = [];
  const segments: RouteSegment[] = [];
  const steps: RouteStep[] = [];
  const legs: TransitLeg[] = [];
  const push = (p: LngLat) => {
    const last = geometry[geometry.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) geometry.push(p);
  };
  let timedUntil = departMs;
  for (const leg of it.legs ?? []) {
    const fromIndex = Math.max(0, geometry.length - 1);
    const decoded = leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points, leg.legGeometry.precision ?? 6) : [];
    const line: LngLat[] = decoded.length >= 2 ? decoded : [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]];
    line.forEach(push);
    const toIndex = geometry.length - 1;
    let distanceM = 0;
    for (let i = fromIndex; i < toIndex; i++) distanceM += haversineM(geometry[i], geometry[i + 1]);
    const legDepart = Date.parse(leg.startTime);
    const legArrive = Date.parse(leg.endTime);
    if (toIndex > fromIndex && Number.isFinite(legArrive) && legArrive > timedUntil) {
      segments.push({ fromIndex, toIndex, distanceM, durationS: (legArrive - timedUntil) / 1000 });
      timedUntil = legArrive;
    }
    const vehicle = vehicleOf(leg.mode);
    const lineName = vehicle === 'walk' ? undefined : (leg.routeShortName || leg.displayName || undefined)?.trim();
    legs.push({
      vehicle,
      line: lineName,
      color: hexColor(leg.routeColor),
      textColor: hexColor(leg.routeTextColor),
      headsign: leg.headsign?.trim() || undefined,
      agency: leg.agencyName || undefined,
      fromName: cleanStopName(leg.from.name),
      toName: cleanStopName(leg.to.name),
      departMs: Number.isFinite(legDepart) ? legDepart : timedUntil,
      arriveMs: Number.isFinite(legArrive) ? legArrive : timedUntil,
      distanceM: leg.distance ?? distanceM,
      stops: vehicle === 'walk' ? 0 : (leg.intermediateStops?.length ?? 0) + 1,
      realTime: !!leg.realTime,
      fromIndex,
      toIndex,
    });
    steps.push({
      distanceM,
      durationS: Math.max(0, (legArrive - legDepart) / 1000) || 0,
      name: lineName ?? '',
      maneuverType: steps.length === 0 ? 'depart' : 'new name',
      location: geometry[fromIndex],
      fromIndex,
      toIndex,
    });
  }
  if (geometry.length < 2 || segments.length === 0) return null;
  // Time after the last stretch with any length (a final step on the spot) still belongs to the trip.
  if (arriveMs > timedUntil) segments[segments.length - 1].durationS += (arriveMs - timedUntil) / 1000;
  const last = geometry.length - 1;
  steps.push({ distanceM: 0, durationS: 0, name: '', maneuverType: 'arrive', location: geometry[last], fromIndex: last, toIndex: last });
  const distanceM = segments.reduce((a, s) => a + s.distanceM, 0);
  const durationS = (arriveMs - departMs) / 1000;
  const transit: TransitTrip = { departMs, arriveMs, transfers: it.transfers ?? 0, legs };
  const signature = legs.map((l) => l.line ?? l.vehicle).join('-');
  return {
    id: `transit-${departMs}-${signature}`,
    provider: 'transitous',
    origin: req.origin,
    destination: req.destination,
    geometry,
    distanceM,
    durationS,
    legs: [{ distanceM, durationS, summary: '', steps }],
    segments,
    segmentSource: 'steps',
    bbox: bboxOf(geometry),
    computedAt: Date.now(),
    transit,
  };
}

/** The router names the ends of the trip START / END; GTFS names sometimes carry doubled quotes. */
function cleanStopName(name: string): string {
  if (name === 'START' || name === 'END') return '';
  return name.replace(/""/g, '"').trim();
}
