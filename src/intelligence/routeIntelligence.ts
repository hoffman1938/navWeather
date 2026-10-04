import type { RouteCamera } from '../algorithms/cameras';
import type { RouteIncident } from '../algorithms/incidents';
import { nextSpeedLimitChange, type SpeedLimitProfile } from '../algorithms/speedLimits';
import { distanceAtTime, positionAtDistance, timeAtDistance } from '../algorithms/routeTiming';
import { bearingDeg, bearingDelta } from '../utils/distance';
import { solarPosition } from '../utils/sun';
import { formatUtcOffset, timeZoneOffsetMinutes } from '../utils/timezone';
import type { Messages } from '../i18n/en';
import { formatDistance, spokenDistance, spokenDuration, speedValue, type UnitPrefs } from '../i18n/format';
import type { Maneuver } from '../navigation/maneuvers';
import type { TimedRoute } from '../types/route';
import type { RouteWeatherPoint } from '../types/weather';
import type { RouteEvent } from './types';
import { buildWeatherEvents, type WeatherAlertPrefs } from './weatherAlerts';
import type { TripStop } from '../trip/types';

/**
 * ROUTE INTELLIGENCE ENGINE
 *
 * One place that answers "what's ahead?". It combines the route, the
 * vehicle position and time with every intelligence source and emits
 * normalized RouteEvents. Sources today: weather (Open-Meteo), stops and
 * destination (route), speed limits (OSM), fuel/charging advice (user-entered
 * range and vehicle type). Traffic and incidents plug in through
 * `extraEvents` when a provider exists (see services/traffic).
 */

export type RouteClock = (
  | { mode: 'planning'; departureMs: number }
  | { mode: 'navigating'; nowMs: number; modelTimeS: number }
) & {
  /** Planned stop time (s) between the reference position and a position ahead (Long Trip Mode). */
  dwellBeforeS?: (alongM: number) => number;
};

export interface IntelligenceInput {
  timed: TimedRoute;
  maneuvers: Maneuver[];
  progressM: number;
  clock: RouteClock;
  weatherPoints: RouteWeatherPoint[];
  currentPoint: RouteWeatherPoint | null;
  weatherPrefs: WeatherAlertPrefs;
  speedLimits: SpeedLimitProfile | null;
  fuelRangeKm: number | null;
  /**
   * Distance driven since the range was entered (km): this route so far plus earlier routes of the same drive.
   * Defaults to `progressM` (the drive started at this route's start).
   */
  rangeUsedKm?: number;
  vehicle?: 'fuel' | 'ev';
  /** Incidents on the route (provider-normalized; may be unverified reports). */
  incidents?: RouteIncident[];
  /** Mapped speed cameras on the route (only when the user turned them on). */
  speedCameras?: RouteCamera[];
  /** Suggest a break about every 2 h of driving on long trips (default on). */
  breakReminders?: boolean;
  /** Events from other providers (traffic, incidents…), already normalized. */
  extraEvents?: RouteEvent[];
  /** Long Trip Mode's planned stops: they replace the generic break and fuel reminders. */
  tripStops?: TripStop[];
  m: Messages;
  units: UnitPrefs;
}

export interface RouteIntelligence {
  /** Every future event, sorted by distance. */
  events: RouteEvent[];
  /** The next weather event worth mentioning (medium or above, else any). */
  nextWeather: RouteEvent | null;
  /** Curated, short list for the "Ahead" view. */
  ahead: RouteEvent[];
}

/** Break reminder cadence on long drives (common road-safety guidance). */
const BREAK_EVERY_S = 2 * 3600;

export function referenceTime(clock: RouteClock): number {
  return clock.mode === 'planning' ? clock.departureMs : clock.nowMs;
}

/** ETA (UTC ms) at an along-route distance under the given clock. */
export function arrivalAt(timed: TimedRoute, distanceM: number, clock: RouteClock): number {
  const t = timeAtDistance(timed, distanceM);
  const dwell = (clock.dwellBeforeS?.(distanceM) ?? 0) * 1000;
  return (clock.mode === 'planning' ? clock.departureMs + t * 1000 : clock.nowMs + (t - clock.modelTimeS) * 1000) + dwell;
}

