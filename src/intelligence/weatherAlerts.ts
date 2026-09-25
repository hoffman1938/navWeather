import type { Messages } from '../i18n/en';
import { formatSpeed, spokenDuration, tempDelta, type UnitPrefs } from '../i18n/format';
import type { RouteWeatherPoint, WeatherAtTime } from '../types/weather';
import type { EventIcon, RouteEvent, Severity, WeatherAlertType } from './types';

/**
 * WEATHER ALERT ENGINE
 *
 * Turns arrival-time weather along the route into a small set of meaningful
 * events ("Heavy rain in 25 min near Khashuri"), never a stream of repeats:
 *  - each hazard type is LATCHED with hysteresis (gusts on ≥60, off <50 km/h;
 *    colder on ≥6°, off <4°) and short dry gaps are bridged, so a stretch of
 *    rain is one event, not one per sample;
 *  - identity = type + the stable sample id where the stretch starts (never
 *    the moving "current" point), so refreshes/ETA drift keep the same ids;
 *  - hazards already in effect at the vehicle are not announced as "ahead";
 *    instead a low-priority "clearing" event is produced when they end;
 *  - severity is capped by confidence (probability × forecast lead time).
 */

export interface WeatherAlertPrefs {
  level: 'all' | 'severe';
  types: { rain: boolean; snow: boolean; fog: boolean; wind: boolean; temperature: boolean };
}

export const defaultWeatherAlertPrefs: WeatherAlertPrefs = {
  level: 'all',
  types: { rain: true, snow: true, fog: true, wind: true, temperature: true },
};

export interface WeatherEventInput {
  /** Route samples with arrival-time weather, in route order. */
  points: RouteWeatherPoint[];
  /** Weather at the vehicle right now (navigating), else null. */
  current: RouteWeatherPoint | null;
  /** Vehicle position along the route (0 while planning). */
  progressM: number;
  /** "Now" for relative timing: real/simulated now, or departure while planning. */
  referenceMs: number;
  prefs: WeatherAlertPrefs;
  m: Messages;
  units: UnitPrefs;
}

type W = RouteWeatherPoint & { weather: WeatherAtTime };

const isWet = (w: WeatherAtTime) =>
  w.condition === 'RAIN' ||
  w.condition === 'HEAVY_RAIN' ||
  w.condition === 'SNOW' ||
  w.condition === 'SLEET' ||
  w.condition === 'THUNDERSTORM';

const raw = {
  rain: (w: WeatherAtTime) => w.condition === 'RAIN' || w.condition === 'HEAVY_RAIN' || w.condition === 'THUNDERSTORM',
  heavy: (w: WeatherAtTime) => w.condition === 'HEAVY_RAIN' || (w.condition === 'RAIN' && (w.precipitation ?? 0) >= 4),
  snow: (w: WeatherAtTime) => w.condition === 'SNOW',
  freezing: (w: WeatherAtTime) => w.condition === 'SLEET' || (isWet(w) && w.temperature <= 1),
  storm: (w: WeatherAtTime) => w.condition === 'THUNDERSTORM',
  fog: (w: WeatherAtTime) => w.condition === 'FOG' || (w.visibility !== undefined && w.visibility < 1000),
  lowVis: (w: WeatherAtTime) => w.visibility !== undefined && w.visibility < 200,
};

/** Bridge dry gaps of ≤1 sample when the wet neighbours are < maxKm apart. */
function bridge(flags: boolean[], pts: W[], maxKm = 35): boolean[] {
  const out = [...flags];
  for (let i = 1; i < flags.length - 1; i++) {
    if (!flags[i] && flags[i - 1] && flags[i + 1]) {
      if (pts[i + 1].distanceFromStartKm - pts[i - 1].distanceFromStartKm < maxKm) out[i] = true;
    }
  }
  return out;
}

/**
 * Latch with hysteresis: on when `on(i)`, stays on until `off(i)`.
 * `initial` = already active at the vehicle, so an ongoing condition isn't
 * re-announced every time the next above-threshold sample comes up.
 */
function latch(n: number, on: (i: number) => boolean, off: (i: number) => boolean, initial = false): boolean[] {
  const out: boolean[] = [];
  let active = initial;
  for (let i = 0; i < n; i++) {
    if (!active && on(i)) active = true;
    else if (active && off(i)) active = false;
    out.push(active);
  }
  return out;
}

