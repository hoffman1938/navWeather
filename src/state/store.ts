import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { snapIncidentsToRoute, type RouteIncident } from '../algorithms/incidents';
import { initialDeviationState, updateDeviation } from '../algorithms/routeDeviation';
import { createProgressTracker, edgeSpeedMps, hasArrived } from '../algorithms/routeProgress';
import { diffForecast } from '../algorithms/routeWeather';
import { advanceSimulation, simProgress } from '../algorithms/simulation';
import { matchSpeedLimits, speedLimitAt, updateSpeeding, type SpeedLimitProfile } from '../algorithms/speedLimits';
import { config } from '../config';
import { countOf, spokenDuration } from '../i18n/format';
import {
  acknowledge,
  evaluateDriverAlerts,
  initialDriverAlertState,
  type DriverAlertState,
  type VisualAlert,
} from '../intelligence/driverAlerts';
import { dueManeuverPrompt, markSpoken, spokenPrompt } from '../navigation/instructions';
import { computeGuidance, type Guidance } from '../navigation/maneuvers';
import { isAbortError, mapWithConcurrency } from '../services/http';
import { locateOnce, LocationError } from '../services/location';
import type { PoiCategory } from '../services/places/PoiProvider';
import { searchAlongRoute, type PoiResult } from '../services/placesAlongRoute';
import { getProviders } from '../services/providers';
import {
  applyLatePlaces,
  describeError,
  enrichRoute,
  fetchSampleForecasts,
  forecastLookupFn,
  planRoute,
  planRouteOptions,
  refinePlanWithWeather,
  resolvePlace,
  type PlannedRoute,
  type PlanStage,
} from '../services/routePlanner';
import type { LngLat, Place } from '../types/geo';
import type { DeviationState, NavigationMode, RouteProgress, VehicleState } from '../types/navigation';
import type { RouteSample } from '../types/route';
import type { LocationForecast, WeatherAtTime, WeatherCondition } from '../types/weather';
import { haversineM } from '../utils/distance';
import { deviceTimeZone } from '../utils/timezone';
import { VoiceQueue } from '../voice/queue';
import { deriveRouteWeather, emptyDerived, type Derived } from './derive';
import { useSavedPlaces } from './savedPlaces';
import { currentMessages, settingsSnapshot, useSettings } from './settings';

export type RouteStatus = 'idle' | PlanStage | 'ready' | 'error';
export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SheetState = 'compact' | 'default' | 'expanded';
export type Departure = { mode: 'now' } | { mode: 'at'; utcMs: number };
export type RefreshReason = 'initial' | 'auto' | 'model-update' | 'manual' | 'recalculation' | 'refinement';

export interface PlaceField {
  text: string;
  place: Place | null;
}

export interface Notice {
  id: number;
  kind: 'info' | 'warning' | 'error' | 'success';
  text: string;
  persistent?: boolean;
}

export interface SimulationState {
  playing: boolean;
  speed: number;
  nowMs: number;
  modelTimeS: number;
  startMs: number;
  arrived: boolean;
}

export interface NavPrompt {
  kind: 'far-from-route';
  distanceM: number;
  coordinate: LngLat;
  headingDeg?: number;
}

export interface PoiSearchState {
  category: PoiCategory;
  status: 'loading' | 'ready' | 'error';
  results: PoiResult[];
}

/** Accumulated while driving; turned into a summary on arrival. Memory only. */
interface TripTracker {
  startedAt: number;
  plannedDurationS: number;
  distanceM: number;
  lastCoordinate: LngLat | null;
  lastWeatherAt: number;
  /** Minutes (route clock) spent in each condition at the vehicle position. */
  conditionMinutes: Partial<Record<WeatherCondition, number>>;
  minTemp: number | null;
  maxTemp: number | null;
  reroutes: number;
  simulated: boolean;
}

/** "Trip complete" — shown on arrival, never stored. */
export interface TripSummary {
  destination: string;
  simulated: boolean;
  durationS: number;
  distanceM: number;
  /** Actual minus planned drive time (s); positive = later than planned. */
  delayS: number;
  conditions: { condition: WeatherCondition; minutes: number }[];
  minTemp: number | null;
  maxTemp: number | null;
  reroutes: number;
  arrivalWeather: WeatherAtTime | null;
  timezone: string;
}

export interface AssistantState {
  activity: 'idle' | 'listening' | 'thinking';
  transcript: string;
  reply: { text: string; at: number } | null;
}

export interface AppState {
  origin: PlaceField;
  destination: PlaceField;
  waypoints: PlaceField[];
  departure: Departure;

  routeStatus: RouteStatus;
  routeError: string | null;
  plan: PlannedRoute | null;
  /** Primary + alternatives (planning). `plan` is the selected one. */
  routeOptions: PlannedRoute[];
  selectedOption: number;
  speedLimits: SpeedLimitProfile | null;
  /** Incidents on the current route (empty without an incident provider). */
  incidents: RouteIncident[];

  forecasts: Map<string, LocationForecast>;
  /** Dev tools injected simulated weather/incidents — the UI labels it. */
  simulatedData: boolean;
  weatherStatus: WeatherStatus;
  weatherError: string | null;
  weatherUpdatedAt: number | null;
  weatherStale: boolean;
  lastRefresh: { atMs: number; changedIds: string[]; reason: RefreshReason } | null;

  mode: NavigationMode;
  vehicle: VehicleState | null;
  progress: RouteProgress | null;
  guidance: Guidance | null;
  deviation: DeviationState;
  navStartedMs: number | null;
  recalculating: boolean;
  navPrompt: NavPrompt | null;
  locationPrimer: boolean;
  sim: SimulationState;
  speeding: { speeding: boolean; since: number | null };

  alertState: DriverAlertState;
  activeAlert: VisualAlert | null;
  arrival: TripSummary | null;
  poi: PoiSearchState | null;
  assistant: AssistantState;
  online: boolean;

  clockMs: number;
  derived: Derived;
  notice: Notice | null;

  selectedPointId: string | null;
  selectionSource: 'timeline' | 'map' | null;
  scrubMs: number | null;
  highlightedPointId: string | null;
  sheet: SheetState;
  followVehicle: boolean;
  settingsOpen: boolean;

