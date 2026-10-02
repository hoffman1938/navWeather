import type { LngLat } from '../types/geo';

/**
 * Encoded polylines (Google's algorithm) with an explicit precision —
 * 5 for our own trip-planning requests, 6/7 from MOTIS (Transitous).
 */

/** Decode an encoded polyline (Google's algorithm) with `precision` decimal places. */
export function decodePolyline(encoded: string, precision = 6): LngLat[] {
  const factor = 10 ** precision;
  const out: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  // Plain arithmetic, not 32-bit bit operations: at precision 7 a longitude overflows them.
  const next = (): number | null => {
    let result = 0;
    let scale = 1;
    let byte: number;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      result += (byte & 0x1f) * scale;
      scale *= 32;
    } while (byte >= 0x20);
    return result % 2 ? -(result + 1) / 2 : result / 2;
  };
  while (index < encoded.length) {
    const dLat = next();
    const dLon = next();
    if (dLat === null || dLon === null) break;
    lat += dLat;
    lon += dLon;
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

/** Encode `[lon, lat]` points as a polyline with `precision` decimal places. */
export function encodePolyline(points: LngLat[], precision = 5): string {
  const factor = 10 ** precision;
  let out = '';
  let prevLat = 0;
  let prevLon = 0;
  const put = (value: number) => {
    // Zigzag without 32-bit operators (safe for large values at high precision).
    let n = value < 0 ? -value * 2 - 1 : value * 2;
    while (n >= 32) {
      out += String.fromCharCode((32 | (n % 32)) + 63);
      n = Math.floor(n / 32);
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of points) {
    const la = Math.round(lat * factor);
    const lo = Math.round(lon * factor);
    put(la - prevLat);
    put(lo - prevLon);
    prevLat = la;
    prevLon = lo;
  }
  return out;
}
