import type { LngLat } from '../../types/geo';
import type { Lane, Route, RouteLeg, RouteSegment, RouteStep, TimingSource } from '../../types/route';
import { bboxOf } from '../../utils/distance';
import { fetchJson, ProviderError } from '../http';
import type { RouteRequest, RoutingCapabilities, RoutingProvider, TravelMatrix } from './RoutingProvider';

// --- Raw OSRM response shapes (never leave this file) ---
interface OsrmIntersection {
  location: LngLat;
  lanes?: { indications: string[]; valid: boolean }[];
  classes?: string[];
}
interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  ref?: string;
  destinations?: string;
  rotary_name?: string;
  driving_side?: 'left' | 'right';
  geometry?: { coordinates: LngLat[] };
  intersections?: OsrmIntersection[];
  maneuver: {
    type: string;
    modifier?: string;
    location: LngLat;
    exit?: number;
    bearing_before?: number;
    bearing_after?: number;
  };
}
interface OsrmLeg {
  distance: number;
  duration: number;
  summary: string;
  steps: OsrmStep[];
  annotation?: { duration?: number[]; distance?: number[]; speed?: number[] };
}
interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: LngLat[] };
  legs: OsrmLeg[];
}
interface OsrmResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
}

const coordParam = ([lon, lat]: LngLat) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

export class OSRMProvider implements RoutingProvider {
  readonly name = 'osrm';

  constructor(
    private baseUrl: string,
    private profile = 'driving',
    private timeoutMs = 20000,
    /**
     * Declared, verified capabilities. The public demo server returns
     * alternatives, lanes and a table service, but rejects every `exclude`
     * (avoid) flag — so no avoid options are offered by default.
     */
    readonly capabilities: RoutingCapabilities = {
      alternatives: true,
      avoid: [],
      laneGuidance: true,
      matrix: true,
      multiStop: true,
    },
  ) {}

  async calculateRoutes(req: RouteRequest): Promise<Route[]> {
    const points = [req.origin, ...(req.waypoints ?? []), req.destination];
    const coords = points.map((p) => coordParam(p.coordinate)).join(';');
    const params = new URLSearchParams({
      overview: 'full',
      geometries: 'geojson',
      steps: 'true',
      annotations: 'duration,distance',
      // OSRM only computes alternatives for two-point requests.
      alternatives: req.alternatives && this.capabilities.alternatives && points.length === 2 ? 'true' : 'false',
    });
    if (req.startBearingDeg !== undefined && Number.isFinite(req.startBearingDeg)) {
      params.set('bearings', [`${Math.round(req.startBearingDeg) % 360},60`, ...points.slice(1).map(() => '')].join(';'));
    }
    const exclude = (req.avoid ?? [])
      .filter((a) => this.capabilities.avoid.includes(a))
      .map((a) => ({ tolls: 'toll', highways: 'motorway', ferries: 'ferry' })[a]);
    if (exclude.length) params.set('exclude', exclude.join(','));
    const url = `${this.base}/route/v1/${encodeURIComponent(this.profile)}/${coords}?${params}`;
    const data = await fetchJson<OsrmResponse>(url, {
      provider: 'Routing service',
      signal: req.signal,
      timeoutMs: this.timeoutMs,
    });
    if (data.code !== 'Ok' || !data.routes?.length) {
      const kind = data.code === 'NoRoute' || data.code === 'NoSegment' ? 'no-route' : 'invalid-response';
      throw new ProviderError(data.message ?? `Routing failed (${data.code})`, kind, 'Routing service');
    }
    return data.routes.map((r) => normalizeOsrmRoute(r, req));
  }

  /** OSRM table service: real driving durations/distances (used for detours). */
  async travelMatrix(sources: LngLat[], destinations: LngLat[], signal?: AbortSignal): Promise<TravelMatrix> {
    const all = [...sources, ...destinations];
    const params = new URLSearchParams({
      sources: sources.map((_, i) => i).join(';'),
      destinations: destinations.map((_, i) => sources.length + i).join(';'),
      annotations: 'duration,distance',
    });
    const url = `${this.base}/table/v1/${encodeURIComponent(this.profile)}/${all.map(coordParam).join(';')}?${params}`;
    const data = await fetchJson<{ code: string; durations?: (number | null)[][]; distances?: (number | null)[][] }>(
      url,
      { provider: 'Routing service', signal, timeoutMs: this.timeoutMs },
    );
    if (data.code !== 'Ok' || !data.durations) {
      throw new ProviderError(`Travel matrix failed (${data.code})`, 'invalid-response', 'Routing service');
    }
    return { durations: data.durations, distances: data.distances ?? data.durations.map((r) => r.map(() => null)) };
  }

  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }
}

