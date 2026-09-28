import type { Place } from '../types/geo';
import { SHARE_ID_RE } from './protocol';

/** A place link: `/?p=lat,lon&n=Name`. Contains only that spot — never the sender's position. */
export function placeUrl(place: Place, origin = location.origin): string {
  const [lon, lat] = place.coordinate;
  const u = new URL('/', origin);
  u.searchParams.set('p', `${lat.toFixed(5)},${lon.toFixed(5)}`);
  if (place.name && place.kind !== 'pin') u.searchParams.set('n', place.name.slice(0, 80));
  return u.toString();
}

export function parsePlaceUrl(search: string): Place | null {
  const q = new URLSearchParams(search);
  const p = /^\s*(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q.get('p') ?? '');
  if (!p) return null;
  const lat = Number(p[1]);
  const lon = Number(p[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const name = (q.get('n') ?? '').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return { id: `link:${lat.toFixed(5)},${lon.toFixed(5)}`, name: name || coords, label: coords, coordinate: [lon, lat], kind: name ? 'shared' : 'pin' };
}

export function liveUrl(id: string, origin = location.origin): string {
  return new URL(`/live/${id}`, origin).toString();
}

export function parseLiveUrl(pathname: string): string | null {
  const m = /^\/live\/([^/]+)\/?$/.exec(pathname);
  return m && SHARE_ID_RE.test(m[1]) ? m[1] : null;
}

/** The system share sheet exists (phones, some desktops). */
export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function nativeShare(data: { title: string; text?: string; url: string }): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await navigator.share(data);
    return 'shared';
  } catch (e) {
    return (e as DOMException)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
