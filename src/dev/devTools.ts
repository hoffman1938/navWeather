import { positionAtDistance, timeAtDistance } from '../algorithms/routeTiming';
import { snapIncidentsToRoute } from '../algorithms/incidents';
import { getProviders } from '../services/providers';
import { forecastLookupFn } from '../services/routePlanner';
import { __devRerouteFrom, useAppStore } from '../state/store';
import type { LngLat } from '../types/geo';
import type { LocationForecast } from '../types/weather';

/**
 * DEVELOPMENT-ONLY simulation controls (the panel that uses them is not in
 * production builds). Anything injected here is flagged `simulatedData`, and
 * the UI labels it as simulated.
 */

export function skipMinutes(min: number) {
  useAppStore.getState().simulationSkip(min * 60);
}

export function skipKm(km: number) {
  const s = useAppStore.getState();
  if (!s.plan || !s.progress) return;
  const timed = s.plan.timed;
  const target = Math.min(timed.totalDistM, s.progress.distanceAlongM + km * 1000);
  s.simulationSkip(Math.max(0, timeAtDistance(timed, target) - s.progress.modelTimeS));
}

/** Jump to ~2 min before the next event ahead. */
export function skipToNextEvent() {
  const s = useAppStore.getState();
  const next = s.derived.intelligence.events.find((e) => e.type !== 'DESTINATION' && e.estimatedMinutesFromCurrent > 3);
  if (next) skipMinutes(next.estimatedMinutesFromCurrent - 2);
}

/** Leave the route: re-plan from a point ~400 m to the side of the vehicle. */
export function simulateDeviation() {
  const s = useAppStore.getState();
  const v = s.vehicle;
  if (!v) return;
  const h = (((v.headingDeg ?? 0) + 90) * Math.PI) / 180;
  const [lon, lat] = v.coordinate;
  const off: LngLat = [lon + (400 * Math.sin(h)) / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + (400 * Math.cos(h)) / 111_320];
  void __devRerouteFrom(off, v.headingDeg);
}

/** Heavy rain 20–80 km ahead for the next few hours (labelled simulated). */
export function simulateWeatherChange() {
  const s = useAppStore.getState();
  if (!s.plan) return;
  const from = (s.progress?.distanceAlongM ?? 0) + 20_000;
  const to = from + 60_000;
  const lookup = forecastLookupFn(getProviders(), s.forecasts);
  const now = s.mode === 'simulating' ? s.sim.nowMs : Date.now();
  const next = new Map(s.forecasts);
  for (const smp of s.plan.samples) {
    if (smp.distanceM < from || smp.distanceM > to) continue;
    const f = lookup(smp);
    if (f) next.set(f.locationKey, withHeavyRain(f, now - 3_600_000, now + 6 * 3_600_000));
  }
  useAppStore.setState({ forecasts: next, simulatedData: true });
  useAppStore.getState().rederive();
}

function withHeavyRain(f: LocationForecast, fromMs: number, toMs: number): LocationForecast {
  const h = { ...f.hourly };
  const inRange = f.times.map((t) => t >= fromMs && t <= toMs);
  const put = <T,>(arr: T[], v: T) => arr.map((x, i) => (inRange[i] ? v : x));
  h.condition = put(h.condition, 'HEAVY_RAIN');
  h.description = put(h.description, 'Heavy rain (simulated)');
  h.precipitation = put(h.precipitation, 7);
  h.rain = put(h.rain, 7);
  h.precipitationProbability = put(h.precipitationProbability, 90);
  h.visibility = put(h.visibility, 3000);
  return { ...f, hourly: h };
}

/** An unconfirmed accident report ~25 km ahead (labelled simulated). */
export function simulateIncident() {
  const s = useAppStore.getState();
  if (!s.plan) return;
  const d = Math.min(s.plan.timed.totalDistM - 1000, (s.progress?.distanceAlongM ?? 0) + 25_000);
  const coordinate = positionAtDistance(s.plan.timed, d).coordinate;
  const now = s.mode === 'simulating' ? s.sim.nowMs : Date.now();
  const [inc] = snapIncidentsToRoute(
    [{ id: `sim-${now}`, kind: 'accident', severity: 'high', verified: false, source: 'Simulation', reportedAt: now, expiresAt: now + 2 * 3_600_000, coordinate }],
    s.plan.timed,
  );
  if (!inc) return;
  useAppStore.setState({ incidents: [...s.incidents, inc], simulatedData: true });
  useAppStore.getState().rederive();
}
