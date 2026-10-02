import type { Place } from '../types/geo';
import { NAVIGABLE_MODES, type TravelMode } from '../types/travel';

/**
 * RESUME AFTER AN ACCIDENTAL RELOAD — while navigating, the destination and
 * the stops still ahead are kept in this tab's sessionStorage (gone when the
 * tab closes; never positions, never the route travelled). A reload within
 * 30 min of the last update offers "Continue to …"; nothing starts by itself.
 */

const KEY = 'navweather.drive.v1';
const MAX_AGE_MS = 30 * 60_000;

export interface DriveSession {
  destination: Place;
  waypoints: Place[];
  savedAt: number;
  /** How the trip was being made (a walk is resumed as a walk). */
  mode: TravelMode;
}

function cleanPlace(p: unknown): Place | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const c = o.coordinate;
  if (!Array.isArray(c) || c.length !== 2 || !c.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const [lon, lat] = c as [number, number];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
  const name = str(o.name) || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return { id: str(o.id, 100) || `${lat},${lon}`, name, label: str(o.label) || name, coordinate: [lon, lat], ...(typeof o.kind === 'string' ? { kind: str(o.kind, 40) } : {}) };
}

export function saveDriveSession(destination: Place, waypoints: Place[], now = Date.now(), mode: TravelMode = 'drive'): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ destination, waypoints, savedAt: now, mode }));
  } catch {
    /* storage blocked: nothing to resume, which is fine */
  }
}

export function clearDriveSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function readDriveSession(now = Date.now()): DriveSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const destination = cleanPlace(o.destination);
    const savedAt = typeof o.savedAt === 'number' ? o.savedAt : 0;
    if (!destination || now - savedAt > MAX_AGE_MS || savedAt > now + 60_000) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    const waypoints = Array.isArray(o.waypoints) ? o.waypoints.map(cleanPlace).filter((p): p is Place => p !== null).slice(0, 10) : [];
    const mode = NAVIGABLE_MODES.includes(o.mode as TravelMode) ? (o.mode as TravelMode) : 'drive';
    return { destination, waypoints, savedAt, mode };
  } catch {
    return null;
  }
}
