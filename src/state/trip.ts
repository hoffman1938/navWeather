import { create } from 'zustand';
import { getProviders } from '../services/providers';
import { forecastLookupFn } from '../services/routePlanner';
import { isAbortError } from '../services/http';
import { buildTripRequest, fetchStopPlaces, fetchTripPlan, findBorders, profileFromTimed } from '../services/trip/requests';
import type { BorderCrossing } from '../trip/borders';
import { atLeast, classifyTrip, countTimeZoneChanges } from '../trip/classification/classify';
import { REPLAN, TRIP_THRESHOLDS } from '../trip/config';
import { delaySeconds, progressStateFor } from '../trip/replanning/progress';
import type { StopPlaces, TripClassification, TripPlan, TripPreferences, TripProgressState, VehicleProfile } from '../trip/types';
import { timeAtDistance } from '../algorithms/routeTiming';
import { deviceTimeZone } from '../utils/timezone';
import { formatDuration } from '../i18n/format';
import { currentMessages, fullRangeKm, useSettings, type Settings } from './settings';
import { setTripEndProvider, setTripStopsProvider, useAppStore } from './store';

/**
 * LONG TRIP MODE — client state (docs/features/LONG_TRIP_MODE.md).
 *
 * Classifies every drive instantly (same pure engine as the Worker), asks the
 * Worker for a plan when the trip is long enough (or the user asked), hands
 * the plan's stop durations to the app store so every ETA and forecast uses
 * the real (stop-aware) times, loads places per stop on demand, and replans
 * when a real drive falls behind. Kept out of `store.ts` on purpose.
 */

export type LongTripOverride = 'auto' | 'on' | 'off';

interface StopPlacesState {
  status: 'loading' | 'ready' | 'error';
  places?: StopPlaces[];
}

export interface TripState {
  routeId: string | null;
  classification: TripClassification | null;
  override: LongTripOverride;
  status: 'idle' | 'loading' | 'ready' | 'error';
  plan: TripPlan | null;
  /** The last plan request failed; `plan` (if any) is older. */
  error: 'offline' | 'unavailable' | null;
  /** Nights the user chose ("Stay in X instead"). */
  overnightsM: number[];
  stopPlaces: Record<string, StopPlacesState>;
  lastReplanAt: number;
  /** Border crossings along the route (OSM countries), loaded after the plan. */
  borders: { status: 'idle' | 'loading' | 'ready' | 'error'; crossings: BorderCrossing[] };

  setOverride(mode: LongTripOverride): void;
  /** Re-classify and (when the trip calls for it) ask for a plan. */
  refresh(reason: 'route' | 'weather' | 'places' | 'departure' | 'settings' | 'retry'): void;
  chooseOvernight(stopId: string, alongM: number): void;
  loadStopPlaces(stopId: string): void;
  reset(): void;
}

const initial = {
  routeId: null,
  classification: null,
  override: 'auto' as LongTripOverride,
  status: 'idle' as const,
  plan: null,
  error: null,
  overnightsM: [],
  stopPlaces: {},
  lastReplanAt: 0,
  borders: { status: 'idle' as const, crossings: [] as BorderCrossing[] },
};

let planAbort: AbortController | null = null;
/** Where the drive stands against the plan (kept fresh while driving), carried over a re-route. */
let carry: TripProgressState | null = null;
const placesAbort = new Map<string, AbortController>();

/** Long Trip Mode is on for the trip on screen (auto by classification, or the user's choice). */
export function longTripActive(t: Pick<TripState, 'override' | 'classification'> = useTripStore.getState()): boolean {
  if (t.override === 'on') return true;
  if (t.override === 'off') return false;
  return !!t.classification?.longTripMode;
}

export function vehicleFromSettings(s: Settings): VehicleProfile {
  const full = fullRangeKm(s);
  return {
    kind: s.vehicleKind,
    powertrain: s.vehicle,
    ...(s.fuelRangeKm !== null ? { rangeKm: Math.round(s.fuelRangeKm) } : {}),
    ...(full !== null ? { fullRangeKm: full } : {}),
  };
}

export function preferencesFromSettings(s: Settings): TripPreferences {
  return { pace: s.tripPace, hotelMinStars: s.hotelMinStars, hotelMaxDetourKm: s.hotelMaxDetourKm, food: s.tripFood, fuelBrand: s.fuelBrand };
}

function departureMs(): number {
  const d = useAppStore.getState().departure;
  return d.mode === 'now' ? Date.now() : d.utcMs;
}