  // --- actions ---
  setOriginText(text: string): void;
  setDestinationText(text: string): void;
  setOriginPlace(place: Place | null): void;
  setDestinationPlace(place: Place | null): void;
  swapPlaces(): void;
  addWaypoint(): void;
  setWaypointText(i: number, text: string): void;
  setWaypointPlace(i: number, place: Place | null): void;
  removeWaypoint(i: number): void;
  setDeparture(d: Departure): void;
  calculateRoute(): Promise<void>;
  selectRouteOption(i: number): Promise<void>;
  clearRoute(): void;
  loadWeather(opts?: { force?: boolean; reason?: RefreshReason }): Promise<void>;
  refreshIfStale(): Promise<void>;
  nameDisplayPoints(): Promise<void>;
  tickClock(): void;
  select(id: string | null, source: 'timeline' | 'map'): void;
  highlight(id: string | null): void;
  setScrub(ms: number | null): void;
  setSheet(s: SheetState): void;
  setFollow(f: boolean): void;
  setSettingsOpen(open: boolean): void;
  showNotice(kind: Notice['kind'], text: string, persistent?: boolean): void;
  dismissNotice(): void;
  dismissAlert(): void;
  setOnline(online: boolean): void;
  rederive(): void;

  requestNavigation(): Promise<void>;
  confirmLocationPrimer(allow: boolean): void;
  startNavigation(): void;
  handlePosition(pos: { coordinate: LngLat; accuracyM?: number; headingDeg?: number; speedMps?: number; timestampMs: number }): void;
  handleGeolocationError(message: string): void;
  resolveNavPrompt(choice: 'route-from-here' | 'simulate' | 'cancel'): void;
  stopNavigation(): void;

  startSimulation(): void;
  pauseSimulation(): void;
  resumeSimulation(): void;
  setSimulationSpeed(speed: number): void;
  advanceSimulationBy(realDtMs: number): void;
  /** Skip simulated time forward (dev tools), even while paused. */
  simulationSkip(simSeconds: number): void;
  exitSimulation(): void;

  searchPoi(category: PoiCategory, opts?: { aroundM?: number; signal?: AbortSignal }): Promise<PoiResult[]>;
  clearPoi(): void;
  addStop(place: Place): Promise<void>;

  dismissArrival(): void;
  /** Re-plan: from the vehicle while driving, else the current request. */
  recalculate(): void;
  setAssistant(patch: Partial<AssistantState>): void;
  say(text: string, priority?: number): void;
}

// ---------------------------------------------------------------------------
// Runtime (non-serializable) helpers kept outside state.

let routeAbort: AbortController | null = null;
let weatherAbort: AbortController | null = null;
/** Background work tied to the current route (late places, speed limits, naming). */
let planTasks: AbortController | null = null;
let tracker: ReturnType<typeof createProgressTracker> | null = null;
let lastDeriveAt = 0;
let lastDeriveSimMs = 0;
let lastRecalcAt = 0;
let noticeSeq = 0;
const namingAttempted = new Set<string>();
const spokenManeuvers = new Set<string>();
let voiceQueue: VoiceQueue | null = null;
let trip: TripTracker | null = null;

function startTrip(plannedDurationS: number, startedAt: number, simulated: boolean) {
  trip = {
    startedAt,
    plannedDurationS,
    distanceM: 0,
    lastCoordinate: null,
    lastWeatherAt: startedAt,
    conditionMinutes: {},
    minTemp: null,
    maxTemp: null,
    reroutes: 0,
    simulated,
  };
}

/** Distance driven and the weather actually encountered at the vehicle. */
function trackTrip(coordinate: LngLat, nowMs: number, weather: WeatherAtTime | null | undefined) {
  if (!trip) return;
  if (trip.lastCoordinate) {
    const d = haversineM(trip.lastCoordinate, coordinate);
    if (d < 5000) trip.distanceM += d; // ignore GPS jumps
  }
  trip.lastCoordinate = coordinate;
  if (weather && nowMs > trip.lastWeatherAt) {
    const minutes = (nowMs - trip.lastWeatherAt) / 60_000;
    trip.conditionMinutes[weather.condition] = (trip.conditionMinutes[weather.condition] ?? 0) + minutes;
    trip.minTemp = trip.minTemp === null ? weather.temperature : Math.min(trip.minTemp, weather.temperature);
    trip.maxTemp = trip.maxTemp === null ? weather.temperature : Math.max(trip.maxTemp, weather.temperature);
  }
  trip.lastWeatherAt = nowMs;
}

function finishTrip(s: AppState, arrivedAt: number): TripSummary | null {
  if (!trip || !s.plan) return null;
  const t = trip;
  trip = null;
  const durationS = Math.max(0, (arrivedAt - t.startedAt) / 1000);
  const last = s.derived.points.at(-1);
  return {
    destination: s.plan.timed.route.destination.name,
    simulated: t.simulated,
    durationS,
    distanceM: Math.max(t.distanceM, s.plan.timed.totalDistM - (s.progress?.remainingDistanceM ?? 0)),
    delayS: durationS - t.plannedDurationS,
    conditions: (Object.entries(t.conditionMinutes) as [WeatherCondition, number][])
      .filter(([, min]) => min >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([condition, minutes]) => ({ condition, minutes: Math.round(minutes) })),
    minTemp: t.minTemp,
    maxTemp: t.maxTemp,
    reroutes: t.reroutes,
    arrivalWeather: s.derived.currentPoint?.weather ?? last?.weather ?? null,
    timezone: last?.timezone ?? deviceTimeZone(),
  };
}

function newPlanTasks(): AbortSignal {
  planTasks?.abort();
  planTasks = new AbortController();
  return planTasks.signal;
}

/** The app's single voice channel (created lazily from the speech provider). */
export function getVoiceQueue(): VoiceQueue {
  if (!voiceQueue) {
    voiceQueue = new VoiceQueue(getProviders().tts, () => currentMessages().speechLang);
    voiceQueue.setMuted(!useSettings.getState().voice);
  }
  return voiceQueue;
}

function departureMsOf(s: Pick<AppState, 'departure' | 'clockMs'>): number {
  return s.departure.mode === 'now' ? s.clockMs : s.departure.utcMs;
}

function lookupFor(forecasts: Map<string, LocationForecast>) {
  return forecastLookupFn(getProviders(), forecasts);
}

function clockNow(s: Pick<AppState, 'mode' | 'sim' | 'clockMs'>): number {
  return s.mode === 'simulating' ? s.sim.nowMs : s.mode === 'navigating' ? Date.now() : s.clockMs;
}

