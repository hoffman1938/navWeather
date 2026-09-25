import type { Messages } from '../i18n/en';
import { spokenDuration } from '../i18n/format';
import { SEVERITY_RANK, type RouteEvent, type Severity } from './types';

/**
 * DRIVER ALERT ENGINE
 *
 * Decides WHEN a route event deserves the driver's attention — and when it
 * must stay quiet. It reasons primarily in time-to-event (distance is only
 * context), with adaptive windows per severity:
 *
 *   severity  first notice        second notice (only if the first was early)
 *   medium    ≤ ~40 min ahead     — (one clear notice is enough)
 *   high      ≤ ~55 min ahead     ≤ ~18 min, if first came ≥ 30 min before
 *   critical  as soon as confident ≤ ~15 min
 *   low       never interrupts (shown only in the "Ahead" list)
 *
 * Anti-fatigue: confidence gating; a cooldown between alerts; events close
 * together are spoken as one sentence; recurring hazards are summarised
 * ("Rain is expected on and off over the next 2 hours"); the same hazard
 * type is not repeated within 45 min unless it gets worse; at most 4
 * non-critical voice alerts per hour. Per-event state means the same event
 * is never announced twice, and it carries over when a forecast refresh
 * moves the event slightly (same type within 20 km = same event).
 */

export type AlertOutput = 'both' | 'visual' | 'voice' | 'off';
export type AlertTiming = 'auto' | 'early' | 'standard' | 'minimal';

export interface DriverAlertPrefs {
  output: AlertOutput;
  timing: AlertTiming;
}

export interface EventAlertState {
  type: string;
  distanceAlongM: number;
  firstAt?: number;
  /** Minutes before the event when the first notice was given. */
  firstLeadMin?: number;
  secondAt?: number;
  acknowledged: boolean;
  /** Last time the event was seen (for pruning). */
  seenAt: number;
}

export interface DriverAlertState {
  events: Record<string, EventAlertState>;
  lastVoiceAt: number;
  /** Last announcement per hazard type (for recurrence suppression). */
  lastByType: Record<string, { at: number; rank: number }>;
  /** Times of recent voice alerts (rate cap). */
  recent: number[];
}

export const initialDriverAlertState: DriverAlertState = { events: {}, lastVoiceAt: -Infinity, lastByType: {}, recent: [] };

export interface VoiceAlert {
  id: string;
  text: string;
  /** Voice queue priority: 2 critical hazard … 6 minor (1 is reserved for maneuvers). */
  priority: number;
  expiresAt: number;
}

export interface VisualAlert {
  id: string;
  eventIds: string[];
  severity: Severity;
  title: string;
  message: string;
  minutes: number;
  icon: RouteEvent['icon'];
  shownAt: number;
}

export interface AlertDecision {
  state: DriverAlertState;
  voice: VoiceAlert[];
  visual: VisualAlert | null;
}

interface Window {
  first: number;
  second: number | null;
  secondMinLead: number;
}

const BASE: Record<Exclude<Severity, 'low'>, Window> = {
  medium: { first: 40, second: null, secondMinLead: Infinity },
  high: { first: 55, second: 18, secondMinLead: 30 },
  critical: { first: 120, second: 15, secondMinLead: 25 },
};

export function alertWindow(severity: Severity, timing: AlertTiming): Window | null {
  if (severity === 'low') return null;
  const w = BASE[severity];
  switch (timing) {
    case 'early':
      return { first: w.first * 1.35, second: w.second === null ? null : w.second * 1.3, secondMinLead: w.secondMinLead };
    case 'minimal':
      if (severity === 'medium') return null;
      if (severity === 'high') return { first: 30, second: null, secondMinLead: Infinity };
      return { first: 60, second: 10, secondMinLead: 20 };
    default:
      return w;
  }
}

const VOICE_PRIORITY: Record<Severity, number> = { critical: 2, high: 4, medium: 5, low: 6 };
const VOICE_COOLDOWN_MS = 3 * 60000;
const GROUP_WINDOW_MIN = 15;
const RECUR_WINDOW_MIN = 120;
const SAME_TYPE_QUIET_MS = 45 * 60000;
const MAX_PER_HOUR = 4;

/** Too close to bother (unless severe): announcing rain 1 minute out adds nothing. */
const MIN_LEAD_MIN: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: Infinity };

