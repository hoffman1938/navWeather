export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

/** "4h 53m", "55 min", "<1 min" */
export function formatDuration(seconds: number): string {
  const totalMin = Math.round(Math.max(0, seconds) / 60);
  if (totalMin < 1) return '<1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/** "+55 min", "+1h 45m" — relative offset used during navigation. */
export function formatRelative(seconds: number): string {
  if (seconds < 60) return 'Now';
  return `+${formatDuration(seconds)}`;
}

/** "18 min ago", "just now", "2 h ago" */
export function formatAgo(sinceMs: number, nowMs: number): string {
  const min = Math.floor((nowMs - sinceMs) / MINUTE_MS);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ago`;
}

export function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function floorToHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export function roundToMinute(ms: number): number {
  return Math.round(ms / MINUTE_MS) * MINUTE_MS;
}