/** Context for planning the app's current route (null when there is nothing to plan by car). */
function routeContext() {
  const app = useAppStore.getState();
  if (!app.plan || app.travelMode !== 'drive' || app.plan.timed.route.transit) return null;
  const lookup = forecastLookupFn(getProviders(), app.forecasts);
  const zones = app.plan.samples.map((s) => lookup(s)?.timezone ?? '');
  return { app, plan: app.plan, lookup, zones };
}

export const useTripStore = create<TripState>()((set, get) => ({
  ...initial,

  setOverride(override) {
    set({ override });
    if (override === 'on' && !get().plan) get().refresh('retry');
    useAppStore.getState().rederive();
  },

  refresh(reason) {
    const ctx = routeContext();
    if (!ctx) {
      if (get().routeId !== null) get().reset();
      return;
    }
    const { app, plan, lookup, zones } = ctx;
    const routeId = plan.timed.route.id;
    let progress: TripProgressState | undefined;
    if (routeId !== get().routeId) {
      planAbort?.abort();
      const driving = app.mode !== 'planning';
      // A re-route while driving keeps the driver's choice and today's driving; a new trip starts over.
      if (driving && carry && get().plan) progress = { ...carry, alongM: 0, nowMs: Date.now() };
      set({ ...initial, override: driving ? get().override : 'auto', routeId });
    }
    const settings = useSettings.getState();
    const profile = profileFromTimed(plan.timed);
    const fallback = deviceTimeZone();
    const tzAt = (alongM: number) => {
      let best = -1;
      for (let i = 0; i < plan.samples.length; i++) {
        if (!zones[i]) continue;
        if (best < 0 || Math.abs(plan.samples[i].distanceM - alongM) < Math.abs(plan.samples[best].distanceM - alongM)) best = i;
      }
      return best >= 0 ? zones[best] : fallback;
    };
    const classification = classifyTrip({
      profile,
      departAtMs: departureMs(),
      tzAt,
      preferences: preferencesFromSettings(settings),
      vehicle: vehicleFromSettings(settings),
      timeZoneChanges: countTimeZoneChanges(zones.filter(Boolean)),
    });
    set({ classification });

    // Plan whenever Long Trip Mode is on — also when it switched itself on for a shorter trip
    // (an evening departure with three breaks) — or the trip is long enough to plan stops for.
    const override = get().override;
    const wanted = longTripActive({ override, classification }) || (override === 'auto' && atLeast(classification.category, TRIP_THRESHOLDS.PLAN_FROM_CATEGORY));
    if (!wanted) {
      if (get().plan) set({ plan: null, status: 'idle' });
      useAppStore.getState().rederive();
      return;
    }
    // A new route: wait for its forecasts (the planner needs them for weather risks) — the weather
    // subscription asks once they are loaded or have failed. A re-route while driving can't wait, and
    // another road picked from the options already has its forecasts (they were loaded for every road).
    const hasForecasts = plan.samples.length > 0 && plan.samples.every((s) => lookup(s));
    if (reason === 'route' && !progress && !hasForecasts) return;
    void requestPlan(lookup, progress);
  },

  chooseOvernight(stopId, alongM) {
    const plan = get().plan;
    if (!plan) return;
    const nights = plan.recommendedStops.filter((s) => s.kinds.includes('overnight'));
    const idx = nights.findIndex((s) => s.id === stopId);
    // Keep the user's earlier nights; replace this one; later nights are planned again from it.
    const keep = nights.slice(0, Math.max(0, idx)).map((s) => s.alongM);
    set({ overnightsM: [...keep, alongM] });
    get().refresh('retry');
  },

  loadStopPlaces(stopId) {
    const t = get();
    const stop = t.plan?.recommendedStops.find((s) => s.id === stopId);
    const app = useAppStore.getState();
    if (!stop || !app.plan || t.stopPlaces[stopId]?.status === 'loading' || t.stopPlaces[stopId]?.status === 'ready') return;
    const ctrl = new AbortController();
    placesAbort.set(stopId, ctrl);
    set({ stopPlaces: { ...t.stopPlaces, [stopId]: { status: 'loading' } } });
    const settings = useSettings.getState();
    const planAt = t.plan!.createdAtMs;
    fetchStopPlaces(stop, app.plan.timed, vehicleFromSettings(settings), preferencesFromSettings(settings), currentMessages().locale, ctrl.signal)
      .then((places) => {
        if (get().plan?.createdAtMs !== planAt) return;
        set({ stopPlaces: { ...get().stopPlaces, [stopId]: { status: 'ready', places } } });
      })
      .catch((e) => {
        if (isAbortError(e) || get().plan?.createdAtMs !== planAt) return;
        set({ stopPlaces: { ...get().stopPlaces, [stopId]: { status: 'error' } } });
      })
      .finally(() => placesAbort.delete(stopId));
  },

  reset() {
    carry = null;
    planAbort?.abort();
    for (const c of placesAbort.values()) c.abort();
    placesAbort.clear();
    set({ ...initial });
    useAppStore.getState().rederive();
  },
}));