function carryOver(events: RouteEvent[], prev: DriverAlertState, now: number): Record<string, EventAlertState> {
  const next: Record<string, EventAlertState> = {};
  const unused = new Map(Object.entries(prev.events));
  for (const e of events) {
    const exact = unused.get(e.id);
    if (exact) {
      next[e.id] = { ...exact, distanceAlongM: e.distanceAlongM, seenAt: now };
      unused.delete(e.id);
    }
  }
  // Same type within 20 km → the same real-world event (moved by a refresh or ETA drift).
  for (const e of events) {
    if (next[e.id]) continue;
    let best: [string, EventAlertState] | undefined;
    for (const entry of unused) {
      const [, s] = entry;
      if (s.type !== e.type) continue;
      const d = Math.abs(s.distanceAlongM - e.distanceAlongM);
      if (d <= 20_000 && (!best || d < Math.abs(best[1].distanceAlongM - e.distanceAlongM))) best = entry;
    }
    if (best) {
      next[e.id] = { ...best[1], distanceAlongM: e.distanceAlongM, seenAt: now };
      unused.delete(best[0]);
    } else {
      next[e.id] = { type: e.type, distanceAlongM: e.distanceAlongM, acknowledged: false, seenAt: now };
    }
  }
  // Keep recently seen but vanished events for 30 min so a flip-flopping
  // forecast can't make them "new" again.
  for (const [id, s] of unused) {
    if (now - s.seenAt < 30 * 60000 && (s.firstAt !== undefined || s.acknowledged)) next[`~${id}`] = s;
  }
  return next;
}

