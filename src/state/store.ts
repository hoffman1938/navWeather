import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { edgeSpeedMps, createProgressTracker } from '../algorithms/routeProgress';
import { initialDeviationState, updateDeviation } from '../algorithms/routeDeviation';
import { diffForecast } from '../algorithms/routeWeather';
import { advanceSimulation, simProgress } from '../algorithms/simulation';
import { config } from '../config';
import { isAbortError, mapWithConcurrency } from '../services/http';
import { getProviders } from '../services/providers';
import {
  applyLatePlaces,
  describeError,
  fetchSampleForecasts,
  forecastLookupFn,
  planRoute,
  refinePlanWithWeather,
  resolvePlace,
  type PlannedRoute,
  type PlanStage,
} from '../services/routePlanner';
import type { LngLat, Place } from '../types/geo';
import type { DeviationState, NavigationMode, RouteProgress, VehicleState } from '../types/navigation';
import type { RouteSample } from '../types/route';
import type { LocationForecast } from '../types/weather';
import { haversineM } from '../utils/distance';
import { deviceTimeZone } from '../utils/timezone';
import { deriveRouteWeather, emptyDerived, type Derived } from './derive';

export type RouteStatus = 'idle' | PlanStage | 'ready' | 'error';
export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SheetState = 'compact' | 'default' | 'expanded';
export type Departure = { mode: 'now' } | { mode: 'at'; utcMs: number };

export interface PlaceField {
  text: string;
  place: Place | null;
}

export interface Notice {
  id: number;
  kind: 'info' | 'warning' | 'error' | 'success';
  text: string;
  /** Persistent notices stay until replaced/cleared. */
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

export interface AppState {
  origin: PlaceField;
  destination: PlaceField;
  departure: Departure;

  routeStatus: RouteStatus;
  routeError: string | null;
  plan: PlannedRoute | null;

  forecasts: Map<string, LocationForecast>;
  weatherStatus: WeatherStatus;
  weatherError: string | null;
  /** Oldest fetch time among forecasts in use ("Updated 12:42"). */
  weatherUpdatedAt: number | null;
  weatherStale: boolean;
  lastRefresh: { atMs: number; changedIds: string[]; reason: RefreshReason } | null;

  mode: NavigationMode;
  vehicle: VehicleState | null;
  progress: RouteProgress | null;
  deviation: DeviationState;
  navStartedMs: number | null;
  recalculating: boolean;
  navPrompt: NavPrompt | null;
  sim: SimulationState;

  /** Real clock for "leave now" planning (ticks every 30 s). */
  clockMs: number;
  derived: Derived;
  notice: Notice | null;

  selectedPointId: string | null;
  selectionSource: 'timeline' | 'map' | null;
  /** Time picked in "Where will I be at…" (UTC ms), or null. */
  scrubMs: number | null;
  highlightedPointId: string | null;
  sheet: SheetState;
  followVehicle: boolean;

