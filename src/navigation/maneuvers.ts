import type { LngLat } from '../types/geo';
import type { Lane, TimedRoute } from '../types/route';
import { lowerIndex } from '../utils/distance';

export type ManeuverKind =
  | 'depart'
  | 'arrive'
  | 'turn'
  | 'continue'
  | 'new-name'
  | 'merge'
  | 'on-ramp'
  | 'off-ramp'
  | 'fork'
  | 'end-of-road'
  | 'roundabout'
  | 'rotary'
  | 'roundabout-turn'
  | 'exit-roundabout'
  | 'exit-rotary'
  | 'use-lane'
  | 'notification';

/** A maneuver normalized from the route model (provider-independent). */
export interface Maneuver {
  id: string;
  index: number;
  kind: ManeuverKind;
  /** 'left' | 'slight right' | 'straight' | 'uturn' … */
  modifier?: string;
  exit?: number;
  /** Road you will be on after the maneuver (name, ref or both). */
  roadName?: string;
  roadRef?: string;
  destinations?: string;
  lanes?: Lane[];
  location: LngLat;
  /** Along-route distance of the maneuver point (m). */
  distanceAlongM: number;
  /** Distance from the previous maneuver (length of the approach). */
  approachM: number;
  legIndex: number;
  /** Arrival at the final destination (vs an intermediate stop). */
  final: boolean;
  /** Worth announcing / showing in the banner. */
  announce: boolean;
}

const KIND: Record<string, ManeuverKind> = {
  depart: 'depart',
  arrive: 'arrive',
  turn: 'turn',
  continue: 'continue',
  'new name': 'new-name',
  merge: 'merge',
  'on ramp': 'on-ramp',
  'off ramp': 'off-ramp',
  fork: 'fork',
  'end of road': 'end-of-road',
  roundabout: 'roundabout',
  rotary: 'rotary',
  'roundabout turn': 'roundabout-turn',
  'exit roundabout': 'exit-roundabout',
  'exit rotary': 'exit-rotary',
  'use lane': 'use-lane',
  notification: 'notification',
};

function shouldAnnounce(kind: ManeuverKind, modifier?: string): boolean {
  switch (kind) {
    case 'new-name':
    case 'exit-roundabout':
    case 'exit-rotary':
    case 'notification':
    case 'depart':
      return false;
    case 'continue':
    case 'merge':
      return !!modifier && modifier !== 'straight';
    default:
      return true;
  }
}

/** Build the maneuver list for a timed route from its steps. */
export function buildManeuvers(timed: TimedRoute): Maneuver[] {
  const out: Maneuver[] = [];
  const legs = timed.route.legs;
  // Fallback alignment by OSRM distances when step geometry indices are missing.
  let osrmCum = 0;
  const scale = timed.route.distanceM > 0 ? timed.totalDistM / timed.route.distanceM : 1;
  legs.forEach((leg, legIndex) => {
    leg.steps.forEach((s) => {
      const kind = KIND[s.maneuverType] ?? 'turn';
      const along =
        s.fromIndex !== undefined ? timed.cumDistM[Math.min(s.fromIndex, timed.cumDistM.length - 1)] : osrmCum * scale;
      osrmCum += s.distanceM;
      const prev = out[out.length - 1];
      out.push({
        id: `${timed.route.id}:m${out.length}`,
        index: out.length,
        kind,
        modifier: s.maneuverModifier,
        exit: s.exit,
        roadName: s.name || undefined,
        roadRef: s.ref,
        destinations: s.destinations,
        lanes: s.lanes,
        location: s.location,
        distanceAlongM: along,
        approachM: prev ? along - prev.distanceAlongM : along,
        legIndex,
        final: kind === 'arrive' && legIndex === legs.length - 1,
        announce: shouldAnnounce(kind, s.maneuverModifier),
      });
    });
  });
  // Roundabouts: the road you leave onto is the name of the following exit step.
  for (let i = 0; i < out.length - 1; i++) {
    const m = out[i];
    const n = out[i + 1];
    if ((m.kind === 'roundabout' || m.kind === 'rotary') && (n.kind === 'exit-roundabout' || n.kind === 'exit-rotary')) {
      m.roadName = n.roadName ?? m.roadName;
      m.roadRef = n.roadRef ?? m.roadRef;
    }
  }
  return out;
}

export interface Guidance {
  /** Next maneuver worth announcing (null when only arrival remains beyond). */
  next: Maneuver | null;
  distanceToNextM: number;
  timeToNextS: number;
  /** A second maneuver that follows the next one closely ("then turn left"). */
  then: Maneuver | null;
  /** Road the vehicle is currently on (from the last passed maneuver). */
  currentRoadName?: string;
  currentRoadRef?: string;
}

/** Where are we relative to the maneuvers? Cheap: binary search + short scan. */
export function computeGuidance(maneuvers: Maneuver[], timed: TimedRoute, distanceAlongM: number): Guidance {
  const along = maneuvers.map((m) => m.distanceAlongM);
  let i = lowerIndex(along, distanceAlongM + 5);
  if (maneuvers[i] && maneuvers[i].distanceAlongM <= distanceAlongM + 5) i++;
  let current: Maneuver | undefined;
  for (let k = i - 1; k >= 0; k--) {
    if (maneuvers[k].kind !== 'exit-roundabout' && maneuvers[k].kind !== 'exit-rotary') {
      current = maneuvers[k];
      break;
    }
  }
  let next: Maneuver | null = null;
  for (let k = i; k < maneuvers.length; k++) {
    if (maneuvers[k].announce) {
      next = maneuvers[k];
      break;
    }
  }
  let then: Maneuver | null = null;
  if (next) {
    for (let k = next.index + 1; k < maneuvers.length; k++) {
      const c = maneuvers[k];
      if (c.distanceAlongM - next.distanceAlongM > 300) break;
      if (c.announce) {
        then = c;
        break;
      }
    }
  }
  const distanceToNextM = next ? Math.max(0, next.distanceAlongM - distanceAlongM) : 0;
  const tNow = timeAt(timed, distanceAlongM);
  const timeToNextS = next ? Math.max(0, timeAt(timed, next.distanceAlongM) - tNow) : 0;
  return {
    next,
    distanceToNextM,
    timeToNextS,
    then,
    currentRoadName: current?.roadName,
    currentRoadRef: current?.roadRef,
  };
}

function timeAt(timed: TimedRoute, d: number): number {
  const { cumDistM, cumTimeS } = timed;
  const i = lowerIndex(cumDistM, d);
  if (i >= cumDistM.length - 1) return cumTimeS[cumTimeS.length - 1];
  const span = cumDistM[i + 1] - cumDistM[i];
  const t = span > 0 ? (d - cumDistM[i]) / span : 0;
  return cumTimeS[i] + (cumTimeS[i + 1] - cumTimeS[i]) * t;
}