function routeEvent(
  base: Pick<RouteEvent, 'id' | 'type' | 'category' | 'severity' | 'title' | 'shortMessage' | 'voiceMessage' | 'icon' | 'source' | 'confidence'>,
  timed: TimedRoute,
  distanceM: number,
  progressM: number,
  clock: RouteClock,
  extra: Partial<RouteEvent> = {},
): RouteEvent {
  const [lon, lat] = positionAtDistance(timed, distanceM).coordinate;
  const eta = arrivalAt(timed, distanceM, clock);
  return {
    ...base,
    latitude: lat,
    longitude: lon,
    distanceAlongM: distanceM,
    distanceFromCurrentM: Math.max(0, distanceM - progressM),
    estimatedMinutesFromCurrent: Math.max(0, Math.round((eta - referenceTime(clock)) / 60000)),
    estimatedArrivalTime: eta,
    expiresAt: eta + 30 * 60000,
    ...extra,
  };
}

export function buildRouteIntelligence(input: IntelligenceInput): RouteIntelligence {
  const { timed, progressM, clock, m, units } = input;
  const events: RouteEvent[] = [];

  // Weather — the first intelligence layer.
  events.push(
    ...buildWeatherEvents({
      points: input.weatherPoints,
      current: input.currentPoint,
      progressM,
      referenceMs: referenceTime(clock),
      prefs: input.weatherPrefs,
      m,
      units,
    }),
  );

  // Stops and destination, from the route model.
  for (const mv of input.maneuvers) {
    if (mv.kind !== 'arrive' || mv.distanceAlongM < progressM) continue;
    const stopName = mv.final ? timed.route.destination.name : timed.route.waypoints?.[mv.legIndex]?.name;
    events.push(
      routeEvent(
        {
          id: `${mv.final ? 'DESTINATION' : 'STOP'}@${mv.id}`,
          type: mv.final ? 'DESTINATION' : 'STOP',
          category: mv.final ? 'destination' : 'stop',
          severity: 'low',
          title: stopName ?? m.alert.title[mv.final ? 'DESTINATION' : 'STOP'],
          shortMessage: '',
          voiceMessage: '',
          icon: mv.final ? 'flag' : 'stop',
          source: 'route',
          confidence: 1,
        },
        timed,
        mv.distanceAlongM,
        progressM,
        clock,
        { placeName: stopName },
      ),
    );
  }

  // Speed limit change ahead (OSM, best effort; signs take precedence).
  const change = nextSpeedLimitChange(input.speedLimits, progressM, 3000);
  if (change) {
    const value = `${speedValue(change.kmh, units.distance)} ${units.distance === 'imperial' ? m.units.mph : m.units.kmh}`;
    events.push(
      routeEvent(
        {
          id: `SPEED@${Math.round(progressM + change.distanceM)}`,
          type: 'SPEED_LIMIT_CHANGE',
          category: 'speed',
          severity: 'low',
          title: `${m.alert.title.SPEED_LIMIT_CHANGE} ${value}`,
          shortMessage: '',
          voiceMessage: m.alert.voice.speedLimit(value),
          icon: 'speed',
          source: 'openstreetmap',
          confidence: 0.7,
        },
        timed,
        progressM + change.distanceM,
        progressM,
        clock,
      ),
    );
  }

  // Long Trip Mode: the planned stops (rest, meal, fuel/charge, overnight) replace the generic reminders below.
  if (input.tripStops?.length) {
    for (const st of input.tripStops) {
      if (st.alongM < progressM) continue;
      const night = st.kinds.includes('overnight');
      const fuel = st.kinds.includes('fuel') || st.kinds.includes('charge');
      const kind = night ? 'overnight' : st.kinds.includes('meal') ? 'meal' : st.kinds.includes('charge') ? 'charge' : st.kinds.includes('fuel') ? 'fuel' : 'rest';
      const label = m.trip.stopKind[kind];
      events.push(
        routeEvent(
          {
            id: `TRIP@${Math.round(st.alongM / 1000)}:${kind}`,
            type: 'TRIP_STOP',
            category: fuel && !night ? (st.kinds.includes('charge') ? 'charging' : 'fuel') : 'rest',
            severity: night || fuel ? 'medium' : 'low',
            title: label,
            shortMessage: st.placeName ? m.ui.near(st.placeName) : '',
            voiceMessage: '',
            icon: fuel && !night ? (st.kinds.includes('charge') ? 'charging' : 'fuel') : 'rest',
            source: 'trip-plan',
            confidence: 1,
          },
          timed,
          st.alongM,
          progressM,
          clock,
          { placeName: st.placeName },
        ),
      );
      const e = events[events.length - 1];
      e.voiceMessage = m.trip.voiceStop(label, spokenDuration(e.estimatedMinutesFromCurrent * 60, m), st.placeName);
    }
  }

  // Fuel / charging: only from the user's own range — never estimated. The range is used up as the car drives,
  // so the stop stays where 70 % of it is gone (fixed to the road, B-02), or is due now once that point is behind.
  if (!input.tripStops?.length && input.fuelRangeKm !== null && input.fuelRangeKm > 0) {
    const remainingM = timed.totalDistM - progressM;
    const rangeM = input.fuelRangeKm * 1000;
    const usedM = Math.max(0, input.rangeUsedKm !== undefined ? input.rangeUsedKm * 1000 : progressM);
    const leftM = Math.max(0, rangeM - usedM);
    if (remainingM > leftM * 0.9) {
      const aheadM = Math.min(remainingM, Math.max(0, rangeM * 0.7 - usedM));
      const at = progressM + aheadM;
      const ev = input.vehicle === 'ev';
      const spoken = spokenDistance(aheadM, units.distance, m);
      events.push(
        routeEvent(
          {
            id: `${ev ? 'CHARGE' : 'FUEL'}@${Math.round(at / 5000)}`,
            type: ev ? 'CHARGE_STOP' : 'FUEL_STOP',
            category: ev ? 'charging' : 'fuel',
            severity: 'medium',
            title: ev ? m.alert.title.CHARGE_STOP : m.alert.title.FUEL_STOP,
            shortMessage: formatDistance(aheadM, units.distance, m),
            voiceMessage: ev ? m.alert.voice.chargeStop(spoken) : m.alert.voice.fuelStop(m.poi.category.fuel, spoken),
            icon: ev ? 'charging' : 'fuel',
            source: 'user-range',
            confidence: 0.8,
          },
          timed,
          at,
          progressM,
          clock,
        ),
      );
    }
  }

  // Breaks on long drives: about every 2 h of driving, near a named place when one is close.
  if (!input.tripStops?.length && input.breakReminders !== false && timed.totalTimeS > 2.5 * 3600) {
    for (let k = 1; k * BREAK_EVERY_S < timed.totalTimeS - 1800; k++) {
      const d = distanceAtTime(timed, k * BREAK_EVERY_S);
      if (d < progressM) continue;
      const near = input.weatherPoints
        .filter((p) => p.placeName && Math.abs(p.distanceFromStartKm * 1000 - d) < 15_000)
        .sort((a, b) => Math.abs(a.distanceFromStartKm * 1000 - d) - Math.abs(b.distanceFromStartKm * 1000 - d))[0];
      events.push(
        routeEvent(
          {
            id: `BREAK@${k}`,
            type: 'REST_BREAK',
            category: 'rest',
            severity: 'low',
            title: m.alert.title.REST_BREAK,
            shortMessage: near?.placeName ? m.ui.near(near.placeName) : '',
            voiceMessage: m.alert.voice.restBreak(near?.placeName),
            icon: 'rest',
            source: 'drive-time',
            confidence: 1,
          },
          timed,
          d,
          progressM,
          clock,
        ),
      );
    }
  }

  for (const cam of input.speedCameras ?? []) {
    if (cam.distanceAlongM < progressM) continue;
    const limit = cam.kmh ? `${speedValue(cam.kmh, units.distance)} ${units.distance === 'imperial' ? m.units.mph : m.units.kmh}` : '';
    events.push(
      routeEvent(
        {
          id: `CAM@${cam.id}`,
          type: 'SPEED_CAMERA',
          category: 'speed',
          severity: 'low', // spoken by distance in the driving loop, not by the alert engine
          title: m.alert.title.SPEED_CAMERA,
          shortMessage: limit,
          voiceMessage: m.alert.voice.speedCamera(limit || undefined),
          icon: 'camera',
          source: 'openstreetmap',
          confidence: 0.8,
        },
        timed,
        cam.distanceAlongM,
        progressM,
        clock,
      ),
    );
  }
  events.push(...sunGlareEvents(input, timed, progressM, clock, m));
  events.push(...timeZoneEvents(input, timed, progressM, clock, m));

  // Incidents: only ahead, only while still valid at the time we get there.
  for (const inc of input.incidents ?? []) {
    if (inc.distanceAlongM < progressM) continue;
    const eta = arrivalAt(timed, inc.distanceAlongM, clock);
    if (inc.expiresAt !== undefined && inc.expiresAt < eta) continue;
    const what = m.alert.incident[inc.kind] ?? m.alert.title.INCIDENT;
    const minutes = Math.max(0, (eta - referenceTime(clock)) / 60_000);
    events.push(
      routeEvent(
        {
          id: `INC@${inc.id}`,
          type: 'INCIDENT',
          category: 'incident',
          severity: inc.severity,
          title: what,
          shortMessage: inc.verified ? inc.source : inc.confirmations ? m.alert.reportConfirmed(inc.confirmations) : m.alert.unconfirmed,
          voiceMessage: m.alert.voice.incident(what, spokenDuration(minutes * 60, m), !inc.verified),
          icon: 'incident',
          source: inc.source,
          // Unconfirmed reports rank lower (a little higher once other drivers confirm them)
          // and are gated by the alert engine's confidence threshold.
          confidence: inc.verified ? 0.9 : 0.55 + Math.min(0.2, 0.05 * (inc.confirmations ?? 0)),
        },
        timed,
        inc.distanceAlongM,
        progressM,
        clock,
        inc.expiresAt !== undefined ? { expiresAt: Math.min(inc.expiresAt, eta + 30 * 60_000) } : {},
      ),
    );
  }

  events.push(...(input.extraEvents ?? []).filter((e) => e.distanceAlongM >= progressM));
  events.sort((a, b) => a.distanceAlongM - b.distanceAlongM);

  const weather = events.filter((e) => e.category === 'weather');
  const nextWeather = weather.find((e) => e.severity !== 'low') ?? weather[0] ?? null;

  // "Ahead": everything that matters, compact. Low-severity weather is kept
  // (it answers "when does it clear?") but capped so the list stays short.
  const ahead: RouteEvent[] = [];
  let lowWeather = 0;
  for (const e of events) {
    if (e.type === 'DESTINATION') continue;
    if (e.category === 'weather' && e.severity === 'low' && ++lowWeather > 2) continue;
    ahead.push(e);
    if (ahead.length >= 6) break;
  }
  const dest = events.find((e) => e.type === 'DESTINATION');
  if (dest) ahead.push(dest);

  return { events, nextWeather, ahead };
}