/** Convert an OSRM route into the app's normalized Route. Exported for tests. */
export function normalizeOsrmRoute(
  raw: OsrmRoute,
  req: Pick<RouteRequest, 'origin' | 'destination' | 'waypoints'>,
): Route {
  const geometry = raw.geometry.coordinates;
  if (geometry.length < 2) {
    throw new ProviderError('Route geometry is empty', 'invalid-response', 'Routing service');
  }

  // Align legs/steps to geometry vertex indices by walking step geometries.
  const legs: RouteLeg[] = [];
  let vertex = 0;
  let stepsAligned = true;
  for (const leg of raw.legs) {
    const steps: RouteStep[] = [];
    for (const s of leg.steps) {
      const n = s.geometry?.coordinates.length ?? 0;
      const fromIndex = vertex;
      const toIndex = Math.min(geometry.length - 1, vertex + Math.max(0, n - 1));
      if (!s.geometry || n === 0) stepsAligned = false;
      const first = s.intersections?.[0];
      const classes = [...new Set((s.intersections ?? []).flatMap((it) => it.classes ?? []))];
      steps.push({
        distanceM: s.distance,
        durationS: s.duration,
        name: s.name ?? '',
        ref: s.ref || undefined,
        destinations: s.destinations || undefined,
        rotaryName: s.rotary_name || undefined,
        maneuverType: s.maneuver.type,
        maneuverModifier: s.maneuver.modifier,
        exit: s.maneuver.exit,
        location: s.maneuver.location,
        bearingBefore: s.maneuver.bearing_before,
        bearingAfter: s.maneuver.bearing_after,
        // Lanes at the maneuver point (first intersection of the step) — real data only.
        lanes: first?.lanes?.length ? first.lanes.map((l): Lane => ({ indications: [...l.indications], valid: !!l.valid })) : undefined,
        classes: classes.length ? classes : undefined,
        drivingSide: s.driving_side,
        fromIndex,
        toIndex,
      });
      vertex = toIndex;
    }
    legs.push({ distanceM: leg.distance, durationS: leg.duration, summary: leg.summary, steps });
  }

  let segments = segmentsFromAnnotations(raw, geometry.length);
  let segmentSource: TimingSource = 'annotations';
  if (!segments) {
    segments = stepsAligned ? segmentsFromSteps(legs) : null;
    segmentSource = 'steps';
  }
  if (!segments || segments.length === 0) {
    segments = [
      { fromIndex: 0, toIndex: geometry.length - 1, distanceM: raw.distance, durationS: raw.duration },
    ];
    segmentSource = 'proportional';
  }

  return {
    id: `route-${hashCoords(geometry)}-${Math.round(raw.distance)}`,
    provider: 'osrm',
    origin: req.origin,
    destination: req.destination,
    waypoints: req.waypoints?.length ? req.waypoints : undefined,
    geometry,
    distanceM: raw.distance,
    durationS: raw.duration,
    legs,
    segments,
    segmentSource,
    bbox: bboxOf(geometry),
    computedAt: Date.now(),
  };
}

/**
 * Per-edge segments from OSRM annotations. OSRM's leg duration includes
 * turn penalties that per-edge annotations omit, so each leg's annotation
 * durations are scaled to sum to the leg duration.
 */
function segmentsFromAnnotations(raw: OsrmRoute, vertexCount: number): RouteSegment[] | null {
  const segments: RouteSegment[] = [];
  let vertex = 0;
  for (const leg of raw.legs) {
    const durs = leg.annotation?.duration;
    const dists = leg.annotation?.distance;
    if (!durs || !dists || durs.length !== dists.length) return null;
    const sum = durs.reduce((a, b) => a + b, 0);
    const scale = sum > 0 ? leg.duration / sum : 1;
    for (let i = 0; i < durs.length; i++) {
      const durationS = durs[i] * scale;
      segments.push({
        fromIndex: vertex,
        toIndex: vertex + 1,
        distanceM: dists[i],
        durationS,
        speedMps: durationS > 0 ? dists[i] / durationS : undefined,
      });
      vertex++;
    }
  }
  // Annotation edges must match the overview geometry exactly.
  return vertex === vertexCount - 1 ? segments : null;
}

function segmentsFromSteps(legs: RouteLeg[]): RouteSegment[] {
  const out: RouteSegment[] = [];
  for (const leg of legs) {
    for (const s of leg.steps) {
      if (s.fromIndex === undefined || s.toIndex === undefined || s.toIndex <= s.fromIndex) continue;
      out.push({
        fromIndex: s.fromIndex,
        toIndex: s.toIndex,
        distanceM: s.distanceM,
        durationS: s.durationS,
        speedMps: s.durationS > 0 ? s.distanceM / s.durationS : undefined,
      });
    }
  }
  return out;
}

function hashCoords(coords: LngLat[]): string {
  let h = 2166136261;
  const stride = Math.max(1, Math.floor(coords.length / 64));
  for (let i = 0; i < coords.length; i += stride) {
    h ^= Math.round(coords[i][0] * 1e5);
    h = Math.imul(h, 16777619);
    h ^= Math.round(coords[i][1] * 1e5);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
