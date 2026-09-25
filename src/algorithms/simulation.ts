import type { LngLat } from '../types/geo';
import type { RouteProgress } from '../types/navigation';
import type { TimedRoute } from '../types/route';
import { bearingDeg } from '../utils/distance';
import { distanceAtTime, positionAtDistance } from './routeTiming';

export interface SimState {
  /** Simulated wall clock (UTC ms). */
  nowMs: number;
  /** Route model time reached by the vehicle (s from start). */
  modelTimeS: number;
}

/**
 * Gentle, deterministic speed variation (±10 %, slightly slower on average)
 * so the demo shows ETAs drifting like a real drive does.
 */
export function simulationSpeedFactor(elapsedS: number): number {
  return 0.97 + 0.1 * Math.sin((2 * Math.PI * elapsedS) / 1800);
}

export interface SimStep extends SimState {
  distanceM: number;
  coordinate: LngLat;
  headingDeg: number;
  arrived: boolean;
}

/** Advance the simulated vehicle by `realDtMs` of real time at `speed`×. */
export function advanceSimulation(
  timed: TimedRoute,
  state: SimState,
  startMs: number,
  realDtMs: number,
  speed: number,
): SimStep {
  const simDtS = (Math.max(0, realDtMs) * speed) / 1000;
  const nowMs = state.nowMs + simDtS * 1000;
  const factor = simulationSpeedFactor((nowMs - startMs) / 1000);
  const modelTimeS = Math.min(timed.totalTimeS, state.modelTimeS + simDtS * factor);
  const distanceM = distanceAtTime(timed, modelTimeS);
  const { coordinate, index } = positionAtDistance(timed, distanceM);
  const g = timed.route.geometry;
  const a = g[Math.min(index, g.length - 2)];
  const b = g[Math.min(index + 1, g.length - 1)];
  return {
    nowMs,
    modelTimeS,
    distanceM,
    coordinate,
    headingDeg: bearingDeg(a, b),
    arrived: modelTimeS >= timed.totalTimeS,
  };
}

export function simProgress(timed: TimedRoute, step: SimStep): RouteProgress {
  const remainingTimeS = Math.max(0, timed.totalTimeS - step.modelTimeS);
  return {
    distanceAlongM: step.distanceM,
    modelTimeS: step.modelTimeS,
    distanceFromRouteM: 0,
    segmentIndex: 0,
    remainingDistanceM: Math.max(0, timed.totalDistM - step.distanceM),
    remainingTimeS,
    nowMs: step.nowMs,
    etaMs: step.nowMs + remainingTimeS * 1000,
  };
}
