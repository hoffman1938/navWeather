import type { DeviationState } from '../types/navigation';

export interface DeviationConfig {
  /** Threshold bounds (m). The spec asks for ~30–100 m depending on road and GPS. */
  minThresholdM: number;
  maxThresholdM: number;
  /** Readings worse than this accuracy are ignored for decisions. */
  maxUsableAccuracyM: number;
  /** Off-route must persist for this many readings… */
  persistReadings: number;
  /** …and this long before we call it a real deviation. */
  persistSeconds: number;
}

export interface DeviationReading {
  distanceFromRouteM: number;
  accuracyM?: number;
  timestampMs: number;
  /** Expected speed of the matched road segment (m/s) — proxy for road type. */
  roadSpeedMps?: number;
}

export const initialDeviationState: DeviationState = {
  status: 'on-route',
  consecutiveOff: 0,
  offSinceMs: null,
  lastDistanceM: 0,
  lastThresholdM: 0,
};

/**
 * Off-route threshold: wider roads (motorways) tolerate more lateral
 * offset, and poor GPS accuracy widens the tolerance, within bounds.
 */
export function offRouteThreshold(reading: DeviationReading, cfg: DeviationConfig): number {
  const highway = (reading.roadSpeedMps ?? 0) >= 70 / 3.6;
  const base = highway ? 50 : 30;
  const accuracy = Math.max(0, reading.accuracyM ?? 20);
  return Math.max(cfg.minThresholdM, Math.min(cfg.maxThresholdM, base + accuracy * 0.75));
}

/**
 * Pure deviation state machine. Never reacts to a single bad fix: the
 * vehicle must be beyond the threshold for N consecutive usable readings
 * AND for a minimum duration. Hysteresis (70 % of the threshold) avoids
 * flapping at the boundary.
 */
export function updateDeviation(
  state: DeviationState,
  reading: DeviationReading,
  cfg: DeviationConfig,
): DeviationState {
  if ((reading.accuracyM ?? 0) > cfg.maxUsableAccuracyM) {
    // Unreliable fix: don't advance or reset the deviation evidence.
    return { ...state, status: state.status === 'off-route' ? 'off-route' : state.consecutiveOff > 0 ? 'uncertain' : state.status };
  }
  const threshold = offRouteThreshold(reading, cfg);
  const d = reading.distanceFromRouteM;

  if (d <= threshold * 0.7 || (d <= threshold && state.consecutiveOff === 0)) {
    return {
      status: 'on-route',
      consecutiveOff: 0,
      offSinceMs: null,
      lastDistanceM: d,
      lastThresholdM: threshold,
    };
  }
  if (d <= threshold) {
    // In the hysteresis band: hold current evidence.
    return { ...state, lastDistanceM: d, lastThresholdM: threshold };
  }
  const consecutiveOff = state.consecutiveOff + 1;
  const offSinceMs = state.offSinceMs ?? reading.timestampMs;
  const persisted =
    consecutiveOff >= cfg.persistReadings && reading.timestampMs - offSinceMs >= cfg.persistSeconds * 1000;
  return {
    status: persisted ? 'off-route' : 'uncertain',
    consecutiveOff,
    offSinceMs,
    lastDistanceM: d,
    lastThresholdM: threshold,
  };
}
