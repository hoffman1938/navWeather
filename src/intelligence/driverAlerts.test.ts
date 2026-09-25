import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { acknowledge, evaluateDriverAlerts, initialDriverAlertState, type DriverAlertPrefs, type DriverAlertState } from './driverAlerts';
import type { RouteEvent, Severity } from './types';
import { buildWeatherEvents, defaultWeatherAlertPrefs } from './weatherAlerts';
import { wpts, type Spec } from './weatherAlerts.test';

const MIN = 60000;
const prefs: DriverAlertPrefs = { output: 'both', timing: 'auto' };

function ev(id: string, type: RouteEvent['type'], severity: Severity, minutes: number, distKm = minutes * 1.2, conf = 0.9): RouteEvent {
  return {
    id,
    type,
    category: 'weather',
    severity,
    latitude: 0,
    longitude: 0,
    distanceAlongM: distKm * 1000,
    distanceFromCurrentM: distKm * 1000,
    estimatedMinutesFromCurrent: minutes,
    estimatedArrivalTime: minutes * MIN,
    title: en.alert.title[type],
    shortMessage: '',
    voiceMessage: `${en.alert.title[type]} in ${minutes} minutes.`,
    icon: 'rain',
    source: 'test',
    confidence: conf,
    expiresAt: Infinity,
  };
}

/** Drive the engine through time; events move closer as time passes. */
function drive(make: (now: number) => RouteEvent[], fromMin: number, toMin: number, stepMin = 1, p = prefs) {
  let state: DriverAlertState = initialDriverAlertState;
  const spoken: { at: number; text: string }[] = [];
  const shown: string[] = [];
  for (let t = fromMin; t <= toMin; t += stepMin) {
    const d = evaluateDriverAlerts(make(t), state, { nowMs: t * MIN, prefs: p, m: en });
    state = d.state;
    d.voice.forEach((v) => spoken.push({ at: t, text: v.text }));
    if (d.visual) shown.push(d.visual.id);
  }
  return { spoken, shown, state };
}

describe('DriverAlertEngine timing', () => {
  it('medium event: one clear notice ~40 min before, never repeated', () => {
    const r = drive((t) => [ev('rain', 'RAIN_AHEAD', 'medium', 60 - t)].filter((e) => e.estimatedMinutesFromCurrent >= 0), 0, 60);
    expect(r.spoken.map((s) => s.at)).toEqual([20]);
  });

  it('no second notice when the first one came late (it was clear enough)', () => {
    const r = drive((t) => [ev('rain', 'RAIN_AHEAD', 'medium', 20 - t)], 0, 20);
    expect(r.spoken).toHaveLength(1);
  });

  it('high severity starts earlier (~55 min)', () => {
    const r = drive((t) => [ev('heavy', 'HEAVY_RAIN_AHEAD', 'high', 90 - t)], 0, 90);
    expect(r.spoken[0].at).toBe(35);
    expect(r.spoken).toHaveLength(2);
  });

  it('low-severity events never interrupt the driver', () => {
    const r = drive((t) => [ev('clear', 'WEATHER_CLEARING', 'low', 30 - t)], 0, 30);
    expect(r.spoken).toHaveLength(0);
    expect(r.shown).toHaveLength(0);
  });

  it('critical events need confidence ≥ 0.5 and can be announced early', () => {
    expect(drive((t) => [ev('s', 'THUNDERSTORM_AHEAD', 'critical', 100 - t, 100, 0.4)], 0, 100).spoken).toHaveLength(0);
    expect(drive((t) => [ev('s', 'THUNDERSTORM_AHEAD', 'critical', 100 - t, 100, 0.8)], 0, 100).spoken[0].at).toBe(0);
  });

  it('timing presets: early starts sooner; minimal skips medium entirely', () => {
    const early = drive((t) => [ev('r', 'RAIN_AHEAD', 'medium', 70 - t)], 0, 70, 1, { output: 'both', timing: 'early' });
    expect(early.spoken[0].at).toBeLessThan(20);
    const minimal = drive((t) => [ev('r', 'RAIN_AHEAD', 'medium', 70 - t)], 0, 70, 1, { output: 'both', timing: 'minimal' });
    expect(minimal.spoken).toHaveLength(0);
  });

  it('output settings: visual only / off', () => {
    const vis = drive((t) => [ev('r', 'RAIN_AHEAD', 'medium', 50 - t)], 0, 50, 1, { output: 'visual', timing: 'auto' });
    expect(vis.spoken).toHaveLength(0);
    expect(vis.shown.length).toBeGreaterThan(0);
    const off = drive((t) => [ev('r', 'RAIN_AHEAD', 'medium', 50 - t)], 0, 50, 1, { output: 'off', timing: 'auto' });
    expect(off.spoken).toHaveLength(0);
    expect(off.shown).toHaveLength(0);
  });
});

