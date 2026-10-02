import type { Route, RouteSample } from '../types/route';
import type { PlannedRoute } from '../services/routePlanner';
import { timeAtDistance } from './routeTiming';

/** What the road summaries need of a road: its forecast samples, size and steps. */
export interface OptionRoad {
  samples: RouteSample[];
  totalDistM: number;
  totalTimeS: number;
  route: Route;
}

/** A planned road, whole (for comparing roads before the trip starts). */
export function wholeRoad(plan: PlannedRoute): OptionRoad {
  return { samples: plan.samples, totalDistM: plan.timed.totalDistM, totalTimeS: plan.timed.totalTimeS, route: plan.timed.route };
}

/**
 * The part of a road still ahead of the car, re-based so it starts at the car
 * (distance and time 0 there). Lets roads that began far behind — the ones
 * planned at the trip's start — be compared with the one being driven.
 */
export function roadAhead(plan: PlannedRoute, alongM: number): OptionRoad {
  const t = plan.timed;
  const tAlong = timeAtDistance(t, alongM);
  return {
    samples: plan.samples
      .filter((s) => s.distanceM >= alongM)
      .map((s) => ({ ...s, distanceM: s.distanceM - alongM, travelTimeS: Math.max(0, s.travelTimeS - tAlong) })),
    totalDistM: Math.max(0, t.totalDistM - alongM),
    totalTimeS: Math.max(0, t.totalTimeS - tAlong),
    route: t.route,
  };
}
