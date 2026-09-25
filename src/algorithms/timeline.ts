import type { RouteWeatherPoint } from '../types/weather';
import { findSunTransition } from '../utils/sun';
import { formatLocalTime } from '../utils/timezone';

export type TimelineItem =
  | { type: 'point'; id: string; point: RouteWeatherPoint }
  | { type: 'sun'; id: string; kind: 'sunrise' | 'sunset'; atMs: number; localTime: string };

/**
 * Cards plus Apple-Weather-style sunrise/sunset markers inserted where the
 * journey crosses day/night (computed at the midpoint between two cards).
 */
export function buildTimelineItems(points: RouteWeatherPoint[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  points.forEach((p, i) => {
    items.push({ type: 'point', id: p.id, point: p });
    const next = points[i + 1];
    if (!next || next.arrivalMs <= p.arrivalMs) return;
    const lat = (p.latitude + next.latitude) / 2;
    const lon = (p.longitude + next.longitude) / 2;
    const t = findSunTransition(lat, lon, p.arrivalMs, next.arrivalMs);
    if (t) {
      items.push({
        type: 'sun',
        id: `sun-${t.type}-${t.atMs}`,
        kind: t.type,
        atMs: t.atMs,
        localTime: formatLocalTime(t.atMs, p.timezone),
      });
    }
  });
  return items;
}