/** Recompute everything the UI shows from the current inputs. */
function derive(s: AppState): Derived {
  const navigating = s.mode !== 'planning' && s.progress !== null;
  const settings = settingsSnapshot();
  lastDeriveAt = performance.now();
  lastDeriveSimMs = s.sim.nowMs;
  return deriveRouteWeather({
    plan: s.plan,
    options: s.mode === 'planning' ? s.routeOptions : [],
    forecastFor: lookupFor(s.forecasts),
    mode: s.mode,
    departureMs: navigating && s.navStartedMs !== null ? s.navStartedMs : departureMsOf(s),
    nowMs: clockNow(s),
    progress: navigating ? s.progress : null,
    vehicleCoordinate: s.vehicle?.coordinate ?? null,
    fallbackTimeZone: deviceTimeZone(),
    m: currentMessages(),
    units: settings.units,
    weatherPrefs: settings.weatherAlerts,
    speedLimits: s.speedLimits,
    fuelRangeKm: settings.fuelRangeKm,
    vehicle: settings.vehicle,
    incidents: s.incidents,
    breakReminders: settings.breakReminders,
    extraEvents: [],
    previous: s.derived,
  });
}

function oldestFetch(samples: RouteSample[], forecasts: Map<string, LocationForecast>): number | null {
  const get = lookupFor(forecasts);
  let oldest: number | null = null;
  for (const s of samples) {
    const f = get(s);
    if (f && (oldest === null || f.fetchedAt < oldest)) oldest = f.fetchedAt;
  }
  return oldest;
}

const initialSim: SimulationState = {
  playing: false,
  speed: config.simulation.defaultSpeed,
  nowMs: 0,
  modelTimeS: 0,
  startMs: 0,
  arrived: false,
};

const initialAssistant: AssistantState = { activity: 'idle', transcript: '', reply: null };

