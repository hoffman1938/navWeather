export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

export function floorToHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export function roundToMinute(ms: number): number {
  return Math.round(ms / MINUTE_MS) * MINUTE_MS;
}