describe('grouping, cooldown, dedupe', () => {
  it('groups events close together into one natural sentence', () => {
    const r = drive(
      (t) => [ev('h', 'HEAVY_RAIN_AHEAD', 'high', 60 - t), ev('w', 'STRONG_WIND_AHEAD', 'medium', 66 - t)],
      0,
      10,
    );
    expect(r.spoken[0].text).toBe('Heavy rain and strong wind are expected ahead in about 55 minutes.');
    expect(r.spoken).toHaveLength(1);
  });

  it('keeps a cooldown between separate alerts instead of stacking them', () => {
    const r = drive((t) => [ev('a', 'HEAVY_RAIN_AHEAD', 'high', 55 - t, 70), ev('b', 'FOG_AHEAD', 'medium', 80 - t, 100)], 0, 60);
    const gaps = r.spoken.slice(1).map((s, i) => s.at - r.spoken[i].at);
    expect(gaps.every((g) => g >= 3)).toBe(true);
  });

  it('a forecast refresh that moves an event (new id, same type nearby) does not repeat it', () => {
    const r = drive(
      (t) => [t < 25 ? ev('RAIN@p3', 'RAIN_AHEAD', 'medium', 50 - t, 60) : ev('RAIN@p4', 'RAIN_AHEAD', 'medium', 50 - t, 68)],
      0,
      33,
    );
    expect(r.spoken).toHaveLength(1);
  });

  it('acknowledged alerts are never repeated', () => {
    let state = initialDriverAlertState;
    let d = evaluateDriverAlerts([ev('r', 'RAIN_AHEAD', 'medium', 35)], state, { nowMs: 0, prefs, m: en });
    state = acknowledge(d.state, d.visual!.eventIds);
    d = evaluateDriverAlerts([ev('r', 'RAIN_AHEAD', 'medium', 10)], state, { nowMs: 25 * MIN, prefs, m: en });
    expect(d.voice).toHaveLength(0);
  });
});

describe('alert fatigue on a long route with many weather changes', () => {
  // 1000 km, ~11 h, weather changing every sample: showers on/off, fog patches,
  // gusts around threshold, a cold front, a storm late on.
  const specs: Spec[] = Array.from({ length: 60 }, (_, i) => {
    const km = i * 17;
    const min = i * 11;
    const cycle = i % 6;
    const cond = i === 50 ? 'THUNDERSTORM' : cycle === 1 || cycle === 2 ? 'RAIN' : cycle === 4 ? 'FOG' : i % 2 ? 'CLOUDY' : 'PARTLY_CLOUDY';
    return {
      km,
      min,
      cond,
      temp: i > 30 ? 9 : 17,
      gusts: i % 5 === 0 ? 61 : 55,
      vis: cond === 'FOG' ? 800 : 20000,
      prob: cond === 'RAIN' ? 55 + (i % 3) * 10 : cond === 'THUNDERSTORM' ? 75 : 10,
    } as Spec;
  });

  it('speaks a handful of useful alerts over the whole drive, never the same thing twice', () => {
    const all = wpts(specs);
    let state = initialDriverAlertState;
    const spoken: string[] = [];
    for (let t = 0; t <= 660; t += 1) {
      const progressM = (t / 11) * 17_000;
      const pts = all.map((p) => ({ ...p, status: p.distanceFromStartKm * 1000 < progressM - 30 ? ('passed' as const) : ('upcoming' as const) }));
      const cur = pts.filter((p) => p.status === 'passed').at(-1) ?? null;
      const events = buildWeatherEvents({
        points: pts,
        current: cur ? { ...cur, id: 'current' } : null,
        progressM,
        referenceMs: all[0].arrivalMs + t * MIN,
        prefs: defaultWeatherAlertPrefs,
        m: en,
        units: { distance: 'metric', temperature: 'c', wind: 'kmh' },
      });
      const d = evaluateDriverAlerts(events, state, { nowMs: t * MIN, prefs, m: en });
      state = d.state;
      d.voice.forEach((v) => spoken.push(`${t}: ${v.text}`));
    }
    if (process.env.DEBUG_FATIGUE) console.log(spoken.join('\n'));
    // 11 hours of changeable weather → at most ~1 announcement per 40 min on average.
    expect(spoken.length).toBeGreaterThan(2);
    expect(spoken.length).toBeLessThanOrEqual(12);
    // No sentence repeats within an hour, and alerts are spread out.
    const timed = spoken.map((s) => ({ t: Number(s.split(':')[0]), text: s.replace(/^\d+: /, '') }));
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        if (timed[j].text === timed[i].text) expect(timed[j].t - timed[i].t).toBeGreaterThanOrEqual(60);
      }
    }
    expect(timed.some((s) => /Thunderstorms/.test(s.text))).toBe(true);
  });
});
