import type { LngLat } from '../types/geo';
import type { LocationForecast } from '../types/weather';
import { matchForecastToTime } from './weatherMatching';

/**
 * WEATHER LAYER — a coarse forecast field over the visible map: an n×n grid
 * of forecast points (one batched request), bilinearly interpolated into a
 * small image for any hour ahead. It is a forecast, never shown as radar.
 */

export type LayerKind = 'precip' | 'temp';

/** [west, south, east, north] */
export type Bounds = [number, number, number, number];

/** Row-major grid points, north → south rows, west → east columns. */
export function gridPoints([w, s, e, n]: Bounds, size: number): LngLat[] {
  const out: LngLat[] = [];
  for (let r = 0; r < size; r++) {
    const lat = n - ((n - s) * r) / (size - 1);
    for (let c = 0; c < size; c++) out.push([w + ((e - w) * c) / (size - 1), lat]);
  }
  return out;
}

/** Value per grid point at `atMs` (hour containing it): mm of precipitation or °C. */
export function gridValues(forecasts: (LocationForecast | undefined)[], atMs: number, kind: LayerKind): (number | null)[] {
  return forecasts.map((f) => {
    const w = f ? matchForecastToTime(f, atMs) : null;
    if (!w) return null;
    return kind === 'precip' ? (w.precipitation ?? 0) : w.temperature;
  });
}

/** Bilinear interpolation at fractional grid position (fx: 0..size-1 west→east, fy: 0..size-1 north→south). */
export function bilinear(values: (number | null)[], size: number, fx: number, fy: number): number | null {
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(fy)));
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v = (x: number, y: number) => values[y * size + x];
  const corners = [v(x0, y0), v(x1, y0), v(x0, y1), v(x1, y1)];
  const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  let sum = 0;
  let wsum = 0;
  corners.forEach((c, i) => {
    if (c === null) return;
    sum += c * weights[i];
    wsum += weights[i];
  });
  return wsum > 0 ? sum / wsum : null;
}

type RGBA = [number, number, number, number];

function lerpStops(stops: [number, RGBA][], v: number): RGBA {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i];
    if (v <= b) {
      const [a, ca] = stops[i - 1];
      const t = (v - a) / (b - a);
      return ca.map((x, k) => Math.round(x + (cb[k] - x) * t)) as RGBA;
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Precipitation mm/h → radar-like colours; dry is transparent. The fade-in
 * is spread over 0.05–0.5 mm so the coarse grid doesn't draw hard edges.
 */
export const PRECIP_STOPS: [number, RGBA][] = [
  [0.05, [110, 170, 255, 0]],
  [0.5, [110, 170, 255, 85]],
  [1.5, [40, 110, 230, 145]],
  [3, [20, 60, 190, 190]],
  [6, [140, 50, 200, 205]],
  [12, [220, 40, 150, 215]],
];

/** Temperature °C → cold purple/blue … hot red. */
export const TEMP_STOPS: [number, RGBA][] = [
  [-15, [110, 60, 180, 150]],
  [-5, [60, 110, 220, 150]],
  [0, [80, 170, 230, 150]],
  [8, [90, 190, 150, 140]],
  [16, [200, 210, 80, 140]],
  [24, [240, 160, 50, 150]],
  [32, [220, 60, 40, 160]],
];

export function colorFor(kind: LayerKind, v: number): RGBA {
  return lerpStops(kind === 'precip' ? PRECIP_STOPS : TEMP_STOPS, v);
}

/** Paint the interpolated field into an RGBA buffer of `px`×`px`. */
export function renderField(values: (number | null)[], size: number, kind: LayerKind, px: number): Uint8ClampedArray<ArrayBuffer> {
  const buf = new Uint8ClampedArray(new ArrayBuffer(px * px * 4));
  for (let y = 0; y < px; y++) {
    const fy = (y / (px - 1)) * (size - 1);
    for (let x = 0; x < px; x++) {
      const v = bilinear(values, size, (x / (px - 1)) * (size - 1), fy);
      if (v === null) continue;
      const c = colorFor(kind, v);
      const o = (y * px + x) * 4;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
      buf[o + 3] = c[3];
    }
  }
  return buf;
}

/** Whether `inner` lies within `outer` (for "does the fetched grid still cover the view?"). */
export function contains(outer: Bounds, inner: Bounds): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

/** Grow bounds by `f` of their size on each side. */
export function pad([w, s, e, n]: Bounds, f: number): Bounds {
  const dx = (e - w) * f;
  const dy = (n - s) * f;
  return [w - dx, Math.max(-85, s - dy), e + dx, Math.min(85, n + dy)];
}