export const useAppStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    origin: { text: '', place: null },
    destination: { text: '', place: null },
    waypoints: [],
    departure: { mode: 'now' },
    routeStatus: 'idle',
    routeError: null,
    plan: null,
    routeOptions: [],
    selectedOption: 0,
    speedLimits: null,
    incidents: [],
    forecasts: new Map(),
    simulatedData: false,
    weatherStatus: 'idle',
    weatherError: null,
    weatherUpdatedAt: null,
    weatherStale: false,
    lastRefresh: null,
    mode: 'planning',
    vehicle: null,
    progress: null,
    guidance: null,
    deviation: initialDeviationState,
    navStartedMs: null,
    recalculating: false,
    navPrompt: null,
    locationPrimer: false,
    sim: initialSim,
    speeding: { speeding: false, since: null },
    alertState: initialDriverAlertState,
    activeAlert: null,
    arrival: null,
    poi: null,
    assistant: initialAssistant,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    clockMs: Date.now(),
    derived: emptyDerived,
    notice: null,
    selectedPointId: null,
    selectionSource: null,
    scrubMs: null,
    highlightedPointId: null,
    sheet: 'default',
    followVehicle: true,
    settingsOpen: false,

    // ---------------- Search ----------------
    setOriginText: (text) => set({ origin: { text, place: null } }),
    setDestinationText: (text) => set({ destination: { text, place: null } }),
    setOriginPlace: (place) => set({ origin: { text: place?.name ?? '', place } }),
    setDestinationPlace: (place) => set({ destination: { text: place?.name ?? '', place } }),
    swapPlaces: () => set((s) => ({ origin: s.destination, destination: s.origin, waypoints: [...s.waypoints].reverse() })),
    addWaypoint: () => set((s) => (s.waypoints.length >= 3 ? {} : { waypoints: [...s.waypoints, { text: '', place: null }] })),
    setWaypointText: (i, text) => set((s) => ({ waypoints: s.waypoints.map((w, k) => (k === i ? { text, place: null } : w)) })),
    setWaypointPlace: (i, place) =>
      set((s) => ({ waypoints: s.waypoints.map((w, k) => (k === i ? { text: place?.name ?? '', place } : w)) })),
    removeWaypoint: (i) => set((s) => ({ waypoints: s.waypoints.filter((_, k) => k !== i) })),

    setDeparture: (departure) => {
      set({ departure, clockMs: Date.now() });
      const s = get();
      if (s.mode === 'planning') set({ derived: derive(s) });
      if (s.plan) void get().loadWeather({ reason: 'auto' });
    },

    async calculateRoute() {
      if (get().mode !== 'planning') get().stopNavigation();
      routeAbort?.abort();
      weatherAbort?.abort();
      const ctrl = new AbortController();
      routeAbort = ctrl;
      const m = currentMessages();
      set({ routeStatus: 'geocoding', routeError: null, poi: null, arrival: null, simulatedData: false });
      const providers = getProviders();
      try {
        // "Your location" (in any field — it can be swapped) is resolved now, with a fresh fix.
        const resolveHere = async (f: PlaceField): Promise<PlaceField> =>
          f.place?.kind === 'here' ? { ...f, place: { ...f.place, coordinate: (await locateOnce(undefined, ctrl.signal)).coordinate } } : f;
        const originField = await resolveHere(get().origin);
        const destinationField = await resolveHere(get().destination);
        const waypointFields = await Promise.all(get().waypoints.map(resolveHere));
        if (ctrl.signal.aborted) return;
        set({ origin: originField, destination: destinationField, waypoints: waypointFields });
        const origin = await resolvePlace(providers, originField, ctrl.signal, m);
        const destination = await resolvePlace(providers, destinationField, ctrl.signal, m);
        const waypoints: Place[] = [];
        for (const w of waypointFields) {
          if (w.place || w.text.trim()) waypoints.push(await resolvePlace(providers, w, ctrl.signal, m));
        }
        if (haversineM(origin.coordinate, destination.coordinate) < 50 && waypoints.length === 0) {
          throw new Error('same-place');
        }
        set({
          origin: { text: get().origin.text || origin.name, place: origin },
          destination: { text: get().destination.text || destination.name, place: destination },
        });
        const { primary, alternatives } = await planRouteOptions(providers, origin, destination, {
          signal: ctrl.signal,
          waypoints,
          alternatives: true,
          language: m.locale,
          onStage: (stage) => set({ routeStatus: stage }),
        });
        if (ctrl.signal.aborted) return;
        tracker = null;
        namingAttempted.clear();
        spokenManeuvers.clear();
        set({
          plan: primary,
          routeOptions: [primary, ...alternatives],
          selectedOption: 0,
          speedLimits: null,
          routeStatus: 'ready',
          clockMs: Date.now(),
          selectedPointId: null,
          highlightedPointId: null,
          selectionSource: null,
          scrubMs: null,
          lastRefresh: null,
          alertState: initialDriverAlertState,
          activeAlert: null,
          derived: emptyDerived,
          sheet: 'default',
        });
        set({ derived: derive(get()) });
        useSavedPlaces.getState().addRecent(destination);
        startPlanTasks(primary);
        if (primary.warnings.includes('places-unavailable')) get().showNotice('info', m.ui.placesLimited);
        await get().loadWeather({ reason: 'initial' });
      } catch (e) {
        if (isAbortError(e)) return;
        const msg =
          e instanceof LocationError
            ? locationErrorText(e.kind)
            : (e as Error)?.message === 'same-place'
              ? m.ui.samePlace
              : describeError(e, m.ui.unableRoute, m);
        set({ routeStatus: 'error', routeError: msg });
      } finally {
        if (routeAbort === ctrl) routeAbort = null;
      }
    },

    async selectRouteOption(i) {
      const s = get();
      const option = s.routeOptions[i];
      if (!option || i === s.selectedOption || s.mode !== 'planning') return;
      set({ selectedOption: i, plan: option, selectedPointId: null, scrubMs: null, speedLimits: null });
      set({ derived: derive(get()) });
      if (option.warnings.includes('not-enriched')) {
        // Alternatives were only timed + sampled; add names/elevation now.
        try {
          const enriched = await enrichRoute(getProviders(), option.timed.route, {
            signal: newPlanTasks(),
            language: currentMessages().locale,
          });
          const cur = get();
          if (cur.routeOptions[i] !== option) return;
          const options = [...cur.routeOptions];
          options[i] = enriched;
          set({ routeOptions: options, ...(cur.selectedOption === i ? { plan: enriched } : {}) });
          if (get().plan === enriched) startPlanTasks(enriched, true);
        } catch (e) {
          if (!isAbortError(e)) get().rederive();
        }
      } else {
        startPlanTasks(option, true);
      }
      await get().loadWeather({ reason: 'auto' });
    },

    clearRoute: () => {
      routeAbort?.abort();
      weatherAbort?.abort();
      planTasks?.abort();
      getVoiceQueue().clear();
      tracker = null;
      set({
        plan: null,
        routeOptions: [],
        selectedOption: 0,
        speedLimits: null,
        simulatedData: false,
        routeStatus: 'idle',
        routeError: null,
        mode: 'planning',
        vehicle: null,
        progress: null,
        guidance: null,
        sim: { ...initialSim, speed: get().sim.speed },
        derived: emptyDerived,
        weatherStatus: 'idle',
        weatherError: null,
        weatherUpdatedAt: null,
        weatherStale: false,
        lastRefresh: null,
        selectedPointId: null,
        highlightedPointId: null,
        navPrompt: null,
        poi: null,
        activeAlert: null,
      });
    },

    // ---------------- Weather ----------------
    async loadWeather({ force = false, reason = 'auto' } = {}) {
      const s = get();
      const plan = s.plan;
      if (!plan) return;
      const routeKey = plan.timed; // a new object ≠ a new route: naming/refinement keep `timed`
      weatherAbort?.abort();
      const ctrl = new AbortController();
      weatherAbort = ctrl;
      set({ weatherStatus: 'loading' });
      const providers = getProviders();
      const m = currentMessages();
      // Every option's samples in one batched lookup (alternatives compare weather).
      const samples = s.mode === 'planning' ? s.routeOptions.flatMap((o) => o.samples) : plan.samples;
      const longest = Math.max(plan.timed.totalTimeS, ...s.routeOptions.map((o) => o.timed.totalTimeS));
      const latestArrival = Math.max(
        s.derived.arrivalMs ?? 0,
        departureMsOf(s) + longest * 1000,
        s.mode === 'simulating' ? s.sim.nowMs + plan.timed.totalTimeS * 1000 : 0,
      );
      const isCurrent = () => !ctrl.signal.aborted && get().plan?.timed === routeKey;
      try {
        const lookup = await fetchSampleForecasts(providers, samples.length ? samples : plan.samples, latestArrival, {
          force,
          signal: ctrl.signal,
        });
        if (!isCurrent()) return;
        const forecasts = new Map(get().forecasts);
        for (const [k, f] of lookup.forecasts) forecasts.set(k, f);
        const prevPoints = get().derived.points;
        const hasData = lookup.forecasts.size > 0;
        set({
          forecasts,
          weatherStatus: lookup.error && !hasData ? 'error' : 'ready',
          weatherError: lookup.error ? m.weather.summary.unavailable : null,
          weatherStale: lookup.staleKeys.size > 0,
          weatherUpdatedAt: oldestFetch(get().plan!.samples, forecasts),
        });
        const derived = derive(get());
        const upcomingIds = new Set(derived.upcoming.map((p) => p.id));
        const changedIds =
          reason === 'initial' ? [] : diffForecast(prevPoints, derived.points).filter((id) => upcomingIds.has(id));
        set({ derived, lastRefresh: { atMs: Date.now(), changedIds, reason } });
        const changes = countOf(changedIds.length, 'change', m);
        if (reason === 'model-update' && changedIds.length) get().showNotice('info', m.ui.newForecast(changes));
        if (reason === 'manual') {
          get().showNotice(
            lookup.error ? 'warning' : 'success',
            lookup.error ? m.weather.summary.unavailable : changedIds.length ? m.ui.forecastUpdated(changes) : m.ui.forecastUpToDate,
          );
        }

        // One-time refinement where neighbouring forecasts differ a lot.
        const current = get().plan!;
        if (!current.refined && !lookup.error) {
          const st = get();
          const arrivalById = new Map(st.derived.points.map((p) => [p.id, p.arrivalMs]));
          const dep = departureMsOf(st);
          const { plan: refined, lookup: extra } = await refinePlanWithWeather(
            providers,
            current,
            (smp) => arrivalById.get(smp.id) ?? dep + smp.travelTimeS * 1000,
            forecasts,
            ctrl.signal,
          );
          if (!isCurrent()) return;
          const merged = new Map(get().forecasts);
          if (extra) for (const [k, f] of extra.forecasts) merged.set(k, f);
          replacePlan(refined);
          set({ forecasts: merged });
          set({ derived: derive(get()) });
        }
      } catch (e) {
        if (isAbortError(e)) return;
        set({
          weatherStatus: get().forecasts.size ? 'ready' : 'error',
          weatherError: m.weather.summary.unavailable,
          weatherStale: get().forecasts.size > 0,
        });
      } finally {
        // Never leave the status stuck in "loading" (audit race).
        if (weatherAbort === ctrl) {
          weatherAbort = null;
          if (get().weatherStatus === 'loading') set({ weatherStatus: get().forecasts.size ? 'ready' : 'idle' });
        }
      }
    },

    async refreshIfStale() {
      const s = get();
      const plan = s.plan;
      if (!plan || s.weatherStatus === 'loading' || !s.online) return;
      const ageMs = s.weatherUpdatedAt ? Date.now() - s.weatherUpdatedAt : Infinity;
      if (ageMs >= config.weather.refreshMinutes * 60000) {
        await get().loadWeather({ reason: 'auto' });
        return;
      }
      if (ageMs < 5 * 60000) return;
      const lookup = lookupFor(s.forecasts);
      const used = plan.samples.map(lookup).filter((f): f is LocationForecast => !!f);
      const newer = await getProviders().weather.hasNewerForecast(used);
      const cur = get();
      if (newer && cur.plan?.timed === plan.timed && cur.weatherStatus !== 'loading') {
        await cur.loadWeather({ force: true, reason: 'model-update' });
      }
    },

    async nameDisplayPoints() {
      const s = get();
      const plan = s.plan;
      if (!plan) return;
      const unnamed = s.derived.displayPoints.filter((p) => !p.placeName && !namingAttempted.has(p.id)).slice(0, 8);
      if (unnamed.length === 0) return;
      unnamed.forEach((p) => namingAttempted.add(p.id));
      const providers = getProviders();
      const signal = planTasks?.signal;
      const names = await mapWithConcurrency(unnamed, 2, async (p) => {
        try {
          return (await providers.reverseGeocoding.reverse([p.longitude, p.latitude], { signal, language: currentMessages().locale }))?.name ?? null;
        } catch {
          return null;
        }
      });
      const current = get().plan;
      if (!current || current.timed !== plan.timed) return;
      const byId = new Map(unnamed.map((p, i) => [p.id, names[i]]));
      if (![...byId.values()].some(Boolean)) return;
      // Apply by sample id to whatever the current plan object is (audit race).
      replacePlan({
        ...current,
        samples: current.samples.map((smp) => {
          const name = byId.get(smp.id);
          return name && !smp.placeName ? { ...smp, placeName: name, placeRelation: 'near' as const } : smp;
        }),
      });
      set({ derived: derive(get()) });
    },

    tickClock() {
      set({ clockMs: Date.now() });
      const s = get();
      if (s.plan && (s.mode === 'planning' ? s.departure.mode === 'now' : s.mode === 'navigating')) {
        set({ derived: derive(s) });
      }
    },

    // ---------------- UI ----------------
    select: (id, source) => {
      const s = get();
      set({
        selectedPointId: id,
        selectionSource: id ? source : null,
        highlightedPointId: id,
        followVehicle: id && s.mode !== 'planning' ? false : s.followVehicle,
      });
    },
    highlight: (id) => {
      if (get().highlightedPointId !== id) set({ highlightedPointId: id });
    },
    setScrub: (scrubMs) => set({ scrubMs }),
    setSheet: (sheet) => set({ sheet }),
    setFollow: (followVehicle) => set({ followVehicle, ...(followVehicle ? { selectedPointId: null } : {}) }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    showNotice: (kind, text, persistent) => set({ notice: { id: ++noticeSeq, kind, text, persistent } }),
    dismissNotice: () => set({ notice: null }),
    dismissAlert: () => {
      const a = get().activeAlert;
      if (!a) return;
      set({ activeAlert: null, alertState: acknowledge(get().alertState, a.eventIds) });
    },
    setOnline: (online) => {
      if (get().online === online) return;
      set({ online });
      if (online) void get().refreshIfStale();
    },
    rederive: () => set({ derived: derive(get()) }),

    // ---------------- Live GPS navigation ----------------
    async requestNavigation() {
      if (!get().plan) return;
      getVoiceQueue(); // create inside the user gesture
      getProviders().tts.unlock();
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        get().showNotice('warning', locationErrorText('insecure'), true);
        return;
      }
      let state: PermissionState | 'unknown' = 'unknown';
      try {
        state = (await navigator.permissions?.query({ name: 'geolocation' as PermissionName }))?.state ?? 'unknown';
      } catch {
        state = 'unknown';
      }
      if (state === 'granted') get().startNavigation();
      else if (state === 'denied') get().showNotice('warning', locationErrorText('denied'), true);
      else set({ locationPrimer: true }); // explain before the browser asks
    },

    confirmLocationPrimer(allow) {
      set({ locationPrimer: false });
      if (allow) get().startNavigation();
    },

    startNavigation() {
      const s = get();
      if (!s.plan) return;
      tracker = createProgressTracker(s.plan.timed);
      spokenManeuvers.clear();
      startTrip(s.plan.timed.totalTimeS, Date.now(), false);
      set({
        arrival: null,
        mode: 'navigating',
        navStartedMs: Date.now(),
        progress: null,
        vehicle: null,
        guidance: null,
        deviation: initialDeviationState,
        followVehicle: true,
        selectedPointId: null,
        scrubMs: null,
        sheet: 'compact',
        navPrompt: null,
        alertState: initialDriverAlertState,
        activeAlert: null,
      });
      get().showNotice('info', currentMessages().ui.waitingForLocation, true);
      loadSpeedLimits();
    },

    handlePosition(pos) {
      const s = get();
      if (s.mode !== 'navigating' || !s.plan || s.navPrompt) return;
      const settings = settingsSnapshot();
      const now = Date.now();
      // Battery saver: when the next maneuver is far, process at most one fix per 3 s.
      if (settings.batterySaver && s.progress && s.guidance && s.guidance.distanceToNextM > 3000 && now - s.progress.nowMs < 3000) {
        set({ vehicle: { ...pos } });
        return;
      }
      if (!tracker) tracker = createProgressTracker(s.plan.timed);
      const progress = tracker(pos.coordinate, now, { headingDeg: pos.headingDeg, accuracyM: pos.accuracyM });
      const vehicle: VehicleState = { ...pos };

      if (!s.progress && progress.distanceFromRouteM > config.navigation.farFromRouteM) {
        set({
          vehicle,
          navPrompt: { kind: 'far-from-route', distanceM: progress.distanceFromRouteM, coordinate: pos.coordinate, headingDeg: pos.headingDeg },
          notice: null,
        });
        return;
      }
      if (!s.progress) set({ notice: null });

      const deviation = updateDeviation(
        s.deviation,
        {
          distanceFromRouteM: progress.distanceFromRouteM,
          accuracyM: pos.accuracyM,
          timestampMs: pos.timestampMs,
          roadSpeedMps: edgeSpeedMps(s.plan.timed, progress.segmentIndex),
        },
        {
          minThresholdM: config.navigation.offRouteMinThresholdM,
          maxThresholdM: config.navigation.offRouteMaxThresholdM,
          maxUsableAccuracyM: config.navigation.maxUsableAccuracyM,
          persistReadings: config.navigation.offRoutePersistReadings,
          persistSeconds: config.navigation.offRoutePersistSeconds,
        },
      );
      set({ deviation });
      onProgress(vehicle, progress, pos.speedMps, true);

      const st = get();
      if (
        deviation.status === 'off-route' &&
        !st.recalculating &&
        now - lastRecalcAt > config.navigation.minRecalculationIntervalS * 1000
      ) {
        if (st.online) void recalculateFrom(pos.coordinate, pos.headingDeg);
      }
      if (hasArrived(progress)) {
        const m = currentMessages();
        const summary = finishTrip(get(), now);
        get().stopNavigation(); // clears the voice queue — announce after it
        get().say(m.voice.arrived(st.plan!.timed.route.destination.name), 1);
        set({ arrival: summary, sheet: 'default', activeAlert: null });
      }
    },

    handleGeolocationError(message) {
      if (get().mode !== 'navigating') return;
      get().stopNavigation();
      get().showNotice('warning', message, true);
    },

    resolveNavPrompt(choice) {
      const p = get().navPrompt;
      set({ navPrompt: null });
      if (!p) return;
      if (choice === 'route-from-here') void recalculateFrom(p.coordinate, p.headingDeg);
      else if (choice === 'simulate') {
        get().stopNavigation();
        get().startSimulation();
      } else get().stopNavigation();
    },

    stopNavigation() {
      // Cancel an in-flight re-route so it can't resurrect navigation (audit race).
      routeAbort?.abort();
      routeAbort = null;
      tracker = null;
      trip = null;
      getVoiceQueue().clear();
      set({
        mode: 'planning',
        vehicle: null,
        progress: null,
        guidance: null,
        navStartedMs: null,
        deviation: initialDeviationState,
        navPrompt: null,
        recalculating: false,
        sheet: 'default',
        clockMs: Date.now(),
        activeAlert: null,
        speeding: { speeding: false, since: null },
        notice: get().notice?.persistent ? null : get().notice,
      });
      set({ derived: derive(get()) });
    },

    // ---------------- Demo simulation ----------------
    startSimulation() {
      const s = get();
      if (!s.plan) return;
      getVoiceQueue();
      getProviders().tts.unlock();
      spokenManeuvers.clear();
      const startMs = departureMsOf({ ...s, clockMs: Date.now() });
      const first = advanceSimulation(s.plan.timed, { nowMs: startMs, modelTimeS: 0 }, startMs, 0, 1);
      startTrip(s.plan.timed.totalTimeS, startMs, true);
      set({
        arrival: null,
        mode: 'simulating',
        navStartedMs: startMs,
        sim: { ...s.sim, playing: true, nowMs: startMs, modelTimeS: 0, startMs, arrived: false },
        vehicle: { coordinate: first.coordinate, headingDeg: first.headingDeg, timestampMs: startMs },
        progress: simProgress(s.plan.timed, first),
        followVehicle: true,
        selectedPointId: null,
        highlightedPointId: null,
        scrubMs: null,
        sheet: 'compact',
        alertState: initialDriverAlertState,
        activeAlert: null,
      });
      set({ derived: derive(get()), guidance: computeGuidance(get().derived.maneuvers, s.plan.timed, 0) });
      const m = currentMessages();
      get().say(m.voice.routeStarted(s.plan.timed.route.destination.name, spokenDuration(s.plan.timed.totalTimeS, m, false)), 3);
      loadSpeedLimits();
    },
    pauseSimulation: () => set((s) => ({ sim: { ...s.sim, playing: false } })),
    resumeSimulation: () => {
      const s = get();
      if (s.sim.arrived) {
        get().startSimulation();
        return;
      }
      set({ sim: { ...s.sim, playing: true } });
    },
    setSimulationSpeed: (speed) => set((s) => ({ sim: { ...s.sim, speed } })),

    advanceSimulationBy(realDtMs) {
      const s = get();
      if (s.mode !== 'simulating' || !s.sim.playing || !s.plan) return;
      const step = advanceSimulation(s.plan.timed, s.sim, s.sim.startMs, realDtMs, s.sim.speed);
      const simDtS = step.nowMs - s.sim.nowMs > 0 ? (step.nowMs - s.sim.nowMs) / 1000 : 0;
      const speedMps = simDtS > 0 && s.progress ? (step.distanceM - s.progress.distanceAlongM) / simDtS : undefined;
      const vehicle: VehicleState = { coordinate: step.coordinate, headingDeg: step.headingDeg, speedMps, timestampMs: step.nowMs };
      set({ sim: { ...s.sim, nowMs: step.nowMs, modelTimeS: step.modelTimeS, arrived: step.arrived, playing: !step.arrived } });
      onProgress(vehicle, simProgress(s.plan.timed, step), speedMps, false);
      if (step.arrived) {
        const summary = finishTrip(get(), step.nowMs);
        set({ arrival: summary, sheet: 'default', activeAlert: null });
      }
    },

    simulationSkip(simSeconds) {
      const s = get();
      if (s.mode !== 'simulating' || !s.plan || s.sim.arrived) return;
      const wasPlaying = s.sim.playing;
      set({ sim: { ...s.sim, playing: true } });
      get().advanceSimulationBy((simSeconds * 1000) / s.sim.speed);
      const after = get();
      if (!wasPlaying && after.mode === 'simulating' && !after.sim.arrived) set({ sim: { ...after.sim, playing: false } });
    },

    exitSimulation() {
      getVoiceQueue().clear();
      trip = null;
      set({
        arrival: null,
        mode: 'planning',
        vehicle: null,
        progress: null,
        guidance: null,
        navStartedMs: null,
        sim: { ...get().sim, playing: false, arrived: false },
        sheet: 'default',
        clockMs: Date.now(),
        followVehicle: true,
        activeAlert: null,
      });
      set({ derived: derive(get()) });
    },

    // ---------------- Places along the route ----------------
    async searchPoi(category, opts = {}) {
      const s = get();
      const providers = getProviders();
      if (!s.plan || !providers.poi) return [];
      set({ poi: { category, status: 'loading', results: [] } });
      const fromM = opts.aroundM !== undefined ? Math.max(0, opts.aroundM - 5000) : (s.progress?.distanceAlongM ?? 0);
      const aheadM = opts.aroundM !== undefined ? 10_000 : 60_000;
      try {
        const results = await searchAlongRoute({
          places: providers.poi,
          routing: providers.routing,
          timed: s.plan.timed,
          category,
          fromM,
          aheadM,
          signal: opts.signal ?? planTasks?.signal,
          language: currentMessages().locale,
        });
        if (get().plan?.timed !== s.plan.timed) return [];
        set({ poi: { category, status: 'ready', results } });
        return results;
      } catch (e) {
        if (!isAbortError(e)) set({ poi: { category, status: 'error', results: [] } });
        return [];
      }
    },
    clearPoi: () => set({ poi: null }),

    async addStop(place) {
      const s = get();
      if (s.mode !== 'planning' && s.vehicle) {
        // While driving: re-route from here through the stop.
        await recalculateFrom(s.vehicle.coordinate, s.vehicle.headingDeg, [place]);
        return;
      }
      set({ waypoints: [...s.waypoints, { text: place.name, place }].slice(0, 3), poi: null });
      await get().calculateRoute();
    },

    recalculate() {
      const s = get();
      if (s.mode !== 'planning' && s.vehicle) void recalculateFrom(s.vehicle.coordinate, s.vehicle.headingDeg);
      else if (s.plan) void s.calculateRoute();
    },

    dismissArrival() {
      const s = get();
      set({ arrival: null });
      if (s.mode === 'simulating') s.exitSimulation();
      get().clearRoute();
    },

    // ---------------- Voice ----------------
    setAssistant: (patch) => set((s) => ({ assistant: { ...s.assistant, ...patch } })),
    say(text, priority = 3) {
      const speed = get().mode === 'simulating' ? get().sim.speed : 1;
      getVoiceQueue().enqueue({
        id: `say:${text}:${Math.floor(Date.now() / 1000)}`,
        text,
        priority,
        expiresAt: Date.now() + Math.max(5000, 60_000 / speed),
        interruptible: priority > 1,
      });
    },
  })),
);