/**
 * Low sun straight ahead: glare risk where, at the ETA, the sun is 0.5–15°
 * above the horizon, within 30° of the driving direction, and the sky there is
 * not overcast. Stretches shorter than ~4 km (a single bend) are ignored.
 */
function sunGlareEvents(input: IntelligenceInput, timed: TimedRoute, progressM: number, clock: RouteClock, m: Messages): RouteEvent[] {
  const STEP = 2000;
  const points = input.weatherPoints;
  const skyAt = (d: number) => {
    let best: RouteWeatherPoint | undefined;
    for (const p of points) if (!best || Math.abs(p.distanceFromStartKm * 1000 - d) < Math.abs(best.distanceFromStartKm * 1000 - d)) best = p;
    return best?.weather ?? null;
  };
  const runs: { startM: number; endM: number; eta: number }[] = [];
  let run: { startM: number; endM: number; eta: number } | null = null;
  for (let d = progressM; d < timed.totalDistM - 500; d += STEP) {
    const eta = arrivalAt(timed, d, clock);
    const here = positionAtDistance(timed, d).coordinate;
    const sun = solarPosition(here[1], here[0], eta);
    const ahead = positionAtDistance(timed, Math.min(timed.totalDistM, d + 300)).coordinate;
    const w = skyAt(d);
    const clearish = !!w && (w.condition === 'CLEAR' || w.condition === 'PARTLY_CLOUDY') && (w.cloudCover ?? 0) < 75;
    const glare = sun.elevationDeg > 0.5 && sun.elevationDeg < 15 && Math.abs(bearingDelta(bearingDeg(here, ahead), sun.azimuthDeg)) < 30 && clearish;
    if (glare) {
      if (run) run.endM = d;
      else run = { startM: d, endM: d, eta };
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs
    .filter((r) => r.endM - r.startM >= 2 * STEP)
    .slice(0, 3)
    .map((r) => {
      const near = points
        .filter((p) => p.placeName && Math.abs(p.distanceFromStartKm * 1000 - r.startM) < 15_000)
        .sort((a, b) => Math.abs(a.distanceFromStartKm * 1000 - r.startM) - Math.abs(b.distanceFromStartKm * 1000 - r.startM))[0]?.placeName;
      const minutes = Math.max(0, (r.eta - referenceTime(clock)) / 60_000);
      return routeEvent(
        {
          id: `GLARE@${Math.round(r.startM / 5000)}`,
          type: 'SUN_GLARE',
          category: 'weather',
          severity: 'medium',
          title: m.alert.title.SUN_GLARE,
          shortMessage: near ? m.ui.near(near) : '',
          voiceMessage: m.alert.voice.sunGlare(spokenDuration(minutes * 60, m), near),
          icon: 'glare',
          source: 'sun-position',
          confidence: 0.75,
        },
        timed,
        r.startM,
        progressM,
        clock,
        { endDistanceAlongM: r.endM, placeName: near },
      );
    });
}

/** Where the local time zone (UTC offset) changes along the route. */
function timeZoneEvents(input: IntelligenceInput, timed: TimedRoute, progressM: number, clock: RouteClock, m: Messages): RouteEvent[] {
  const out: RouteEvent[] = [];
  const pts = [...input.weatherPoints].sort((a, b) => a.distanceFromStartKm - b.distanceFromStartKm);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.timezone === b.timezone) continue;
    const before = timeZoneOffsetMinutes(b.arrivalMs, a.timezone);
    const after = timeZoneOffsetMinutes(b.arrivalMs, b.timezone);
    const delta = after - before;
    const d = b.distanceFromStartKm * 1000;
    if (delta === 0 || d < progressM) continue;
    const hours = `${Math.abs(delta) / 60}`.replace('.', m.locale === 'en' ? '.' : ',');
    out.push(
      routeEvent(
        {
          id: `TZ@${b.id}`,
          type: 'TIMEZONE_CHANGE',
          category: 'time',
          severity: 'low',
          title: m.alert.title.TIMEZONE_CHANGE,
          shortMessage: m.alert.clocks(delta > 0, hours, formatUtcOffset(b.arrivalMs, b.timezone)),
          voiceMessage: m.alert.clocks(delta > 0, hours, formatUtcOffset(b.arrivalMs, b.timezone)),
          icon: 'clock',
          source: 'time-zone',
          confidence: 1,
        },
        timed,
        d,
        progressM,
        clock,
      ),
    );
  }
  return out;
}