export function evaluateDriverAlerts(
  events: RouteEvent[],
  prev: DriverAlertState,
  ctx: { nowMs: number; prefs: DriverAlertPrefs; m: Messages },
): AlertDecision {
  const { nowMs, prefs, m } = ctx;
  const states = carryOver(events, prev, nowMs);
  const state: DriverAlertState = {
    events: states,
    lastVoiceAt: prev.lastVoiceAt,
    lastByType: { ...prev.lastByType },
    recent: prev.recent.filter((t) => nowMs - t < 60 * 60000),
  };
  if (prefs.output === 'off') return { state, voice: [], visual: null };

  // What is due right now?
  const due: { e: RouteEvent; stage: 'first' | 'second' }[] = [];
  for (const e of events) {
    if (e.distanceFromCurrentM < 0 || e.expiresAt < nowMs) continue;
    const s = states[e.id];
    if (!s || s.acknowledged) continue;
    const w = alertWindow(e.severity, prefs.timing);
    if (!w) continue;
    const minutes = e.estimatedMinutesFromCurrent;
    if (minutes < MIN_LEAD_MIN[e.severity]) continue;
    if (e.severity === 'critical' && e.confidence < 0.5) continue;
    if (s.firstAt === undefined) {
      if (minutes <= w.first) due.push({ e, stage: 'first' });
    } else if (
      s.secondAt === undefined &&
      w.second !== null &&
      minutes <= w.second &&
      (s.firstLeadMin ?? 0) >= w.secondMinLead &&
      nowMs - s.firstAt >= 8 * 60000
    ) {
      due.push({ e, stage: 'second' });
    }
  }
  if (due.length === 0) return { state, voice: [], visual: null };

  // Most important first.
  due.sort(
    (a, b) =>
      SEVERITY_RANK[b.e.severity] - SEVERITY_RANK[a.e.severity] ||
      a.e.estimatedMinutesFromCurrent - b.e.estimatedMinutesFromCurrent,
  );
  const lead = due[0];
  const leadRank = SEVERITY_RANK[lead.e.severity];

  // Same hazard type announced recently and not worse → note it silently.
  const lastOfType = state.lastByType[lead.e.type];
  if (lead.stage === 'first' && lastOfType && nowMs - lastOfType.at < SAME_TYPE_QUIET_MS && leadRank <= lastOfType.rank) {
    const s = states[lead.e.id];
    s.firstAt = nowMs;
    s.firstLeadMin = lead.e.estimatedMinutesFromCurrent;
    s.secondAt = nowMs;
    return { state, voice: [], visual: null };
  }

  // Cooldown between alerts (critical always gets through). While cooling
  // down, wait — unless the event is too close to wait for, in which case it
  // is shown visually without speaking over the previous alert.
  const wantsVoice = prefs.output === 'both' || prefs.output === 'voice';
  const onCooldown = nowMs - state.lastVoiceAt < VOICE_COOLDOWN_MS && lead.e.severity !== 'critical';
  if (onCooldown && (lead.e.estimatedMinutesFromCurrent > 5 || prefs.output === 'voice')) {
    return { state, voice: [], visual: null };
  }
  const rateLimited = state.recent.length >= MAX_PER_HOUR && lead.e.severity !== 'critical';

  // Group: other not-yet-announced, non-minor events within ~15 min of the lead
  // are folded into the same sentence (even if not individually due yet).
  const group = [
    lead,
    ...events
      .filter(
        (e) =>
          e.id !== lead.e.id &&
          e.severity !== 'low' &&
          states[e.id] &&
          states[e.id].firstAt === undefined &&
          !states[e.id].acknowledged &&
          e.distanceFromCurrentM >= 0 &&
          Math.abs(e.estimatedMinutesFromCurrent - lead.e.estimatedMinutesFromCurrent) <= GROUP_WINDOW_MIN,
      )
      .map((e) => ({ e, stage: 'first' as const })),
  ];

  // Recurring hazard: more stretches of the same type soon after → summarise once.
  const recurring =
    lead.stage === 'first'
      ? events.filter(
          (e) =>
            e.type === lead.e.type &&
            e.id !== lead.e.id &&
            states[e.id]?.firstAt === undefined &&
            e.estimatedMinutesFromCurrent > lead.e.estimatedMinutesFromCurrent &&
            e.estimatedMinutesFromCurrent - lead.e.estimatedMinutesFromCurrent <= RECUR_WINDOW_MIN,
        )
      : [];

  const titles = [...new Set(group.map((g) => g.e.title))];
  const minutes = Math.min(...group.map((g) => g.e.estimatedMinutesFromCurrent));
  let text: string;
  if (recurring.length && group.length === 1) {
    const last = recurring[recurring.length - 1];
    const spanMin = Math.max(60, Math.round((last.estimatedMinutesFromCurrent + 30) / 30) * 30);
    text = m.alert.voice.recurring(lead.e.title, spokenDuration(spanMin * 60, m, false));
  } else {
    text = group.length === 1 ? lead.e.voiceMessage : m.alert.voice.combined(titles, spokenDuration(minutes * 60, m));
  }
  const id = `alert:${group.map((g) => `${g.e.id}/${g.stage}`).join('+')}`;

  for (const g of [...group, ...recurring.map((e) => ({ e, stage: 'first' as const }))]) {
    const s = states[g.e.id];
    if (!s) continue;
    if (g.stage === 'first') {
      s.firstAt = nowMs;
      s.firstLeadMin = g.e.estimatedMinutesFromCurrent;
      // Summarised recurrences don't get their own second notice.
      if (g.e !== lead.e && recurring.includes(g.e)) s.secondAt = nowMs;
    } else {
      s.secondAt = nowMs;
    }
    state.lastByType[g.e.type] = { at: nowMs, rank: Math.max(SEVERITY_RANK[g.e.severity], state.lastByType[g.e.type]?.rank ?? -1) };
  }

  const voice: VoiceAlert[] = [];
  if (wantsVoice && !onCooldown && !rateLimited) {
    voice.push({ id, text, priority: VOICE_PRIORITY[lead.e.severity], expiresAt: nowMs + 2 * 60000 });
    state.recent.push(nowMs);
  }
  state.lastVoiceAt = nowMs;
  const visual: VisualAlert | null =
    prefs.output === 'both' || prefs.output === 'visual'
      ? {
          id,
          eventIds: group.map((g) => g.e.id),
          severity: lead.e.severity,
          title: titles.join(' · '),
          message: lead.e.shortMessage,
          minutes,
          icon: lead.e.icon,
          shownAt: nowMs,
        }
      : null;
  return { state, voice, visual };
}

/** Driver dismissed the banner → never repeat that event. */
export function acknowledge(state: DriverAlertState, eventIds: string[]): DriverAlertState {
  const events = { ...state.events };
  for (const id of eventIds) if (events[id]) events[id] = { ...events[id], acknowledged: true };
  return { ...state, events };
}