  // --- actions ---
  setOriginText(text: string): void;
  setDestinationText(text: string): void;
  setOriginPlace(place: Place | null): void;
  setDestinationPlace(place: Place | null): void;
  swapPlaces(): void;
  setDeparture(d: Departure): void;
  calculateRoute(): Promise<void>;
  clearRoute(): void;
  loadWeather(opts?: { force?: boolean; reason?: RefreshReason }): Promise<void>;
  refreshIfStale(): void;
  /** Reverse-geocode the few visible points that have no settlement name. */
  nameDisplayPoints(): Promise<void>;
  tickClock(): void;
  select(id: string | null, source: 'timeline' | 'map'): void;
  highlight(id: string | null): void;
  setScrub(ms: number | null): void;
  setSheet(s: SheetState): void;
  setFollow(f: boolean): void;
  showNotice(kind: Notice['kind'], text: string, persistent?: boolean): void;
  dismissNotice(): void;

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
  exitSimulation(): void;
}

export type RefreshReason = 'initial' | 'auto' | 'model-update' | 'manual' | 'recalculation' | 'refinement';

// Non-serializable runtime helpers kept outside state.
let routeAbort: AbortController | null = null;
let weatherAbort: AbortController | null = null;
let tracker: ReturnType<typeof createProgressTracker> | null = null;
let lastDeriveAt = 0;
let lastDeriveSimMs = 0;
let lastRecalcAt = 0;
let noticeSeq = 0;
const namingAttempted = new Set<string>();

function departureMsOf(s: Pick<AppState, 'departure' | 'clockMs'>): number {
  return s.departure.mode === 'now' ? s.clockMs : s.departure.utcMs;
}

function lookupFor(forecasts: Map<string, LocationForecast>) {
  return forecastLookupFn(getProviders(), forecasts);
}

/** Recompute everything the UI shows from the current inputs. */
function derive(s: AppState, overrides: Partial<AppState> = {}): Derived {
  const st = { ...s, ...overrides };
  const navigating = st.mode !== 'planning' && st.progress !== null;
  const nowMs = st.mode === 'simulating' ? st.sim.nowMs : st.mode === 'navigating' ? Date.now() : st.clockMs;
  lastDeriveAt = performance.now();
  lastDeriveSimMs = st.sim.nowMs;
  return deriveRouteWeather({
    plan: st.plan,
    forecastFor: lookupFor(st.forecasts),
    mode: st.mode,
    departureMs: navigating && st.navStartedMs !== null ? st.navStartedMs : departureMsOf(st),
    nowMs,
    progress: navigating ? st.progress : null,
    vehicleCoordinate: st.vehicle?.coordinate ?? null,
    fallbackTimeZone: deviceTimeZone(),
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

export const useAppStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    origin: { text: '', place: null },
    destination: { text: '', place: null },
    departure: { mode: 'now' },
    routeStatus: 'idle',
    routeError: null,
    plan: null,
    forecasts: new Map(),
    weatherStatus: 'idle',
    weatherError: null,
    weatherUpdatedAt: null,
    weatherStale: false,
    lastRefresh: null,
    mode: 'planning',
    vehicle: null,
    progress: null,
    deviation: initialDeviationState,
    navStartedMs: null,
    recalculating: false,
    navPrompt: null,
    sim: initialSim,
    clockMs: Date.now(),
    derived: emptyDerived,
    notice: null,
    selectedPointId: null,
    selectionSource: null,
    scrubMs: null,
    highlightedPointId: null,
    sheet: 'default',
    followVehicle: true,

    setOriginText: (text) => set({ origin: { text, place: null } }),
    setDestinationText: (text) => set({ destination: { text, place: null } }),
    setOriginPlace: (place) => set({ origin: { text: place?.name ?? '', place } }),
    setDestinationPlace: (place) => set({ destination: { text: place?.name ?? '', place } }),
    swapPlaces: () => set((s) => ({ origin: s.destination, destination: s.origin })),

    setDeparture: (departure) => {
      set({ departure, clockMs: Date.now() });
      const s = get();
      if (s.mode === 'planning') set({ derived: derive(s) });
      // A later departure may need a longer forecast horizon.
      if (s.plan) void get().loadWeather({ reason: 'auto' });
    },

    async calculateRoute() {
      const s = get();
      if (s.mode !== 'planning') get().stopNavigation();
      routeAbort?.abort();
      weatherAbort?.abort();
      const ctrl = new AbortController();
      routeAbort = ctrl;
      set({ routeStatus: 'geocoding', routeError: null });
      const providers = getProviders();
      try {
        const origin = await resolvePlace(providers, get().origin, ctrl.signal);
        const destination = await resolvePlace(providers, get().destination, ctrl.signal);
        if (haversineM(origin.coordinate, destination.coordinate) < 50) {
          throw new Error('same-place');
        }
        set({
          origin: { text: get().origin.text || origin.name, place: origin },
          destination: { text: get().destination.text || destination.name, place: destination },
        });
        const plan = await planRoute(providers, origin, destination, {
          signal: ctrl.signal,
          onStage: (stage) => set({ routeStatus: stage }),
        });
        if (ctrl.signal.aborted) return;
        tracker = null;
        set({
          plan,
          routeStatus: 'ready',
          clockMs: Date.now(),
          selectedPointId: null,
          highlightedPointId: null,
          selectionSource: null,
          scrubMs: null,
          lastRefresh: null,
          derived: emptyDerived,
          sheet: 'default',
        });
        set({ derived: derive(get()) });
        watchLatePlaces(plan);
        if (plan.warnings.includes('places-unavailable')) {
          get().showNotice('info', 'Place names are limited right now — weather is unaffected');
        }
        await get().loadWeather({ reason: 'initial' });
      } catch (e) {
        if (isAbortError(e)) return;
        const msg =
          (e as Error)?.message === 'same-place'
            ? 'Start and destination are the same place'
            : describeError(e, 'Unable to calculate route');
        set({ routeStatus: 'error', routeError: msg });
      } finally {
        if (routeAbort === ctrl) routeAbort = null;
      }
    },

    clearRoute: () => {
      routeAbort?.abort();
      weatherAbort?.abort();
      tracker = null;
      set({
        plan: null,
        routeStatus: 'idle',
        routeError: null,
        mode: 'planning',
        vehicle: null,
        progress: null,
        sim: { ...initialSim, speed: get().sim.speed },
        derived: emptyDerived,
        weatherStatus: 'idle',
        weatherError: null,
        weatherUpdatedAt: null,
        weatherStale: false,
        lastRefresh: null,
        selectedPointId: null,
        highlightedPointId: null,
        scrubMs: null,
        navPrompt: null,
      });
    },

    async loadWeather({ force = false, reason = 'auto' } = {}) {
      const s = get();
      const plan = s.plan;
      if (!plan) return;
      weatherAbort?.abort();
      const ctrl = new AbortController();
      weatherAbort = ctrl;
      set({ weatherStatus: 'loading' });
      const providers = getProviders();
      const latestArrival = Math.max(
        s.derived.arrivalMs ?? 0,
        departureMsOf(s) + plan.timed.totalTimeS * 1000,
        s.mode === 'simulating' ? s.sim.nowMs + plan.timed.totalTimeS * 1000 : 0,
      );
      try {
        const lookup = await fetchSampleForecasts(providers, plan.samples, latestArrival, {
          force,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted || get().plan !== plan) return;
        const forecasts = new Map(get().forecasts);
        for (const [k, f] of lookup.forecasts) forecasts.set(k, f);
        const prevPoints = get().derived.points;
        const hasData = lookup.forecasts.size > 0;
        set({
          forecasts,
          weatherStatus: lookup.error && !hasData ? 'error' : 'ready',
          weatherError: lookup.error ? 'Weather data temporarily unavailable' : null,
          weatherStale: lookup.staleKeys.size > 0,
          weatherUpdatedAt: oldestFetch(plan.samples, forecasts),
        });
        const derived = derive(get());
        const changedIds = reason === 'initial' ? [] : diffForecast(prevPoints, derived.points);
        set({ derived, lastRefresh: { atMs: Date.now(), changedIds, reason } });
        if (reason === 'model-update' && changedIds.length) {
          get().showNotice(
            'info',
            `New forecast · ${changedIds.length} change${changedIds.length > 1 ? 's' : ''} along your route`,
          );
        }
        if (reason === 'manual') {
          get().showNotice(
            lookup.error ? 'warning' : 'success',
            lookup.error
              ? 'Weather data temporarily unavailable — showing the last forecast'
              : changedIds.length
                ? `Forecast updated · ${changedIds.length} change${changedIds.length > 1 ? 's' : ''}`
                : 'Forecast is up to date',
          );
        }

        // One-time refinement where neighbouring forecasts differ a lot.
        if (!plan.refined && !lookup.error) {
          const st = get();
          const arrivalById = new Map(st.derived.points.map((p) => [p.id, p.arrivalMs]));
          const dep = departureMsOf(st);
          const { plan: refined, lookup: extra } = await refinePlanWithWeather(
            providers,
            plan,
            (smp) => arrivalById.get(smp.id) ?? dep + smp.travelTimeS * 1000,
            forecasts,
            ctrl.signal,
          );
          if (ctrl.signal.aborted || get().plan !== plan) return;
          const merged = new Map(get().forecasts);
          if (extra) for (const [k, f] of extra.forecasts) merged.set(k, f);
          set({ plan: refined, forecasts: merged });
          set({ derived: derive(get()) });
        }
      } catch (e) {
        if (isAbortError(e)) return;
        set({
          weatherStatus: get().forecasts.size ? 'ready' : 'error',
          weatherError: 'Weather data temporarily unavailable',
          weatherStale: get().forecasts.size > 0,
        });
      } finally {
        if (weatherAbort === ctrl) weatherAbort = null;
      }
    },

    async nameDisplayPoints() {
      const s = get();
      const plan = s.plan;
      if (!plan) return;
      const unnamed = s.derived.displayPoints
        .filter((p) => !p.placeName && !namingAttempted.has(p.id))
        .slice(0, 8);
      if (unnamed.length === 0) return;
      unnamed.forEach((p) => namingAttempted.add(p.id));
      const providers = getProviders();
      const names = await mapWithConcurrency(unnamed, 2, async (p) => {
        try {
          return (await providers.reverseGeocoding.reverse([p.longitude, p.latitude]))?.name ?? null;
        } catch {
          return null;
        }
      });
      const current = get().plan;
      if (current !== plan) return;
      const byId = new Map(unnamed.map((p, i) => [p.id, names[i]]));
      if (![...byId.values()].some(Boolean)) return;
      const samples = plan.samples.map((smp) => {
        const name = byId.get(smp.id);
        return name ? { ...smp, placeName: name, placeRelation: 'near' as const } : smp;
      });
      set({ plan: { ...plan, samples } });
      set({ derived: derive(get()) });
    },

    refreshIfStale() {
      const s = get();
      const plan = s.plan;
      if (!plan || s.weatherStatus === 'loading') return;
      const ageMs = s.weatherUpdatedAt ? Date.now() - s.weatherUpdatedAt : Infinity;
      if (ageMs >= config.weather.refreshMinutes * 60000) {
        void get().loadWeather({ reason: 'auto' });
        return;
      }
      // A newer model run upstream? (The service asks at most every few minutes.)
      if (ageMs < 5 * 60000) return;
      const lookup = lookupFor(s.forecasts);
      const used = plan.samples.map(lookup).filter((f): f is LocationForecast => !!f);
      void getProviders()
        .weather.hasNewerForecast(used)
        .then((newer) => {
          const cur = get();
          if (newer && cur.plan === plan && cur.weatherStatus !== 'loading') {
            void cur.loadWeather({ force: true, reason: 'model-update' });
          }
        });
    },

    tickClock() {
      set({ clockMs: Date.now() });
      const s = get();
      if (s.plan && (s.mode === 'planning' ? s.departure.mode === 'now' : s.mode === 'navigating')) {
        set({ derived: derive(s) });
      }
    },

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
    showNotice: (kind, text, persistent) => set({ notice: { id: ++noticeSeq, kind, text, persistent } }),
    dismissNotice: () => set({ notice: null }),

    // ---------------- Live GPS navigation ----------------
    startNavigation() {
      const s = get();
      if (!s.plan) return;
      tracker = createProgressTracker(s.plan.timed);
      set({
        mode: 'navigating',
        navStartedMs: Date.now(),
        progress: null,
        vehicle: null,
        deviation: initialDeviationState,
        followVehicle: true,
        selectedPointId: null,
        scrubMs: null,
        sheet: 'compact',
        navPrompt: null,
      });
      get().showNotice('info', 'Waiting for your location…', true);
    },

    handlePosition(pos) {
      const s = get();
      if (s.mode !== 'navigating' || !s.plan || s.navPrompt) return;
      if (!tracker) tracker = createProgressTracker(s.plan.timed);
      const now = Date.now();
      const progress = tracker(pos.coordinate, now);
      const vehicle: VehicleState = { ...pos };

      // First fix far from the route: ask instead of silently re-routing.
      if (!s.progress && progress.distanceFromRouteM > config.navigation.farFromRouteM) {
        set({
          vehicle,
          navPrompt: {
            kind: 'far-from-route',
            distanceM: progress.distanceFromRouteM,
            coordinate: pos.coordinate,
            headingDeg: pos.headingDeg,
          },
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
      set({ vehicle, progress, deviation });
      set({ derived: derive(get()) });

      if (
        deviation.status === 'off-route' &&
        !s.recalculating &&
        now - lastRecalcAt > config.navigation.minRecalculationIntervalS * 1000
      ) {
        void recalculateFrom(pos.coordinate, pos.headingDeg);
      }
      if (progress.remainingDistanceM < 40) {
        get().showNotice('success', `You've arrived at ${s.plan.timed.route.destination.name}`);
        get().stopNavigation();
      }
    },

    handleGeolocationError(message) {
      if (get().mode !== 'navigating') return;
      get().stopNavigation();
      get().showNotice('warning', `${message} — you can still plan or simulate the drive`);
    },

    resolveNavPrompt(choice) {
      const p = get().navPrompt;
      set({ navPrompt: null });
      if (!p) return;
      if (choice === 'route-from-here') {
        void recalculateFrom(p.coordinate, p.headingDeg);
      } else if (choice === 'simulate') {
        get().stopNavigation();
        get().startSimulation();
      } else {
        get().stopNavigation();
      }
    },

    stopNavigation() {
      tracker = null;
      set({
        mode: 'planning',
        vehicle: null,
        progress: null,
        navStartedMs: null,
        deviation: initialDeviationState,
        navPrompt: null,
        recalculating: false,
        sheet: 'default',
        clockMs: Date.now(),
        notice: get().notice?.persistent ? null : get().notice,
      });
      set({ derived: derive(get()) });
    },

    // ---------------- Demo simulation ----------------
    startSimulation() {
      const s = get();
      if (!s.plan) return;
      const startMs = departureMsOf({ ...s, clockMs: Date.now() });
      const first = advanceSimulation(s.plan.timed, { nowMs: startMs, modelTimeS: 0 }, startMs, 0, 1);
      set({
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
      });
      set({ derived: derive(get()) });
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
      const vehicle: VehicleState = { coordinate: step.coordinate, headingDeg: step.headingDeg, timestampMs: step.nowMs };
      const sim = { ...s.sim, nowMs: step.nowMs, modelTimeS: step.modelTimeS, arrived: step.arrived, playing: !step.arrived };
      // Vehicle + progress update every frame (cheap). The weather timeline
      // re-derives at most ~4×/s of real time, or every 30 s of simulated time.
      set({ vehicle, sim, progress: simProgress(s.plan.timed, step) });
      if (step.arrived || step.nowMs - lastDeriveSimMs >= 30_000 || performance.now() - lastDeriveAt > 250) {
        set({ derived: derive(get()) });
      }
      if (step.arrived) {
        get().showNotice('success', `Arrived at ${s.plan.timed.route.destination.name} (simulated)`);
      }
    },

    exitSimulation() {
      set({
        mode: 'planning',
        vehicle: null,
        progress: null,
        navStartedMs: null,
        sim: { ...get().sim, playing: false, arrived: false },
        sheet: 'default',
        clockMs: Date.now(),
        followVehicle: true,
      });
      set({ derived: derive(get()) });
    },
  })),
);

/** When settlement names arrive after the plan, name samples in place (same ids → same forecasts). */
function watchLatePlaces(plan: PlannedRoute) {
  if (!plan.latePlaces) return;
  void plan.latePlaces.then((places) => {
    const cur = useAppStore.getState().plan;
    if (!cur || cur.timed !== plan.timed) return;
    useAppStore.setState({ plan: applyLatePlaces(cur, places) });
    useAppStore.setState({ derived: derive(useAppStore.getState()) });
  });
}

/** Off-route (or far-from-route start): re-plan from the vehicle to the destination. */
async function recalculateFrom(coordinate: LngLat, headingDeg?: number): Promise<void> {
  const store = useAppStore;
  const s = store.getState();
  if (!s.plan) return;
  lastRecalcAt = Date.now();
  routeAbort?.abort();
  const ctrl = new AbortController();
  routeAbort = ctrl;
  store.setState({ recalculating: true });
  s.showNotice('info', 'Recalculating route…', true);
  const origin: Place = {
    id: `here:${coordinate.join(',')}`,
    name: 'Current location',
    label: 'Current location',
    coordinate,
  };
  try {
    const plan = await planRoute(getProviders(), origin, s.plan.timed.route.destination, {
      signal: ctrl.signal,
      startBearingDeg: headingDeg,
    });
    if (ctrl.signal.aborted) return;
    tracker = createProgressTracker(plan.timed);
    watchLatePlaces(plan);
    const now = Date.now();
    const progress = tracker(coordinate, now);
    store.setState({
      plan,
      navStartedMs: now,
      progress,
      deviation: initialDeviationState,
      recalculating: false,
      mode: 'navigating',
      navPrompt: null,
      followVehicle: true,
      selectedPointId: null,
    });
    store.setState({ derived: derive(store.getState()) });
    store.getState().showNotice('success', 'Route updated');
    await store.getState().loadWeather({ reason: 'recalculation' });
  } catch (e) {
    if (isAbortError(e)) return;
    store.setState({ recalculating: false });
    store.getState().showNotice('error', describeError(e, 'Unable to calculate route'));
  } finally {
    if (routeAbort === ctrl) routeAbort = null;
  }
}

/** Test helper: reset module-level runtime state. */
export function __resetStoreRuntime() {
  routeAbort?.abort();
  weatherAbort?.abort();
  routeAbort = null;
  weatherAbort = null;
  tracker = null;
  namingAttempted.clear();
  lastDeriveAt = 0;
  lastDeriveSimMs = 0;
  lastRecalcAt = 0;
}