/** Replace the plan object everywhere it is referenced (plan + its option slot). */
function replacePlan(next: PlannedRoute) {
  const s = useAppStore.getState();
  const options = s.routeOptions.map((o) => (o.timed === next.timed ? next : o));
  useAppStore.setState({ plan: next, routeOptions: options.length ? options : [next] });
}

/** Background work for a route: late place names, incidents (and, on drive start, OSM speed limits). */
function startPlanTasks(plan: PlannedRoute, keepSignal = false) {
  const signal = keepSignal && planTasks && !planTasks.signal.aborted ? planTasks.signal : newPlanTasks();
  useAppStore.setState({ incidents: [] });
  const incidents = getProviders().incidents;
  if (incidents.name !== 'none') {
    incidents
      .getIncidents(plan.timed.route, signal)
      .then((list) => {
        if (signal.aborted || useAppStore.getState().plan?.timed !== plan.timed) return;
        useAppStore.setState({ incidents: snapIncidentsToRoute(list, plan.timed) });
        useAppStore.getState().rederive();
      })
      .catch(() => undefined); // incidents are optional; the route works without them
  }
  if (plan.latePlaces) {
    void plan.latePlaces.then((places) => {
      const cur = useAppStore.getState().plan;
      if (signal.aborted || !cur || cur.timed !== plan.timed) return;
      replacePlan(applyLatePlaces(cur, places));
      useAppStore.getState().rederive();
    });
  }
}

