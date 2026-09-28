/**
 * Solar position (NOAA simplified algorithm). Computed locally so day/night
 * styling needs no extra API calls and works for any place and date.
 */

const DEG = Math.PI / 180;

function julianCentury(utcMs: number): number {
  const jd = utcMs / 86400000 + 2440587.5;
  return (jd - 2451545) / 36525;
}

/** Solar elevation angle in degrees at a place and instant. */
export function solarElevationDeg(lat: number, lon: number, utcMs: number): number {
  return solarPosition(lat, lon, utcMs).elevationDeg;
}

/** Sun elevation above the horizon and azimuth (degrees clockwise from north). */
export function solarPosition(lat: number, lon: number, utcMs: number): { elevationDeg: number; azimuthDeg: number } {
  const T = julianCentury(utcMs);
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * DEG) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * DEG) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * DEG) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG);
  const decl = Math.asin(Math.sin(eps * DEG) * Math.sin(lambda * DEG));
  const y = Math.tan((eps / 2) * DEG) ** 2;
  const eqTime =
    4 *
    (y * Math.sin(2 * L0 * DEG) -
      2 * e * Math.sin(M * DEG) +
      4 * e * y * Math.sin(M * DEG) * Math.cos(2 * L0 * DEG) -
      0.5 * y * y * Math.sin(4 * L0 * DEG) -
      1.25 * e * e * Math.sin(2 * M * DEG)) /
    DEG;
  const d = new Date(utcMs);
  const minutesUtc = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let trueSolarTime = (minutesUtc + eqTime + 4 * lon) % 1440;
  if (trueSolarTime < 0) trueSolarTime += 1440;
  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  const cosZenith =
    Math.sin(lat * DEG) * Math.sin(decl) + Math.cos(lat * DEG) * Math.cos(decl) * Math.cos(hourAngle * DEG);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith))) / DEG;
  // NOAA azimuth.
  const azDenom = Math.cos(lat * DEG) * Math.sin(zenith * DEG);
  let azimuth: number;
  if (Math.abs(azDenom) > 0.001) {
    const azRad = Math.max(-1, Math.min(1, (Math.sin(lat * DEG) * Math.cos(zenith * DEG) - Math.sin(decl)) / azDenom));
    azimuth = 180 - Math.acos(azRad) / DEG;
    if (hourAngle > 0) azimuth = -azimuth;
  } else azimuth = lat > 0 ? 180 : 0;
  if (azimuth < 0) azimuth += 360;
  return { elevationDeg: 90 - zenith, azimuthDeg: azimuth % 360 };
}

/** Sun above the horizon (accounting for refraction and the solar disc). */
export function isDaylight(lat: number, lon: number, utcMs: number): boolean {
  return solarElevationDeg(lat, lon, utcMs) > -0.833;
}

/**
 * Next sunrise or sunset strictly after `fromMs` and before `toMs`, found by
 * scanning solar elevation (10-min steps, then bisection to ~30 s).
 */
export function findSunTransition(
  lat: number,
  lon: number,
  fromMs: number,
  toMs: number,
): { type: 'sunrise' | 'sunset'; atMs: number } | null {
  const step = 10 * 60000;
  let prevT = fromMs;
  let prevDay = isDaylight(lat, lon, prevT);
  for (let t = fromMs + step; t <= toMs + step; t += step) {
    const tt = Math.min(t, toMs);
    const day = isDaylight(lat, lon, tt);
    if (day !== prevDay) {
      let lo = prevT;
      let hi = tt;
      while (hi - lo > 30000) {
        const mid = (lo + hi) / 2;
        if (isDaylight(lat, lon, mid) === prevDay) lo = mid;
        else hi = mid;
      }
      return { type: day ? 'sunrise' : 'sunset', atMs: Math.round(hi) };
    }
    prevT = tt;
    prevDay = day;
    if (tt >= toMs) break;
  }
  return null;
}
