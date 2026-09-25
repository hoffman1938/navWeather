import { createRouteProjector } from '../algorithms/placesAlongRoute';
import { timeAtDistance } from '../algorithms/routeTiming';
import { matchForecastToTime } from '../algorithms/weatherMatching';
import type { Messages } from '../i18n/en';
import { formatTemp, spokenDistance, spokenDuration } from '../i18n/format';
import { spokenPrompt, spokenRoad } from '../navigation/instructions';
import { getProviders } from '../services/providers';
import { bestPoi } from '../services/placesAlongRoute';
import { forecastLookupFn } from '../services/routePlanner';
import { currentMessages, settingsSnapshot, useSettings } from '../state/settings';
import { getVoiceQueue, useAppStore, type AppState } from '../state/store';
import { formatLocalTime } from '../utils/timezone';
import { parseCommand, type Intent } from './parser';

/**
 * VOICE ASSISTANT — a driver assistant, not a chatbot. Utterance → intent
 * (NavigationCommandParser) → answer from the same route-intelligence model
 * the screen uses → one short spoken sentence (and a brief caption).
 */

let lastIntent: Intent | undefined;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

/** Where on the route is a named place? Route names first, then geocoding + projection. */
async function locateOnRoute(s: AppState, name: string): Promise<{ distanceM: number; name: string } | 'off-route' | null> {
  const plan = s.plan!;
  const n = norm(name);
  const named = [
    ...plan.places.map((p) => ({ name: p.name, d: p.distanceAlongM })),
    ...plan.samples.filter((x) => x.placeName).map((x) => ({ name: x.placeName!, d: x.distanceM })),
    { name: plan.timed.route.destination.name, d: plan.timed.totalDistM },
    { name: plan.timed.route.origin.name, d: 0 },
  ];
  const hit = named.find((p) => norm(p.name) === n) ?? named.find((p) => norm(p.name).startsWith(n) || n.startsWith(norm(p.name)));
  if (hit) return { distanceM: hit.d, name: hit.name };
  try {
    const place = await getProviders().geocoding.geocode(name);
    if (!place) return null;
    const proj = createRouteProjector(plan.timed)(place.coordinate);
    return proj.distanceFromLineM <= 10_000 ? { distanceM: proj.distanceAlongM, name: place.name } : 'off-route';
  } catch {
    return null;
  }
}

function arrivalAtDistance(s: AppState, d: number): number {
  const t = timeAtDistance(s.plan!.timed, d);
  if (s.mode !== 'planning' && s.progress) return s.progress.nowMs + (t - s.progress.modelTimeS) * 1000;
  return s.derived.departureMs + t * 1000;
}