let speedLimitsFor: PlannedRoute['timed'] | null = null;

/**
 * OSM speed limits, fetched once per route and only when a drive starts
 * (planning doesn't need them; the public Overpass servers are shared).
 */
function loadSpeedLimits() {
  const s = useAppStore.getState();
  const provider = getProviders().speedLimits;
  const timed = s.plan?.timed;
  if (!provider || !timed || !useSettings.getState().speedWarnings || speedLimitsFor === timed) return;
  speedLimitsFor = timed;
  const signal = planTasks?.signal ?? newPlanTasks();
  provider
    .getSpeedLimits(timed.route.geometry, signal)
    .then((ways) => {
      if (signal.aborted || useAppStore.getState().plan?.timed !== timed) return;
      useAppStore.setState({ speedLimits: matchSpeedLimits(timed, ways) });
      useAppStore.getState().rederive();
    })
    .catch(() => {
      if (speedLimitsFor === timed) speedLimitsFor = null; // allow a retry on the next drive
    });
}

/**
 * THE REAL-TIME LOOP (GPS fix or simulation step):
 * position → map-matched progress → guidance → maneuver voice → speed →
 * (throttled) weather/events → alert prioritisation → voice + visual.
 */
function onProgress(vehicle: VehicleState, progress: RouteProgress, speedMps: number | undefined, live: boolean) {
  const store = useAppStore;
  const s = store.getState();
  if (!s.plan) return;
  const settings = settingsSnapshot();
  const m = currentMessages();
  const simSpeed = s.mode === 'simulating' ? s.sim.speed : 1;

  // 1. Position + progress (every update; the map reads these imperatively).
  const maneuvers = s.derived.maneuvers.length ? s.derived.maneuvers : [];
  const guidance = computeGuidance(maneuvers, s.plan.timed, progress.distanceAlongM);
  const prevG = s.guidance;
  const guidanceChanged =
    !prevG || prevG.next?.id !== guidance.next?.id || Math.round(prevG.distanceToNextM / 10) !== Math.round(guidance.distanceToNextM / 10);

  // 2. Speed limit + speeding (hysteresis).
  const speedKmh = speedMps !== undefined && Number.isFinite(speedMps) ? speedMps * 3.6 : null;
  const limit = speedLimitAt(s.speedLimits, progress.distanceAlongM);
  const speeding = settings.speedWarnings ? updateSpeeding(s.speeding, live ? speedKmh : null, limit, progress.nowMs) : s.speeding;

  trackTrip(vehicle.coordinate, progress.nowMs, s.derived.currentPoint?.weather);
  store.setState({
    vehicle,
    progress,
    ...(guidanceChanged ? { guidance } : {}),
    ...(speeding !== s.speeding ? { speeding } : {}),
  });

  // 3. Maneuver voice — immediate, top priority. At fast simulation speeds the
  //    prompts would be meaningless, so only real-time-ish playback speaks them.
  const queue = getVoiceQueue();
  const next = guidance.next;
  if (next && simSpeed <= 10) {
    const v = speedMps ?? edgeSpeedMps(s.plan.timed, progress.segmentIndex) ?? 14;
    const stage = dueManeuverPrompt(next, guidance.distanceToNextM, v, spokenManeuvers);
    if (stage) {
      markSpoken(next, stage, spokenManeuvers);
      queue.enqueue({
        id: `mv:${next.id}:${stage}`,
        text: spokenPrompt(next, stage, guidance.distanceToNextM, m, settings.units.distance, guidance.then),
        priority: 1,
        expiresAt: Date.now() + Math.max(3000, 15_000 / simSpeed),
        interruptible: false,
      });
    }
    // Weather waits while a maneuver is seconds away.
    queue.holdBelowPriority(guidance.timeToNextS < 12 ? 1 : null);
  } else {
    queue.holdBelowPriority(null);
  }

  // 4. Weather + route events: throttled (≤1/s real time, or every 30 s of simulated time).
  const due = performance.now() - lastDeriveAt > 1000 || progress.nowMs - lastDeriveSimMs >= 30_000;
  if (!due) return;
  store.setState({ derived: derive(store.getState()) });
  const st = store.getState();
  const decision = evaluateDriverAlerts(st.derived.intelligence.events, st.alertState, {
    nowMs: progress.nowMs,
    prefs: { output: settings.alertOutput, timing: settings.alertTiming },
    m,
  });
  store.setState({ alertState: decision.state, ...(decision.visual ? { activeAlert: decision.visual } : {}) });
  for (const v of decision.voice) {
    queue.enqueue({
      id: v.id,
      text: v.text,
      priority: v.priority,
      // Alert time runs on the (possibly simulated) route clock; the queue on real time.
      expiresAt: Date.now() + Math.max(5000, (v.expiresAt - progress.nowMs) / simSpeed),
      interruptible: true,
    });
  }
}

