import type { LngLat } from '../types/geo';

/**
 * `/api/v1/route` and `/api/v1/route/matrix` (DEVELOPMENT_PLAN DP-5.2, DP-6.2): our Valhalla, behind the Worker.
 * Platform-neutral: the Worker validates with these functions and builds the engine's request; the app sends the
 * request shape below. Answers are OSRM v5 JSON (Valhalla's `format: "osrm"`), which the app's OSRM normaliser
 * reads — one road format for every router.
 */

export type RouteMode = 'drive' | 'walk' | 'bike';
export type RouteAvoid = 'tolls' | 'highways' | 'ferries';

export interface RouteApiRequest {
  mode: RouteMode;
  /** Origin, stops, destination; `via` marks silent points the road passes through (no stop, no instruction). */
  points: { lon: number; lat: number; via?: boolean }[];
  /** Alternatives to ask for besides the best road (0–2; only between two points). */
  alternatives?: number;
  avoid?: RouteAvoid[];
  /** Current heading at the origin (re-routing a moving car), degrees. */
  bearingDeg?: number;
  language?: string;
}

export interface MatrixApiRequest {
  mode: RouteMode;
  sources: LngLat[];
  destinations: LngLat[];
}

/** Valhalla's service limits for cars (valhalla.json): 20 locations, 2 alternatives. */
export const MAX_ROUTE_POINTS = 20;
export const MAX_MATRIX = 50;
const MODES: RouteMode[] = ['drive', 'walk', 'bike'];
const AVOID: RouteAvoid[] = ['tolls', 'highways', 'ferries'];
const COSTING: Record<RouteMode, string> = { drive: 'auto', walk: 'pedestrian', bike: 'bicycle' };
/** A silent via point far from any road means "no road there", not "the nearest road in the country". */
const VIA_SEARCH_CUTOFF_M = 8000;

const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const lonLat = (p: unknown): LngLat | null => (Array.isArray(p) && p.length === 2 && num(p[0], -180, 180) && num(p[1], -90, 90) ? [p[0], p[1]] : null);

export function sanitizeRouteRequest(raw: unknown): RouteApiRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!MODES.includes(r.mode as RouteMode) || !Array.isArray(r.points) || r.points.length < 2 || r.points.length > MAX_ROUTE_POINTS) return null;
  const points: RouteApiRequest['points'] = [];
  for (const [i, p] of r.points.entries()) {
    const o = p as Record<string, unknown>;
    if (!o || !num(o.lon, -180, 180) || !num(o.lat, -90, 90)) return null;
    const via = o.via === true && i > 0 && i < r.points.length - 1;
    points.push({ lon: o.lon, lat: o.lat, ...(via ? { via: true } : {}) });
  }
  const alternatives = num(r.alternatives, 0, 3) ? Math.min(2, Math.round(r.alternatives)) : 0;
  const avoid = Array.isArray(r.avoid) ? [...new Set(r.avoid.filter((a): a is RouteAvoid => AVOID.includes(a as RouteAvoid)))] : [];
  return {
    mode: r.mode as RouteMode,
    points,
    ...(alternatives ? { alternatives } : {}),
    ...(avoid.length ? { avoid } : {}),
    ...(num(r.bearingDeg, -360, 720) ? { bearingDeg: ((Math.round(r.bearingDeg) % 360) + 360) % 360 } : {}),
    language: r.language === 'ru' ? 'ru' : 'en',
  };
}

export function sanitizeMatrixRequest(raw: unknown): MatrixApiRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!MODES.includes(r.mode as RouteMode) || !Array.isArray(r.sources) || !Array.isArray(r.destinations)) return null;
  if (!r.sources.length || !r.destinations.length || r.sources.length * r.destinations.length > MAX_MATRIX * 4 || r.sources.length > MAX_MATRIX || r.destinations.length > MAX_MATRIX) return null;
  const sources = r.sources.map(lonLat);
  const destinations = r.destinations.map(lonLat);
  if (sources.some((p) => !p) || destinations.some((p) => !p)) return null;
  return { mode: r.mode as RouteMode, sources: sources as LngLat[], destinations: destinations as LngLat[] };
}

function costingOptions(req: Pick<RouteApiRequest, 'mode' | 'avoid'>) {
  const avoid = req.avoid ?? [];
  if (!avoid.length || req.mode === 'walk') return undefined;
  const key = COSTING[req.mode];
  return {
    [key]: {
      ...(avoid.includes('tolls') ? { use_tolls: 0 } : {}),
      ...(avoid.includes('highways') ? { use_highways: 0 } : {}),
      ...(avoid.includes('ferries') ? { use_ferry: 0 } : {}),
    },
  };
}

/** The Valhalla `/route` request for a validated API request (OSRM-shaped answer, GeoJSON geometry). */
export function valhallaRouteRequest(req: RouteApiRequest) {
  const options = costingOptions(req);
  return {
    locations: req.points.map((p, i) => ({
      lon: p.lon,
      lat: p.lat,
      type: p.via ? 'through' : 'break',
      ...(p.via ? { search_cutoff: VIA_SEARCH_CUTOFF_M } : {}),
      ...(i === 0 && req.bearingDeg !== undefined ? { heading: req.bearingDeg, heading_tolerance: 60 } : {}),
    })),
    costing: COSTING[req.mode],
    ...(options ? { costing_options: options } : {}),
    ...(req.alternatives && req.points.length === 2 ? { alternates: req.alternatives } : {}),
    format: 'osrm',
    shape_format: 'geojson',
    directions_options: { units: 'kilometers', language: req.language === 'ru' ? 'ru-RU' : 'en-US' },
    banner_instructions: false,
    voice_instructions: false,
  };
}

export function valhallaMatrixRequest(req: MatrixApiRequest) {
  return {
    sources: req.sources.map(([lon, lat]) => ({ lon, lat })),
    targets: req.destinations.map(([lon, lat]) => ({ lon, lat })),
    costing: COSTING[req.mode],
  };
}

/**
 * The engine's answer in our API's words. With `format: "osrm"` Valhalla answers errors the OSRM way: a point
 * that snaps to no road of the graph (another region) is `NoSegment` → `outside-region` (the app may ask its
 * fallback router), no path is `NoRoute` → `no-route`; Valhalla's own codes are mapped too.
 */
export function routeErrorOf(body: { code?: string; error_code?: number } | null): { status: number; error: string } {
  if (body?.code === 'NoSegment' || body?.error_code === 171 || body?.error_code === 170) return { status: 422, error: 'outside-region' };
  if (body?.code === 'NoRoute' || body?.error_code === 442 || body?.error_code === 443) return { status: 404, error: 'no-route' };
  if (body?.error_code === 154 || body?.error_code === 155) return { status: 422, error: 'too-far' };
  return { status: 502, error: 'engine-error' };
}
