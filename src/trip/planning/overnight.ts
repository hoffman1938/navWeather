import { STOP_DEFAULTS } from '../config';
import { timeAtAlong, type RouteProfile } from '../route/profile';
import type { TripPlaceRef } from '../types';
import type { ScheduledStop } from './schedule';

/**
 * OVERNIGHT AREA — not the geographic midpoint and not just "where the daily
 * driving runs out": towns and cities within a window around that point
 * (up to 1.5 h of driving earlier, 20 min later), scored by size (where
 * accommodation and services are likely) and by how much driving they move
 * to the next day. The planner then checks accommodation around the best few
 * and prefers an area that has some.
 */

export interface OvernightCandidate {
  alongM: number;
  name?: string;
  kind?: TripPlaceRef['kind'];
  score: number;
}

export function overnightCandidates(
  profile: RouteProfile,
  target: ScheduledStop,
  places: TripPlaceRef[] | undefined,
  afterAlongM: number,
  limit = 3,
): OvernightCandidate[] {
  const Tt = target.driveTimeS;
  const Tmin = Math.max(timeAtAlong(profile, afterAlongM) + 3600, Tt - STOP_DEFAULTS.overnightSearchBeforeS);
  const Tmax = Math.min(profile.totalTimeS - 1800, Tt + STOP_DEFAULTS.overnightSearchAfterS);
  const out: OvernightCandidate[] = [];
  for (const p of places ?? []) {
    if (p.alongM <= afterAlongM) continue;
    const T = timeAtAlong(profile, p.alongM);
    if (T < Tmin || T > Tmax) continue;
    const size = p.kind === 'city' ? 3 : p.kind === 'town' ? 2 : 0.5;
    const pop = p.population && p.population > 0 ? Math.min(2, Math.log10(p.population) / 3) : 0;
    const earlierH = Math.max(0, Tt - T) / 3600;
    const laterH = Math.max(0, T - Tt) / 3600;
    out.push({ alongM: p.alongM, name: p.name, kind: p.kind, score: size + pop - earlierH * 0.8 - laterH * 1.5 });
  }
  out.sort((a, b) => b.score - a.score);
  const picked = out.slice(0, limit);
  // The plain target is always an option (no settlement known there, so it scores low).
  picked.push({ alongM: target.alongM, score: -0.5 });
  return picked;
}
