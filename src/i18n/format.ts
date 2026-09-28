import type { Messages } from './en';
import { plural } from './plural';

export type DistanceUnits = 'metric' | 'imperial';
export type TemperatureUnit = 'c' | 'f';
export type WindUnit = 'kmh' | 'mph' | 'ms';

export interface UnitPrefs {
  distance: DistanceUnits;
  temperature: TemperatureUnit;
  wind: WindUnit;
}

/**
 * Locale-aware defaults: miles/°F/mph only when both the browser region and
 * the device timezone say US (an "en-US" browser in Tbilisi stays metric);
 * miles + °C for the UK; metric elsewhere.
 */
export function defaultUnits(
  browserLocale = typeof navigator !== 'undefined' ? navigator.language : 'en',
  timeZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    } catch {
      return '';
    }
  })(),
): UnitPrefs {
  const region = (browserLocale.split('-')[1] ?? '').toUpperCase();
  const us = region === 'US' && (timeZone.startsWith('America/') || timeZone.startsWith('Pacific/Honolulu'));
  const uk = region === 'GB' && timeZone === 'Europe/London';
  return { distance: us || uk ? 'imperial' : 'metric', temperature: us ? 'f' : 'c', wind: us || uk ? 'mph' : 'kmh' };
}

const nf = new Map<string, Intl.NumberFormat>();
function num(n: number, locale: string, maxFrac = 0): string {
  const key = `${locale}|${maxFrac}`;
  let f = nf.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: maxFrac });
    nf.set(key, f);
  }
  return f.format(n);
}

/** Display distance: "300 m", "1.2 km", "12 km" / "900 ft", "0.8 mi". */
export function formatDistance(meters: number, units: DistanceUnits, m: Messages): string {
  const d = Math.max(0, meters);
  if (units === 'imperial') {
    const miles = d / 1609.344;
    if (miles < 0.1) return `${num(Math.round((d * 3.28084) / 50) * 50, m.locale)} ${m.units.ft}`;
    return `${num(miles, m.locale, miles < 10 ? 1 : 0)} ${m.units.mi}`;
  }
  if (d < 950) return `${num(Math.round(d / 10) * 10, m.locale)} ${m.units.m}`;
  const km = d / 1000;
  return `${num(km, m.locale, km < 10 ? 1 : 0)} ${m.units.km}`;
}

/** Spoken distance for voice prompts, rounded the way people say it. */
export function spokenDistance(meters: number, units: DistanceUnits, m: Messages): string {
  const v = m.voice.distance;
  if (units === 'imperial') {
    const feet = meters * 3.28084;
    if (feet < 1000) return v.feet(Math.max(50, Math.round(feet / 100) * 100));
    const miles = meters / 1609.344;
    if (miles < 0.4) return v.quarterMile;
    if (miles < 0.75) return v.halfMile;
    return v.miles(miles < 3 ? Math.round(miles * 2) / 2 : Math.round(miles));
  }
  if (meters < 1000) {
    const step = meters < 300 ? 50 : 100;
    return v.meters(Math.max(50, Math.round(meters / step) * step));
  }
  const km = meters / 1000;
  return v.km(km < 3 ? Math.round(km * 2) / 2 : Math.round(km));
}

export function formatTemp(celsius: number | undefined, unit: TemperatureUnit): string {
  if (celsius === undefined || !Number.isFinite(celsius)) return '–';
  const v = unit === 'f' ? celsius * 1.8 + 32 : celsius;
  return `${Math.round(v)}°`;
}

export function tempDelta(celsiusDelta: number, unit: TemperatureUnit): number {
  return Math.round(unit === 'f' ? celsiusDelta * 1.8 : celsiusDelta);
}

export function formatSpeed(kmh: number | undefined, unit: WindUnit | DistanceUnits, m: Messages): string {
  if (kmh === undefined || !Number.isFinite(kmh)) return '–';
  if (unit === 'mph' || unit === 'imperial') return `${Math.round(kmh / 1.609344)} ${m.units.mph}`;
  if (unit === 'ms') return `${Math.round(kmh / 3.6)} ${m.units.ms}`;
  return `${Math.round(kmh)} ${m.units.kmh}`;
}

/** Speed limit number in the user's units (sign shows the number only). */
export function speedValue(kmh: number, units: DistanceUnits): number {
  return units === 'imperial' ? Math.round(kmh / 1.609344 / 5) * 5 : Math.round(kmh);
}

/** "4 h 53 min", "55 min", "<1 min". */
export function formatDuration(seconds: number, m: Messages): string {
  const total = Math.round(Math.max(0, seconds) / 60);
  if (total < 1) return m.time.lessThanMinute;
  if (total < 60) return `${num(total, m.locale)} ${m.units.min}`;
  const h = Math.floor(total / 60);
  const mm = total % 60;
  return mm === 0 ? `${num(h, m.locale)} ${m.units.h}` : `${num(h, m.locale)} ${m.units.h} ${num(mm, m.locale)} ${m.units.min}`;
}

/** Tight spaces (timeline columns): "1 h 40", "55 min". */
export function formatDurationCompact(seconds: number, m: Messages): string {
  const total = Math.round(Math.max(0, seconds) / 60);
  if (total < 60) return formatDuration(seconds, m);
  const h = Math.floor(total / 60);
  const mm = total % 60;
  return mm === 0 ? `${num(h, m.locale)} ${m.units.h}` : `${num(h, m.locale)} ${m.units.h} ${String(mm).padStart(2, '0')}`;
}

/** Spoken duration: "about 25 minutes", "about an hour", "1 hour 20 minutes". */
export function spokenDuration(seconds: number, m: Messages, withAbout = true): string {
  const total = Math.round(Math.max(0, seconds) / 60);
  if (total < 3) return m.time.aFewMinutes;
  if (total < 60) {
    // Round like people do: 5-minute steps beyond a quarter hour.
    const r = total > 15 ? Math.round(total / 5) * 5 : total;
    const s = `${r} ${plural(r, m.plural.minute, m.locale)}`;
    return withAbout ? m.time.about(s) : s;
  }
  const h = Math.floor(total / 60);
  const mm = Math.round((total % 60) / 5) * 5;
  if (h === 1 && mm === 0) return withAbout ? m.time.aboutAnHour : `1 ${plural(1, m.plural.hour, m.locale)}`;
  const hs = `${h} ${plural(h, m.plural.hour, m.locale)}`;
  const s = mm ? `${hs}${m.time.and}${mm} ${plural(mm, m.plural.minute, m.locale)}` : hs;
  return withAbout ? m.time.about(s) : s;
}

/** "18 min ago", "just now" — localized. */
export function formatAgo(sinceMs: number, nowMs: number, m: Messages): string {
  const s = Math.max(0, (nowMs - sinceMs) / 1000);
  if (s < 60) return m.time.justNow;
  return m.time.ago(formatDuration(s, m));
}

export function countOf(n: number, forms: keyof Messages['plural'], m: Messages): string {
  return `${num(n, m.locale)} ${plural(n, m.plural[forms], m.locale)}`;
}

/**
 * Condition text in the UI language. The provider's finer wording
 * ("Light drizzle", "Overcast") is English-only, so it is used for English.
 */
export function conditionText(w: { condition: keyof Messages['weather']['condition']; description?: string }, m: Messages): string {
  return m.locale === 'en' && w.description ? w.description : m.weather.condition[w.condition];
}