async function requestPlan(lookup: ReturnType<typeof forecastLookupFn>, progress?: Parameters<typeof buildTripRequest>[0]['progress']) {
  const ctx = routeContext();
  if (!ctx) return;
  const t = useTripStore.getState();
  planAbort?.abort();
  const ctrl = new AbortController();
  planAbort = ctrl;
  const settings = useSettings.getState();
  const before = t.plan;
  useTripStore.setState({ status: 'loading' });
  try {
    const req = buildTripRequest({
      timed: ctx.plan.timed,
      samples: ctx.plan.samples,
      places: ctx.plan.places,
      forecastFor: lookup,
      departAtMs: departureMs(),
      vehicle: vehicleFromSettings(settings),
      preferences: preferencesFromSettings(settings),
      locale: currentMessages().locale,
      fallbackTz: deviceTimeZone(),
      progress,
      overnightsM: t.overnightsM,
    });
    const plan = await fetchTripPlan(req, ctrl.signal);
    if (ctrl.signal.aborted || useTripStore.getState().routeId !== ctx.plan.timed.route.id) return;
    useTripStore.setState({ plan, status: 'ready', error: null, stopPlaces: {}, classification: plan.classification });
    useAppStore.getState().rederive();
    reloadWeatherIfShort(ctx.plan.timed.route.id);
    // The arrival moved enough to tell the driver (replanning while driving).
    if (progress && before && Math.abs(plan.arriveAtMs - before.arriveAtMs) >= REPLAN.notifyChangeS * 1000) {
      const m = currentMessages();
      useAppStore.getState().showNotice('info', m.trip.etaChanged(formatDuration(Math.abs(plan.arriveAtMs - before.arriveAtMs) / 1000, m), plan.arriveAtMs > before.arriveAtMs));
    }
    // Prefetch the first night's hotels: the most important stop on a long trip.
    const night = plan.recommendedStops.find((s) => s.kinds.includes('overnight'));
    if (night && longTripActive()) useTripStore.getState().loadStopPlaces(night.id);
    if (longTripActive() && useTripStore.getState().borders.status === 'idle') loadBorders(ctx.plan.timed.route.id);
  } catch (e) {
    if (isAbortError(e)) return;
    useTripStore.setState({ status: 'error', error: useAppStore.getState().online ? 'unavailable' : 'offline' });
  } finally {
    if (planAbort === ctrl) planAbort = null;
  }
}

/** The end of the trip on screen, planned stops included (UTC ms), while Long Trip Mode is on. */
function tripEndMs(): number | undefined {
  const t = useTripStore.getState();
  const app = useAppStore.getState();
  if (!app.plan || t.routeId !== app.plan.timed.route.id || !longTripActive(t)) return undefined;
  const fromClassification = t.classification ? departureMs() + t.classification.estimatedTotalTimeMinutes * 60_000 : 0;
  const fromPlan = t.plan?.routeId === t.routeId ? t.plan.arriveAtMs : 0;
  return Math.max(fromClassification, fromPlan) || undefined;
}

/** Forecasts are offered up to 16 days ahead; a point later than that has none to load. */
const FORECAST_REACH_MS = 15.5 * 86_400_000;
let horizonReloadKey = '';

/**
 * The plan's stops moved some points beyond the forecasts loaded so far: load them once more for the longer
 * horizon (B-06). Once per route and arrival hour, so a provider with a shorter horizon can't cause a loop.
 */
function reloadWeatherIfShort(routeId: string) {
  const app = useAppStore.getState();
  const plan = useTripStore.getState().plan;
  if (!plan || app.mode !== 'planning' || app.weatherStatus === 'loading' || app.plan?.timed.route.id !== routeId) return;
  const reach = Date.now() + FORECAST_REACH_MS;
  const short = app.derived.points.some((p) => p.weather === null && p.arrivalMs < reach);
  const key = `${routeId}:${Math.round(plan.arriveAtMs / 3_600_000)}`;
  if (!short || key === horizonReloadKey) return;
  horizonReloadKey = key;
  void app.loadWeather({ reason: 'auto' });
}

let lastCheckAt = 0;

