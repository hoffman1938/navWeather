/**
 * Live location sharing — wire format shared by the app and the Cloudflare
 * Worker relay. Pure data + validation (no DOM, no Workers APIs), so both
 * sides import the same rules.
 *
 * Privacy model: the relay keeps only the LATEST position of an active share
 * (overwritten on every update, never a trail) and deletes everything when
 * the sharer stops or the share expires. The share id is a random 128-bit
 * capability: anyone holding the link can watch until then.
 */
import type { LngLat } from '../types/geo';

export const SHARE_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const MIN_SHARE_MINUTES = 15;
export const MAX_SHARE_MINUTES = 24 * 60;
export const MAX_ROUTE_POINTS = 500;
export const MAX_BODY_BYTES = 48_000;
/** The relay drops updates arriving faster than this. */
export const MIN_UPDATE_INTERVAL_MS = 1000;

export interface SharePosition {
  /** [lon, lat] */
  c: LngLat;
  /** Accuracy radius, m. */
  acc?: number;
  /** Heading, degrees clockwise from north. */
  hdg?: number;
  /** Speed, m/s. */
  spd?: number;
  /** When the fix was taken (UTC ms, sender clock). */
  t: number;
}

export interface ShareTrip {
  dest: { name: string; c: LngLat };
  /** Expected arrival (UTC ms). */
  eta?: number;
  /** Remaining distance, m. */
  remM?: number;
  /** Identifies the route geometry so it is sent once, not with every update. */
  routeId?: string;
  route?: LngLat[];
}

export interface ShareUpdate {
  pos: SharePosition;
  /** null clears the trip (navigation ended). */
  trip?: ShareTrip | null;
  /** The sender is running a simulated drive (demo), not real GPS. */
  sim?: boolean;
}

export interface ShareCreate {
  minutes: number;
  name?: string;
}

/** What viewers receive. */
export interface ShareSnapshot {
  v: 1;
  name?: string;
  pos: SharePosition | null;
  trip: ShareTrip | null;
  sim: boolean;
  startedAt: number;
  expiresAt: number;
  /** Relay clock when the latest update arrived. */
  updatedAt: number | null;
}

export type ServerMessage = { type: 'snapshot'; snapshot: ShareSnapshot } | { type: 'ended' };

// ---------------------------------------------------------------------------

const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

function coord(v: unknown): LngLat | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const lon = num(v[0], -180, 180);
  const lat = num(v[1], -90, 90);
  return lon === undefined || lat === undefined ? null : [round(lon, 6), round(lat, 6)];
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Printable single-line text, trimmed and capped (display names only). */
export function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v
    // Control and invisible format characters (incl. bidi overrides, zero-width).
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return s || undefined;
}

export function sanitizeCreate(raw: unknown, now: number): { expiresAt: number; name?: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const minutes = num(r.minutes, MIN_SHARE_MINUTES, MAX_SHARE_MINUTES);
  if (minutes === undefined) return null;
  return { expiresAt: now + Math.round(minutes) * 60_000, name: cleanText(r.name, 40) };
}

function sanitizeTrip(raw: unknown, now: number): ShareTrip | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const d = r.dest as Record<string, unknown> | undefined;
  const destC = d && typeof d === 'object' ? coord(d.c) : null;
  const destName = d && typeof d === 'object' ? cleanText(d.name, 80) : undefined;
  if (!destC || !destName) return undefined;
  const trip: ShareTrip = { dest: { name: destName, c: destC } };
  const eta = num(r.eta, now - 3_600_000, now + 14 * 86_400_000);
  if (eta !== undefined) trip.eta = Math.round(eta);
  const remM = num(r.remM, 0, 40_000_000);
  if (remM !== undefined) trip.remM = Math.round(remM);
  if (typeof r.routeId === 'string' && /^[A-Za-z0-9:_.-]{1,64}$/.test(r.routeId)) trip.routeId = r.routeId;
  if (Array.isArray(r.route) && trip.routeId) {
    if (r.route.length < 2 || r.route.length > MAX_ROUTE_POINTS) return undefined;
    const pts: LngLat[] = [];
    for (const p of r.route) {
      const c = coord(p);
      if (!c) return undefined;
      pts.push([round(c[0], 5), round(c[1], 5)]);
    }
    trip.route = pts;
  }
  return trip;
}

/** Validate an update from the sharer; null when unusable. */
export function sanitizeUpdate(raw: unknown, now: number): ShareUpdate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const p = r.pos as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return null;
  const c = coord(p.c);
  if (!c) return null;
  // Trust the sender's clock only within reason.
  const t = num(p.t, now - 10 * 60_000, now + 60_000) ?? now;
  const pos: SharePosition = { c, t: Math.round(t) };
  const acc = num(p.acc, 0, 100_000);
  if (acc !== undefined) pos.acc = Math.round(acc);
  const hdg = num(p.hdg, 0, 360);
  if (hdg !== undefined) pos.hdg = Math.round(hdg);
  const spd = num(p.spd, 0, 150);
  if (spd !== undefined) pos.spd = round(spd, 1);
  const update: ShareUpdate = { pos };
  if ('trip' in r) {
    const trip = sanitizeTrip(r.trip, now);
    if (trip !== undefined) update.trip = trip;
  }
  if (r.sim === true) update.sim = true;
  return update;
}

export interface ShareState {
  pos: SharePosition | null;
  trip: ShareTrip | null;
  sim: boolean;
  updatedAt: number | null;
}

/**
 * Apply an update to the stored state. The route geometry is kept from the
 * previous trip when the route id is unchanged (it is only sent once).
 */
export function mergeUpdate(prev: ShareState, u: ShareUpdate, now: number): ShareState {
  let trip = prev.trip;
  if (u.trip === null) trip = null;
  else if (u.trip) {
    const keepRoute = !u.trip.route && u.trip.routeId && prev.trip?.routeId === u.trip.routeId ? prev.trip.route : undefined;
    trip = { ...u.trip, ...(keepRoute ? { route: keepRoute } : {}) };
  }
  return { pos: u.pos, trip, sim: u.sim === true, updatedAt: now };
}

/** True when the relay still needs this trip's geometry. */
export function needsRoute(state: ShareState): boolean {
  return !!state.trip?.routeId && !state.trip.route;
}
