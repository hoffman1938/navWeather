import type { TripPlan, TripProgressState } from '../types';

/**
 * DYNAMIC REPLANNING (client side). The plan says when the car should be
 * where; the car says where it is now. A delay beyond REPLAN.delayThresholdS
 * makes the client ask the planner again from the car's position, with how
 * long it has been driving today and since its last break.
 *
 * Assumption (documented): stops the car has passed were taken as planned.
 */

/** Planned time (UTC ms) at an along-route position, interpolated within the plan's segments. */
export function plannedTimeAt(plan: TripPlan, alongM: number): number {
  const segs = plan.segments;
  if (!segs.length) return plan.departAtMs;
  if (alongM <= segs[0].fromM) return segs[0].departMs;
  for (const s of segs) {
    if (alongM <= s.toM) {
      const span = s.toM - s.fromM;
      const t = span > 0 ? (alongM - s.fromM) / span : 1;
      return s.departMs + (s.arriveMs - s.departMs) * Math.max(0, Math.min(1, t));
    }
  }
  return plan.arriveAtMs;
}

/** Seconds behind (+) or ahead of (−) the plan at this position and time. */
export function delaySeconds(plan: TripPlan, alongM: number, nowMs: number): number {
  return (nowMs - plannedTimeAt(plan, alongM)) / 1000;
}

/** Stop durations to add to every ETA between two positions (the client's timing uses driving time only). */
export function dwellBetween(plan: TripPlan | null, fromM: number, toM: number): number {
  if (!plan) return 0;
  let s = 0;
  for (const st of plan.recommendedStops) if (st.alongM > fromM + 1 && st.alongM < toM - 1) s += st.dwellMinutes * 60;
  return s;
}

/** The replanning state at the car: driving today and since the last break, assuming planned stops were taken. */
export function progressStateFor(plan: TripPlan, alongM: number, nowMs: number, driveTimeAt: (alongM: number) => number, rangeKm?: number): TripProgressState {
  const now = driveTimeAt(alongM);
  const passed = plan.recommendedStops.filter((s) => s.alongM <= alongM);
  const lastNight = [...passed].reverse().find((s) => s.kinds.includes('overnight'));
  const lastBreak = [...passed].reverse().find((s) => s.kinds.some((k) => k === 'overnight' || k === 'rest' || k === 'meal' || k === 'charge'));
  const origin = plan.progress;
  const fromOrigin = (offset: number) => (origin ? offset + (now - driveTimeAt(origin.alongM)) : now - driveTimeAt(0));
  return {
    alongM,
    nowMs,
    drivenTodayS: Math.max(0, Math.round(lastNight ? now - lastNight.driveTimeS : fromOrigin(origin?.drivenTodayS ?? 0))),
    sinceRestS: Math.max(0, Math.round(lastBreak ? now - lastBreak.driveTimeS : fromOrigin(origin?.sinceRestS ?? 0))),
    ...(rangeKm !== undefined ? { rangeKm } : {}),
  };
}