export async function answer(text: string): Promise<string> {
  const m: Messages = currentMessages();
  const settings = settingsSnapshot();
  const intent = parseCommand(text, { last: lastIntent });
  if (intent.type !== 'unknown') lastIntent = intent;
  const store = useAppStore;
  const s = store.getState();
  const A = m.assistant;

  switch (intent.type) {
    case 'mute':
      useSettings.getState().update({ voice: false });
      getVoiceQueue().setMuted(true);
      return A.muted;
    case 'unmute':
      useSettings.getState().update({ voice: true });
      getVoiceQueue().setMuted(false);
      return A.unmuted;
    case 'repeat': {
      const last = getVoiceQueue().log.at(-1);
      return last?.text ?? A.notUnderstood;
    }
    case 'traffic':
      return A.trafficUnavailable;
    case 'avoid':
      // The demo OSRM server rejects every exclude flag; a provider that
      // declares `capabilities.avoid` can be wired to re-route here.
      return A.avoidUnsupported(A.avoid[intent.what]);
    case 'unknown':
      return A.notUnderstood;
  }

  if (!s.plan) return A.notNavigating;
  const timed = s.plan.timed;
  const progressM = s.progress?.distanceAlongM ?? 0;
  const destName = timed.route.destination.name;
  const destTz = s.derived.points.at(-1)?.timezone ?? 'UTC';
  const events = s.derived.intelligence.events;

  switch (intent.type) {
    case 'stop_navigation':
      if (s.mode === 'navigating') s.stopNavigation();
      else if (s.mode === 'simulating') s.exitSimulation();
      return A.stopped;

    case 'eta': {
      const eta = s.progress?.etaMs ?? s.derived.arrivalMs ?? Date.now();
      const remaining = s.progress?.remainingTimeS ?? timed.totalTimeS;
      return A.eta(formatLocalTime(eta, destTz), spokenDuration(remaining, m, false));
    }

    case 'distance_to': {
      if (!intent.place) {
        const rem = timed.totalDistM - progressM;
        const remT = s.progress?.remainingTimeS ?? timed.totalTimeS;
        return A.distanceTo(destName, spokenDistance(rem, settings.units.distance, m), spokenDuration(remT, m, false));
      }
      const loc = await locateOnRoute(s, intent.place);
      if (loc === 'off-route' || loc === null || loc.distanceM < progressM) return A.placeNotOnRoute(intent.place);
      const dt = timeAtDistance(timed, loc.distanceM) - timeAtDistance(timed, progressM);
      return A.distanceTo(loc.name, spokenDistance(loc.distanceM - progressM, settings.units.distance, m), spokenDuration(dt, m, false));
    }

    case 'next_turn': {
      const g = s.guidance;
      if (!g?.next || g.next.kind === 'arrive') return A.noMoreTurns(destName);
      return spokenPrompt(g.next, g.distanceToNextM < 150 ? 'final' : 'prepare', g.distanceToNextM, m, settings.units.distance, g.then);
    }

    case 'where_am_i': {
      const g = s.guidance;
      const road = g ? spokenRoad(g.currentRoadName, g.currentRoadRef, m) : undefined;
      const place = s.derived.currentPoint?.placeName ?? s.derived.upcoming[0]?.placeName;
      return A.whereAmI(road, place);
    }

    case 'weather_ahead': {
      const next = s.derived.intelligence.nextWeather;
      return next ? next.voiceMessage : A.noWeatherIssues;
    }

    case 'rain_when': {
      const now = s.derived.currentPoint?.weather;
      const wetNow = now && ['RAIN', 'HEAVY_RAIN', 'THUNDERSTORM', 'SNOW', 'SLEET'].includes(now.condition);
      if (wetNow) {
        const clearing = events.find((e) => e.type === 'WEATHER_CLEARING');
        return A.rainNow(clearing ? spokenDuration(clearing.estimatedMinutesFromCurrent * 60, m) : undefined);
      }
      const rain = events.find((e) =>
        ['RAIN_AHEAD', 'HEAVY_RAIN_AHEAD', 'THUNDERSTORM_AHEAD', 'SNOW_AHEAD', 'FREEZING_AHEAD'].includes(e.type),
      );
      return rain ? rain.voiceMessage : A.noRain;
    }

    case 'weather_at': {
      const loc = await locateOnRoute(s, intent.place);
      const lookup = forecastLookupFn(getProviders(), s.forecasts);
      if (loc && loc !== 'off-route' && loc.distanceM >= progressM - 1000) {
        // On the route: forecast at the time you'll be there.
        const sample = s.plan.samples.reduce((a, b) => (Math.abs(b.distanceM - loc.distanceM) < Math.abs(a.distanceM - loc.distanceM) ? b : a));
        const f = lookup(sample);
        const at = arrivalAtDistance(s, loc.distanceM);
        const w = f ? matchForecastToTime(f, at) : null;
        if (!w) return m.weather.summary.unavailable;
        const chance = w.precipitationProbability && w.precipitationProbability >= 20 ? Math.round(w.precipitationProbability / 5) * 5 : undefined;
        return A.weatherAtOnRoute(loc.name, formatLocalTime(at, f!.timezone), m.weather.condition[w.condition], formatTemp(w.temperature, settings.units.temperature), chance);
      }
      // Not on the route: current conditions there (clearly labelled).
      try {
        const place = await getProviders().geocoding.geocode(intent.place);
        if (!place) return A.placeNotOnRoute(intent.place);
        const w = await getProviders().weather.getWeatherForArrivalTime(place.coordinate[1], place.coordinate[0], Date.now());
        if (!w) return m.weather.summary.unavailable;
        return A.weatherAtNow(place.name, m.weather.condition[w.condition], formatTemp(w.temperature, settings.units.temperature));
      } catch {
        return m.weather.summary.unavailable;
      }
    }

    case 'find_poi': {
      const categoryName = m.poi.category[intent.category];
      let aroundM: number | undefined;
      if (intent.near) {
        const loc = await locateOnRoute(s, intent.near);
        if (loc && loc !== 'off-route') aroundM = loc.distanceM;
      }
      const results = await s.searchPoi(intent.category, { aroundM });
      const best = bestPoi(results, intent.maxDetourMin);
      if (!best) return A.poiNone(categoryName, spokenDistance(60_000, settings.units.distance, m));
      const name = best.poi.name ?? best.poi.brand ?? m.poi.unnamed(categoryName);
      const detourMin = best.detourS !== undefined ? Math.round(best.detourS / 60) : 0;
      return A.poiFound(categoryName, name, spokenDistance(best.aheadM, settings.units.distance, m), A.detour(detourMin));
    }

    case 'alternatives': {
      const n = s.mode === 'planning' ? s.routeOptions.length - 1 : 0;
      if (n > 0) s.setSheet('expanded');
      return A.alternatives(n);
    }
  }
  return A.notUnderstood;
}

/**
 * Push-to-talk: listen once, answer, speak. The microphone is only opened
 * here — in response to the user pressing the button.
 */
export function listenAndAnswer(): () => void {
  const m = currentMessages();
  const store = useAppStore.getState();
  const rec = getProviders().speechRecognition;
  if (!rec.supported) {
    store.setAssistant({ activity: 'idle', reply: { text: m.assistant.unsupported, at: Date.now() } });
    return () => {};
  }
  getProviders().tts.unlock();
  store.setAssistant({ activity: 'listening', transcript: '', reply: null });
  let handled = false;
  const session = rec.listen({
    lang: m.speechLang,
    onResult: (text, final) => {
      useAppStore.getState().setAssistant({ transcript: text });
      if (final && !handled && text.trim()) {
        handled = true;
        void respond(text);
      }
    },
    onEnd: () => {
      if (!handled) useAppStore.getState().setAssistant({ activity: 'idle' });
    },
    onError: (reason) => {
      handled = true;
      const text = reason === 'denied' ? m.assistant.micDenied : reason === 'unsupported' ? m.assistant.unsupported : m.assistant.notUnderstood;
      useAppStore.getState().setAssistant({ activity: 'idle', reply: { text, at: Date.now() } });
    },
  });
  return () => session.stop();
}

export async function respond(text: string): Promise<string> {
  const store = useAppStore.getState();
  store.setAssistant({ activity: 'thinking', transcript: text });
  const reply = await answer(text);
  useAppStore.getState().setAssistant({ activity: 'idle', reply: { text: reply, at: Date.now() } });
  // Mute/unmute confirmations are shown, not spoken over a muted channel.
  if (useSettings.getState().voice) useAppStore.getState().say(reply, 3);
  return reply;
}

export function __resetAssistant() {
  lastIntent = undefined;
}
