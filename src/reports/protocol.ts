/**
 * Driver reports — wire format and rules shared by the app and the Worker.
 * Pure data + validation (no DOM, no Workers APIs).
 *
 * Model (Waze-like, kept deliberately small):
 *  - anyone driving can report an accident, a hazard, road works, a closure
 *    or dangerous road weather at their current position;
 *  - reports are UNVERIFIED and shown as "reported"; they expire by kind;
 *  - drivers passing by answer "still there?" — confirmations extend a
 *    report, denials end it;
 *  - no accounts; the relay keeps no IP addresses, only a salted hash (salt
 *    rotated daily, never leaves the server) to stop duplicate votes and floods.
 */

export type ReportKind = 'accident' | 'hazard' | 'roadworks' | 'closure' | 'weather';
export const REPORT_KINDS: ReportKind[] = ['accident', 'hazard', 'roadworks', 'closure', 'weather'];

/** How long a new report lives, minutes. */
export const REPORT_TTL_MIN: Record<ReportKind, number> = {
  accident: 60,
  hazard: 45,
  weather: 90,
  closure: 6 * 60,
  roadworks: 12 * 60,
};

export const REPORT_ID_RE = /^[A-Za-z0-9_-]{16}$/;
export const MAX_REPORT_BODY = 300;
/** A second report of the same kind this close counts as a confirmation. */
export const DEDUPE_M = 150;
/** Largest area one list request may cover (deg²). */
export const MAX_BBOX_AREA = 36;
export const MAX_LIST = 400;

export type Vote = 'still' | 'gone';

export interface PublicReport {
  id: string;
  kind: ReportKind;
  lat: number;
  lon: number;
  createdAt: number;
  expiresAt: number;
  confirms: number;
  denies: number;
}

export function sanitizeReport(body: unknown): { kind: ReportKind; lat: number; lon: number } | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const kind = o.kind as ReportKind;
  if (!REPORT_KINDS.includes(kind)) return null;
  const lat = o.lat;
  const lon = o.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  // ~1 m is plenty; more digits add nothing but fingerprinting.
  return { kind, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
}

export function sanitizeVote(body: unknown): Vote | null {
  const v = body && typeof body === 'object' ? (body as Record<string, unknown>).vote : undefined;
  return v === 'still' || v === 'gone' ? v : null;
}

/** "w,s,e,n" → bounds, or null when malformed or too large. */
export function parseBbox(q: string | null): [number, number, number, number] | null {
  if (!q) return null;
  const parts = q.split(',').map(Number);
  if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) return null;
  const [w, s, e, n] = parts;
  if (w >= e || s >= n || w < -180 || e > 180 || s < -85 || n > 85) return null;
  if ((e - w) * (n - s) > MAX_BBOX_AREA) return null;
  return [w, s, e, n];
}

/**
 * A vote's effect: "still there" extends the report (to at least half its
 * lifetime from now, never beyond 3× its lifetime in total); "gone" ends it
 * once at least two drivers say so and they outnumber the confirmations.
 */
export function applyVote(
  r: Pick<PublicReport, 'kind' | 'createdAt' | 'expiresAt' | 'confirms' | 'denies'>,
  vote: Vote,
  now: number,
): Pick<PublicReport, 'expiresAt' | 'confirms' | 'denies'> {
  const ttl = REPORT_TTL_MIN[r.kind] * 60_000;
  if (vote === 'still') {
    const confirms = r.confirms + 1;
    return { confirms, denies: r.denies, expiresAt: Math.min(r.createdAt + 3 * ttl, Math.max(r.expiresAt, now + ttl / 2)) };
  }
  const denies = r.denies + 1;
  return { confirms: r.confirms, denies, expiresAt: denies >= 2 && denies > r.confirms ? now : r.expiresAt };
}

/** Rough ground distance, m (enough for de-duplication). */
export function approxDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const x = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180) * 111_320;
  const y = (lat2 - lat1) * 110_540;
  return Math.hypot(x, y);
}
