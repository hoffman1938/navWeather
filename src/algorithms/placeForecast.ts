import type { LocationForecast, WeatherAtTime, WeatherCondition } from '../types/weather';
import { HOUR_MS } from '../utils/time';
import { localDateKey, zonedParts } from '../utils/timezone';
import { matchForecastToTime } from './weatherMatching';

/**
 * Forecast views for a single place (a searched place, a dropped pin, a
 * friend's live position). They reuse the route matcher, so an hour slot
 * means exactly what an arrival at that time means everywhere else.
 */

export interface HourSlot {
  /** Start of the hour (UTC ms). */
  timeMs: number;
  weather: WeatherAtTime;
}

export interface DaySummary {
  dateKey: string;
  /** Midday of that local day (UTC ms), for weekday labels. */
  noonMs: number;
  min: number;
  max: number;
  condition: WeatherCondition;
  /** Highest hourly chance of precipitation that day, %. */
  precipitationProbability?: number;
  /** Total precipitation, mm. */
  precipitation: number;
}

/**
 * Hourly slots from the next full LOCAL hour (half-hour time zones exist);
 * each slot is matched at its midpoint.
 */
export function nextHours(f: LocationForecast, nowMs: number, count = 24): HourSlot[] {
  const out: HourSlot[] = [];
  const p = zonedParts(nowMs, f.timezone);
  const sinceLocalHour = (p.minute * 60 + (p.second ?? 0)) * 1000 + (nowMs % 1000);
  const first = nowMs - sinceLocalHour + HOUR_MS;
  for (let i = 0; i < count; i++) {
    const t = first + i * HOUR_MS;
    const w = matchForecastToTime(f, t + HOUR_MS / 2);
    if (!w) break;
    out.push({ timeMs: t, weather: w });
  }
  return out;
}

const RANK: Record<WeatherCondition, number> = {
  THUNDERSTORM: 8,
  SNOW: 7,
  SLEET: 6,
  HEAVY_RAIN: 5,
  RAIN: 4,
  FOG: 3,
  CLOUDY: 2,
  PARTLY_CLOUDY: 1,
  CLEAR: 0,
};

/**
 * One row per local day. The day's icon is the most significant condition
 * that lasts at least two daytime hours (so a single stray shower doesn't
 * paint the whole day wet); otherwise the most common daytime condition.
 */
export function dailySummary(f: LocationForecast, nowMs: number, days = 7): DaySummary[] {
  const tz = f.timezone;
  const byDay = new Map<string, { hours: { hour: number; w: WeatherAtTime }[]; noonMs: number }>();
  // Start at the first forecast hour of today (the provider includes a few past
  // hours), so "Today" isn't built from only the remaining hours.
  const todayKey = localDateKey(nowMs, tz);
  const firstToday = f.times.find((t) => localDateKey(t, tz) === todayKey);
  const start = Math.min(Math.floor(nowMs / HOUR_MS) * HOUR_MS, firstToday ?? Infinity);
  const end = f.times[f.times.length - 1] ?? start;
  for (let t = start; t <= end; t += HOUR_MS) {
    const w = matchForecastToTime(f, t + HOUR_MS / 2);
    if (!w) continue;
    const key = localDateKey(t, tz);
    const hour = zonedParts(t, tz).hour;
    let d = byDay.get(key);
    if (!d) {
      if (byDay.size >= days) break;
      d = { hours: [], noonMs: t };
      byDay.set(key, d);
    }
    if (hour === 12) d.noonMs = t;
    d.hours.push({ hour, w });
  }

  const out: DaySummary[] = [];
  for (const [dateKey, d] of byDay) {
    const temps = d.hours.map((h) => h.w.temperature);
    const daytime = d.hours.filter((h) => h.hour >= 8 && h.hour <= 20);
    const pool = daytime.length ? daytime : d.hours;
    const counts = new Map<WeatherCondition, number>();
    for (const h of pool) counts.set(h.w.condition, (counts.get(h.w.condition) ?? 0) + 1);
    let condition: WeatherCondition = pool[0].w.condition;
    const significant = [...counts].filter(([c, n]) => n >= 2 && RANK[c] >= RANK.FOG).sort((a, b) => RANK[b[0]] - RANK[a[0]]);
    if (significant.length) condition = significant[0][0];
    else condition = [...counts].sort((a, b) => b[1] - a[1] || RANK[b[0]] - RANK[a[0]])[0][0];
    const probs = d.hours.map((h) => h.w.precipitationProbability).filter((p): p is number => p !== undefined);
    out.push({
      dateKey,
      noonMs: d.noonMs,
      min: Math.min(...temps),
      max: Math.max(...temps),
      condition,
      precipitationProbability: probs.length ? Math.max(...probs) : undefined,
      precipitation: Math.round(d.hours.reduce((s, h) => s + (h.w.precipitation ?? 0), 0) * 10) / 10,
    });
  }
  return out;
}