/** Countries along the route (once per route; the route's shape, not the user's position, is sent). */
function loadBorders(routeId: string) {
  const app = useAppStore.getState();
  if (!app.plan || app.plan.timed.route.id !== routeId) return;
  useTripStore.setState({ borders: { status: 'loading', crossings: [] } });
  findBorders(app.plan.timed, currentMessages().locale)
    .then((r) => {
      const t = useTripStore.getState();
      if (t.routeId !== routeId) return;
      useTripStore.setState({
        borders: { status: 'ready', crossings: r.crossings },
        ...(t.classification && r.countries.some(Boolean) ? { classification: { ...t.classification, requiresBorderCrossing: r.crossings.length > 0 } } : {}),
      });
    })
    .catch(() => {
      if (useTripStore.getState().routeId !== routeId) return;
      useTripStore.setState({ borders: { status: 'error', crossings: [] } });
    });
}

/** While really driving: replan when the car is well behind or ahead of the plan. */
function checkProgress() {
  const t = useTripStore.getState();
  const app = useAppStore.getState();
  if (!t.plan || !longTripActive(t) || app.mode !== 'navigating' || !app.progress || !app.plan || !app.online) return;
  if (t.plan.routeId !== app.plan.timed.route.id) return;
  const now = Date.now();
  if (now - lastCheckAt < 15_000) return;
  lastCheckAt = now;
  if (now - t.lastReplanAt < REPLAN.cooldownMs || t.status === 'loading') return;
  const along = app.progress.distanceAlongM;
  const timed = app.plan.timed;
  const settings = useSettings.getState();
  const full = fullRangeKm(settings);
  carry = progressStateFor(t.plan, along, now, (m) => timeAtDistance(timed, m), {
    ...(settings.fuelRangeKm !== null ? { declaredKm: settings.fuelRangeKm } : {}),
    ...(full !== null ? { fullKm: full } : {}),
  });
  if (Math.abs(delaySeconds(t.plan, along, now)) < REPLAN.delayThresholdS) return;
  useTripStore.setState({ lastReplanAt: now });
  void requestPlan(forecastLookupFn(getProviders(), app.forecasts), carry);
}

let started = false;

/**
 * Wire Long Trip Mode to the app (called once from the app shell; tests call
 * it explicitly). Keeps store.ts free of trip logic: the app store only asks
 * for the stops to add to ETAs.
 */
export function initTrip(): () => void {
  if (started) return () => undefined;
  started = true;
  setTripStopsProvider(() => {
    const t = useTripStore.getState();
    const app = useAppStore.getState();
    if (!t.plan || !longTripActive(t) || !app.plan || t.plan.routeId !== app.plan.timed.route.id) return undefined;
    return t.plan.recommendedStops;
  });
  setTripEndProvider(tripEndMs);
  const unsubs = [
    useAppStore.subscribe(
      (s) => s.plan?.timed.route.id ?? null,
      (id) => (id ? useTripStore.getState().refresh('route') : useTripStore.getState().reset()),
    ),
    useAppStore.subscribe(
      (s) => s.weatherStatus,
      (status, prev) => {
        // New or longer forecasts: plan again, so the risks and advice use them (B-07). One plan request per load.
        if ((status === 'ready' || status === 'error') && prev === 'loading' && useAppStore.getState().mode === 'planning') {
          useTripStore.getState().refresh('weather');
        }
      },
    ),
    // Settlements found after the first plan: overnight areas can name towns now (B-05).
    useAppStore.subscribe(
      (s) => s.plan?.places,
      (places, prev) => {
        const app = useAppStore.getState();
        if (places && prev && places !== prev && places.length > prev.length && app.mode === 'planning' && app.weatherStatus !== 'loading') {
          useTripStore.getState().refresh('places');
        }
      },
    ),
    useAppStore.subscribe(
      (s) => s.departure,
      () => {
        if (useAppStore.getState().mode === 'planning') useTripStore.getState().refresh('departure');
      },
    ),
    useAppStore.subscribe((s) => s.progress, checkProgress),
    useSettings.subscribe((st, prev) => {
      const keys: (keyof Settings)[] = ['vehicle', 'vehicleKind', 'fuelRangeKm', 'tankSize', 'consumptionPer100Km', 'tripPace', 'hotelMinStars', 'hotelMaxDetourKm', 'tripFood', 'fuelBrand'];
      if (keys.some((k) => st[k] !== prev[k]) && useAppStore.getState().mode === 'planning') useTripStore.getState().refresh('settings');
    }),
  ];
  return () => {
    unsubs.forEach((u) => u());
    setTripStopsProvider(() => undefined);
    setTripEndProvider(() => undefined);
    horizonReloadKey = '';
    started = false;
  };
}