/** Indices where a latched flag turns on (stretch starts) with the stretch end. */
function stretches(flags: boolean[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let s = -1;
  flags.forEach((f, i) => {
    if (f && s < 0) s = i;
    if (!f && s >= 0) {
      out.push({ start: s, end: i - 1 });
      s = -1;
    }
  });
  if (s >= 0) out.push({ start: s, end: flags.length - 1 });
  return out;
}

function leadFactor(leadHours: number): number {
  if (leadHours <= 6) return 1;
  if (leadHours <= 24) return 0.85;
  if (leadHours <= 72) return 0.65;
  return 0.45;
}

function capByConfidence(sev: Severity, conf: number): Severity {
  if (conf < 0.35) return 'low';
  if (conf < 0.5) return sev === 'critical' ? 'high' : sev === 'high' ? 'medium' : sev;
  return sev;
}

const ICON: Record<WeatherAlertType, EventIcon> = {
  RAIN_AHEAD: 'rain',
  HEAVY_RAIN_AHEAD: 'heavy-rain',
  SNOW_AHEAD: 'snow',
  THUNDERSTORM_AHEAD: 'storm',
  FOG_AHEAD: 'fog',
  LOW_VISIBILITY_AHEAD: 'fog',
  STRONG_WIND_AHEAD: 'wind',
  TEMPERATURE_DROP_AHEAD: 'cold',
  FREEZING_AHEAD: 'ice',
  WEATHER_CLEARING: 'clear',
};

const TYPE_PREF: Record<WeatherAlertType, keyof WeatherAlertPrefs['types'] | null> = {
  RAIN_AHEAD: 'rain',
  HEAVY_RAIN_AHEAD: 'rain',
  THUNDERSTORM_AHEAD: null, // always relevant
  SNOW_AHEAD: 'snow',
  FREEZING_AHEAD: 'snow',
  FOG_AHEAD: 'fog',
  LOW_VISIBILITY_AHEAD: 'fog',
  STRONG_WIND_AHEAD: 'wind',
  TEMPERATURE_DROP_AHEAD: 'temperature',
  WEATHER_CLEARING: null,
};

export function buildWeatherEvents(input: WeatherEventInput): RouteEvent[] {
  const { m, units, prefs, progressM, referenceMs } = input;
  const pts = input.points.filter(
    (p): p is W => p.weather !== null && p.id !== 'current' && p.distanceFromStartKm * 1000 >= progressM - 50,
  );
  if (pts.length === 0) return [];
  const now = input.current?.weather ?? null;
  const n = pts.length;
  const w = (i: number) => pts[i].weather;
  const windNow = !!now && ((now.windGusts ?? 0) >= 50 || (now.windSpeed ?? 0) >= 32);

  const flags: Record<Exclude<WeatherAlertType, 'WEATHER_CLEARING'>, boolean[]> = {
    RAIN_AHEAD: bridge(pts.map((p) => raw.rain(p.weather)), pts),
    HEAVY_RAIN_AHEAD: bridge(pts.map((p) => raw.heavy(p.weather)), pts),
    SNOW_AHEAD: bridge(pts.map((p) => raw.snow(p.weather)), pts),
    FREEZING_AHEAD: bridge(pts.map((p) => raw.freezing(p.weather)), pts),
    THUNDERSTORM_AHEAD: bridge(pts.map((p) => raw.storm(p.weather)), pts),
    FOG_AHEAD: bridge(pts.map((p) => raw.fog(p.weather)), pts),
    LOW_VISIBILITY_AHEAD: pts.map((p) => raw.lowVis(p.weather)),
    STRONG_WIND_AHEAD: latch(
      n,
      (i) => (w(i).windGusts ?? 0) >= 60 || (w(i).windSpeed ?? 0) >= 40,
      (i) => (w(i).windGusts ?? 0) < 50 && (w(i).windSpeed ?? 0) < 32,
      windNow,
    ),
    TEMPERATURE_DROP_AHEAD: (() => {
      const base = now?.temperature ?? w(0).temperature;
      return latch(
        n,
        (i) => base - w(i).temperature >= 6,
        (i) => base - w(i).temperature < 4,
      );
    })(),
  };

  // Already happening at the vehicle → not "ahead".
  const inEffectNow: Partial<Record<WeatherAlertType, boolean>> = now
    ? {
        RAIN_AHEAD: raw.rain(now),
        HEAVY_RAIN_AHEAD: raw.heavy(now),
        SNOW_AHEAD: raw.snow(now),
        FREEZING_AHEAD: raw.freezing(now),
        THUNDERSTORM_AHEAD: raw.storm(now),
        FOG_AHEAD: raw.fog(now),
        LOW_VISIBILITY_AHEAD: raw.lowVis(now),
        STRONG_WIND_AHEAD: windNow,
      }
    : {};

  const events: RouteEvent[] = [];
  const make = (type: WeatherAlertType, i: number, endIdx: number, sev: Severity, conf: number, detail?: string, deg?: number) => {
    const p = pts[i];
    const minutes = Math.max(0, Math.round((p.arrivalMs - referenceMs) / 60000));
    const when = spokenDuration(minutes * 60, m);
    const place = p.placeName;
    const likely = (p.weather.precipitationProbability ?? 60) >= 60;
    const v = m.alert.voice;
    const voice =
      type === 'TEMPERATURE_DROP_AHEAD'
        ? v.TEMPERATURE_DROP_AHEAD(when, deg ?? 0)
        : type === 'WEATHER_CLEARING'
          ? v.WEATHER_CLEARING(when)
          : type === 'RAIN_AHEAD'
            ? v.RAIN_AHEAD(when, place, likely)
            : v[type](when, place);
    const severity = capByConfidence(sev, conf);
    events.push({
      id: `${type}@${p.id}`,
      type,
      category: 'weather',
      severity,
      latitude: p.latitude,
      longitude: p.longitude,
      distanceAlongM: p.distanceFromStartKm * 1000,
      endDistanceAlongM: pts[endIdx].distanceFromStartKm * 1000,
      distanceFromCurrentM: Math.max(0, p.distanceFromStartKm * 1000 - progressM),
      estimatedMinutesFromCurrent: minutes,
      estimatedArrivalTime: p.arrivalMs,
      title: m.alert.title[type],
      shortMessage: [detail, place ? m.alert.near(place) : undefined].filter(Boolean).join(' · '),
      voiceMessage: voice,
      icon: ICON[type],
      source: 'open-meteo',
      confidence: Math.round(conf * 100) / 100,
      expiresAt: pts[endIdx].arrivalMs + 30 * 60000,
      placeName: place,
      condition: p.weather.condition,
      isDay: p.weather.isDay,
    });
  };

  const precipConf = (i: number) => {
    const prob = Math.max(w(i).precipitationProbability ?? 60, i + 1 < n ? (w(i + 1).precipitationProbability ?? 0) : 0);
    return leadFactor(pts[i].forecastLeadHours) * Math.max(0.3, Math.min(1, prob / 100));
  };
  const otherConf = (i: number) => leadFactor(pts[i].forecastLeadHours) * 0.75;

  for (const type of Object.keys(flags) as (keyof typeof flags)[]) {
    for (const s of stretches(flags[type])) {
      // A stretch that begins at the first point while the hazard is already
      // present at the vehicle is ongoing, not ahead.
      if (s.start === 0 && inEffectNow[type]) continue;
      const i = s.start;
      const wi = w(i);
      switch (type) {
        case 'RAIN_AHEAD': {
          const prob = wi.precipitationProbability ?? 60;
          make(type, i, s.end, prob >= 40 || (wi.precipitation ?? 0) >= 0.5 ? 'medium' : 'low', precipConf(i), prob >= 60 ? m.alert.likely : m.alert.possible);
          break;
        }
        case 'HEAVY_RAIN_AHEAD':
        case 'SNOW_AHEAD':
        case 'FREEZING_AHEAD':
          make(type, i, s.end, 'high', precipConf(i));
          break;
        case 'THUNDERSTORM_AHEAD': {
          const severe = /hail/i.test(wi.description ?? '') || (wi.windGusts ?? 0) >= 90;
          make(type, i, s.end, severe ? 'critical' : 'high', precipConf(i));
          break;
        }
        case 'FOG_AHEAD':
          make(type, i, s.end, 'medium', otherConf(i));
          break;
        case 'LOW_VISIBILITY_AHEAD':
          make(type, i, s.end, 'high', otherConf(i));
          break;
        case 'STRONG_WIND_AHEAD': {
          const g = Math.max(wi.windGusts ?? 0, wi.windSpeed ?? 0);
          make(type, i, s.end, g >= 100 ? 'critical' : g >= 80 ? 'high' : 'medium', otherConf(i), m.alert.gusts(formatSpeed(g, units.wind, m)));
          break;
        }
        case 'TEMPERATURE_DROP_AHEAD': {
          const base = now?.temperature ?? w(0).temperature;
          const drop = base - wi.temperature;
          const deg = tempDelta(drop, units.temperature);
          make(type, i, s.end, drop >= 10 ? 'medium' : 'low', otherConf(i), m.alert.tempDrop(deg), deg);
          break;
        }
      }
    }
  }

  // Rain subsumed by a more severe precipitation event starting at the same place.
  const severePrecipAt = new Set(
    events
      .filter((e) => e.type === 'HEAVY_RAIN_AHEAD' || e.type === 'THUNDERSTORM_AHEAD' || e.type === 'SNOW_AHEAD' || e.type === 'FREEZING_AHEAD')
      .map((e) => e.id.split('@')[1]),
  );
  const lowVisAt = new Set(events.filter((e) => e.type === 'LOW_VISIBILITY_AHEAD').map((e) => e.id.split('@')[1]));
  let out = events.filter(
    (e) => !(e.type === 'RAIN_AHEAD' && severePrecipAt.has(e.id.split('@')[1])) && !(e.type === 'FOG_AHEAD' && lowVisAt.has(e.id.split('@')[1])),
  );

  // Clearing: wet at the vehicle now, dry ahead for at least two samples.
  if (now && isWet(now)) {
    const idx = pts.findIndex((p, i) => !isWet(p.weather) && (i + 1 >= n || !isWet(pts[i + 1].weather)));
    if (idx > 0) make('WEATHER_CLEARING', idx, idx, 'low', otherConf(idx));
    out = out.concat(events.filter((e) => e.type === 'WEATHER_CLEARING'));
  }

  return out
    .filter((e) => {
      const pref = TYPE_PREF[e.type as WeatherAlertType];
      if (pref && !prefs.types[pref]) return false;
      if (prefs.level === 'severe' && e.severity !== 'high' && e.severity !== 'critical') return false;
      return true;
    })
    .sort((a, b) => a.distanceAlongM - b.distanceAlongM);
}
