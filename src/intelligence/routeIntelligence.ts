import { nextSpeedLimitChange, type SpeedLimitProfile } from '../algorithms/speedLimits';
import { positionAtDistance, timeAtDistance } from '../algorithms/routeTiming';
import type { Messages } from '../i18n/en';
import { formatDistance, spokenDistance, speedValue, type UnitPrefs } from '../i18n/format';
import type { Maneuver } from '../navigation/maneuvers';
import type { TimedRoute } from '../types/route';
import type { RouteWeatherPoint } from '../types/weather';
import type { RouteEvent } from './types';
import { buildWeatherEvents, type WeatherAlertPrefs } from './weatherAlerts';

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

export type RouteClock =
  | { mode: 'planning'; departureMs: number }
  | { mode: 'navigating'; nowMs: number; modelTimeS: number };

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
  vehicle?: 'fuel' | 'ev';
  /** Events from other providers (traffic, incidents…), already normalized. */
  extraEvents?: RouteEvent[];
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

export function referenceTime(clock: RouteClock): number {
  return clock.mode === 'planning' ? clock.departureMs : clock.nowMs;
}

/** ETA (UTC ms) at an along-route distance under the given clock. */
export function arrivalAt(timed: TimedRoute, distanceM: number, clock: RouteClock): number {
  const t = timeAtDistance(timed, distanceM);
  return clock.mode === 'planning' ? clock.departureMs + t * 1000 : clock.nowMs + (t - clock.modelTimeS) * 1000;
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

  // Fuel / charging: only from the user's own range — never estimated.
  if (input.fuelRangeKm !== null && input.fuelRangeKm > 0) {
    const remainingM = timed.totalDistM - progressM;
    const rangeM = input.fuelRangeKm * 1000;
    if (remainingM > rangeM * 0.9) {
      const at = progressM + rangeM * 0.7;
      const ev = input.vehicle === 'ev';
      const spoken = spokenDistance(rangeM * 0.7, units.distance, m);
      events.push(
        routeEvent(
          {
            id: `${ev ? 'CHARGE' : 'FUEL'}@${Math.round(at / 5000)}`,
            type: ev ? 'CHARGE_STOP' : 'FUEL_STOP',
            category: ev ? 'charging' : 'fuel',
            severity: 'medium',
            title: ev ? m.alert.title.CHARGE_STOP : m.alert.title.FUEL_STOP,
            shortMessage: formatDistance(rangeM * 0.7, units.distance, m),
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