/** Off-route (or far-from-route start): re-plan from the vehicle to the destination. */
async function recalculateFrom(coordinate: LngLat, headingDeg?: number, extraStops: Place[] = []): Promise<void> {
  const store = useAppStore;
  const s = store.getState();
  if (!s.plan) return;
  const m = currentMessages();
  lastRecalcAt = Date.now();
  routeAbort?.abort();
  const ctrl = new AbortController();
  routeAbort = ctrl;
  if (trip) trip.reroutes++;
  store.setState({ recalculating: true });
  s.showNotice('info', m.ui.recalculating, true);
  const origin: Place = { id: `here:${coordinate.join(',')}`, name: m.ui.currentLocation, label: m.ui.currentLocation, coordinate };
  // Keep only stops still ahead of the vehicle.
  const route = s.plan.timed.route;
  const progressM = s.progress?.distanceAlongM ?? 0;
  const aheadStops =
    route.waypoints?.filter((_, i) => {
      const arrive = s.derived.maneuvers.find((mv) => mv.kind === 'arrive' && mv.legIndex === i);
      return !arrive || arrive.distanceAlongM > progressM;
    }) ?? [];
  try {
    const plan = await planRoute(getProviders(), origin, route.destination, {
      signal: ctrl.signal,
      startBearingDeg: headingDeg,
      waypoints: [...extraStops, ...aheadStops],
      language: m.locale,
    });
    const cur = store.getState();
    // Navigation ended while we were re-routing → drop the result (audit race).
    if (ctrl.signal.aborted || cur.mode === 'planning') return;
    tracker = createProgressTracker(plan.timed);
    spokenManeuvers.clear();
    // A simulated drive restarts on the new route (its clock keeps running).
    const simulating = cur.mode === 'simulating';
    const now = simulating ? cur.sim.nowMs : Date.now();
    const start = plan.timed.route.geometry[0];
    const progress = simulating
      ? simProgress(plan.timed, { nowMs: now, modelTimeS: 0, distanceM: 0, coordinate: start, headingDeg: headingDeg ?? 0, arrived: false })
      : tracker(coordinate, now, { headingDeg });
    store.setState({
      plan,
      routeOptions: [plan],
      selectedOption: 0,
      speedLimits: null,
      navStartedMs: now,
      progress,
      ...(simulating ? { sim: { ...cur.sim, modelTimeS: 0, startMs: now, arrived: false }, vehicle: { coordinate: start, headingDeg, timestampMs: now } } : {}),
      deviation: initialDeviationState,
      recalculating: false,
      mode: cur.mode === 'simulating' ? 'simulating' : 'navigating',
      navPrompt: null,
      followVehicle: true,
      selectedPointId: null,
      poi: null,
    });
    store.setState({ derived: derive(store.getState()) });
    startPlanTasks(plan);
    loadSpeedLimits();
    store.getState().showNotice('success', m.ui.routeUpdated);
    store.getState().say(m.voice.rerouted, 3);
    await store.getState().loadWeather({ reason: 'recalculation' });
  } catch (e) {
    if (isAbortError(e)) return;
    store.setState({ recalculating: false });
    const offline = !store.getState().online;
    store.getState().showNotice('error', offline ? m.ui.offlineDetail : describeError(e, m.ui.unableRoute, m));
  } finally {
    if (routeAbort === ctrl) routeAbort = null;
  }
}

/** Same wording as the explore layer (platform-specific help for "denied"). */
function locationErrorText(kind: LocationError['kind']): string {
  const m = currentMessages();
  const ios = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  return kind === 'denied' && ios ? m.location.deniedIos : m.location.errors[kind];
}

/** Dev tools: re-route as if the vehicle had left the route at `coordinate`. */
export function __devRerouteFrom(coordinate: LngLat, headingDeg?: number) {
  return recalculateFrom(coordinate, headingDeg);
}

/** Test helper: reset module-level runtime state. */
export function __resetStoreRuntime() {
  routeAbort?.abort();
  weatherAbort?.abort();
  planTasks?.abort();
  routeAbort = null;
  weatherAbort = null;
  planTasks = null;
  tracker = null;
  namingAttempted.clear();
  spokenManeuvers.clear();
  voiceQueue = null;
  trip = null;
  speedLimitsFor = null;
  lastDeriveAt = 0;
  lastDeriveSimMs = 0;
  lastRecalcAt = 0;
}

