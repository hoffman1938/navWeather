import type { DistanceUnits } from '../i18n/format';
import { spokenDistance } from '../i18n/format';
import type { Messages } from '../i18n/en';
import type { Maneuver } from './maneuvers';

const GEORGIAN = /[Ⴀ-ჿ]/;
const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * Road label for display: a short name, a ref, or "Name (S1)". Long official
 * names ("Tbilisi — Senaki — Leselidze") collapse to their ref.
 */
export function roadLabel(name?: string, ref?: string): string | undefined {
  const r = ref?.replace(/\s+/g, ' ').trim();
  const n = name?.trim();
  if (!n) return r || undefined;
  if (!r) return n;
  if (n.length > 24 || n.includes(' — ')) return r;
  return `${n} (${r})`;
}

/**
 * Road for speech: skip names in a script the voice can't pronounce
 * (e.g. Georgian names in an English voice) and prefer the ref instead.
 */
export function spokenRoad(name: string | undefined, ref: string | undefined, m: Messages): string | undefined {
  const readable = (s?: string) => {
    if (!s) return false;
    if (m.locale === 'ru') return !GEORGIAN.test(s);
    return !GEORGIAN.test(s) && !CYRILLIC.test(s);
  };
  if (name && readable(name) && name.length <= 32 && !name.includes(' — ')) return name;
  if (ref && readable(ref)) return ref.replace(/\s+/g, ' ');
  return undefined;
}

function side(modifier?: string): 'left' | 'right' | undefined {
  if (!modifier) return undefined;
  if (modifier.includes('left')) return 'left';
  if (modifier.includes('right')) return 'right';
  return undefined;
}

/**
 * Instruction text generated from the maneuver model — never hard-coded per
 * route. `voice` selects pronounceable road names.
 */
export function instructionText(mv: Maneuver, m: Messages, voice = false): string {
  const road = voice ? spokenRoad(mv.roadName, mv.roadRef, m) : roadLabel(mv.roadName, mv.roadRef);
  const toward = mv.destinations ? (voice ? spokenRoad(mv.destinations.split(',')[0], undefined, m) : mv.destinations.split(',')[0]) : undefined;
  const mod = mv.modifier ?? 'straight';
  const t = m.maneuver;
  switch (mv.kind) {
    case 'depart':
      return t.depart(road);
    case 'arrive':
      return mv.final ? t.arrive(side(mv.modifier)) : t.arriveStop();
    case 'turn':
      return t.turn(mod, road);
    case 'end-of-road':
      return t.endOfRoad(mod, road);
    case 'continue':
      return mod === 'straight' ? t.continue(road) : t.keep(mod, road);
    case 'new-name':
      return road ? t.newName(road) : t.continue();
    case 'merge':
      return t.merge(mod === 'straight' ? undefined : mod, road);
    case 'on-ramp':
      return t.onRamp(mod, road);
    case 'off-ramp':
      return t.offRamp(mod, toward);
    case 'fork':
      return t.fork(mod, toward);
    case 'roundabout':
    case 'rotary':
      return t.roundabout(mv.exit, road);
    case 'roundabout-turn':
      return t.roundaboutTurn(mod);
    case 'exit-roundabout':
    case 'exit-rotary':
      return t.exitRoundabout(road);
    case 'use-lane':
      return t.keep(mod, road);
    default:
      return t.continue(road);
  }
}

export type AnnouncementStage = 'early' | 'prepare' | 'final';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Speed-adaptive announcement windows (distance-to-maneuver thresholds):
 * early ≈ 75 s ahead, prepare ≈ 18 s, final ≈ 5 s — with sensible bounds.
 * The early prompt is skipped when the approach is short (it would overlap).
 */
export function announcementStage(distanceM: number, speedMps: number, approachM: number): AnnouncementStage | null {
  const v = Math.max(5, speedMps || 0);
  const final = clamp(v * 5, 25, 120);
  const prepare = clamp(v * 18, 150, 600);
  const early = clamp(v * 75, 700, 2500);
  if (distanceM <= final) return 'final';
  if (distanceM <= prepare) return 'prepare';
  if (distanceM <= early && approachM > early * 1.2) return 'early';
  return null;
}

/** Spoken prompt for a maneuver at a stage (with "then …" chaining when close). */
export function spokenPrompt(
  mv: Maneuver,
  stage: AnnouncementStage,
  distanceM: number,
  m: Messages,
  units: DistanceUnits,
  then?: Maneuver | null,
): string {
  const instr = instructionText(mv, m, true);
  let text = stage === 'final' ? m.voice.now(instr) : m.voice.inDistance(spokenDistance(distanceM, units, m), instr);
  if (then && stage !== 'early') text = `${m.voice.then(text, instructionText(then, m, true))}.`;
  return text;
}

const ORDER: Record<AnnouncementStage, number> = { early: 0, prepare: 1, final: 2 };

/**
 * Decide whether a maneuver prompt is due now. Each stage is spoken at most
 * once per maneuver; jumping straight to a later stage marks earlier ones as
 * done (no stale "in 2 km" after we're already 100 m away).
 */
export function dueManeuverPrompt(
  mv: Maneuver,
  distanceM: number,
  speedMps: number,
  spoken: Set<string>,
): AnnouncementStage | null {
  const stage = announcementStage(distanceM, speedMps, mv.approachM);
  if (!stage) return null;
  if (spoken.has(`${mv.id}:${stage}`)) return null;
  // Later stage already spoken? Then nothing earlier is due.
  for (const s of Object.keys(ORDER) as AnnouncementStage[]) {
    if (ORDER[s] > ORDER[stage] && spoken.has(`${mv.id}:${s}`)) return null;
  }
  return stage;
}

export function markSpoken(mv: Maneuver, stage: AnnouncementStage, spoken: Set<string>): void {
  for (const s of Object.keys(ORDER) as AnnouncementStage[]) {
    if (ORDER[s] <= ORDER[stage]) spoken.add(`${mv.id}:${s}`);
  }
}

/** Navigation camera zoom: zoom out on open road, zoom in approaching maneuvers. */
export function navigationZoom(distanceToManeuverM: number | null, speedMps: number): number {
  const v = speedMps || 0;
  // Close enough to read the road you are on: a street-level view even at highway speed.
  const cruise = v >= 25 ? 14.75 : v >= 15 ? 15.75 : 16.5;
  if (distanceToManeuverM === null || distanceToManeuverM > 900) return cruise;
  const near = 17.25;
  const t = Math.max(0, Math.min(1, (900 - distanceToManeuverM) / 750));
  const z = cruise + (near - cruise) * t;
  return Math.round(z * 4) / 4; // quantize → no jitter
}
