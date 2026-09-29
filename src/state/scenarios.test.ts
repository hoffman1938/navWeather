import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProviders } from '../services/providers';
import { installFakeProviders, type Harness } from '../test/harness';
import { respond, __resetAssistant } from '../voice/assistant';
import { simulateDeviation, simulateIncident, simulateWeatherChange, skipToNextEvent } from '../dev/devTools';
import { useSettings } from './settings';
import { __resetStoreRuntime, getVoiceQueue, maybeOfferWeatherReroute, useAppStore, type WeatherRerouteOffer } from './store';

/**
 * Driver-facing scenarios on Tbilisi → Batumi (brief §86–93): simulated drive
 * with voice + alerts, forecast change mid-drive, network loss, assistant.
 */

const BASE = Date.UTC(2026, 8, 26, 4, 0); // 08:00 Tbilisi
const H = 3600_000;
const initial = useAppStore.getState();
let h: Harness;

async function plan() {
  const s = useAppStore.getState();
  s.setOriginText('Tbilisi');
  s.setDestinationText('Batumi');
  useAppStore.setState({ departure: { mode: 'at', utcMs: BASE } });
  await useAppStore.getState().calculateRoute();
}

/** Drive the simulation for `simMinutes` of route time in 30-second steps. */
function drive(simMinutes: number) {
  const s = useAppStore.getState();
  const stepReal = (30_000 / s.sim.speed) | 0;
  for (let t = 0; t < simMinutes * 2; t++) useAppStore.getState().advanceSimulationBy(stepReal);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE - 10 * 60000);
  __resetStoreRuntime();
  __resetAssistant();
  useAppStore.setState(initial, true);
  useSettings.getState().reset();
  useSettings.getState().update({ language: 'en', units: { distance: 'metric', temperature: 'c', wind: 'kmh' } });
  h = installFakeProviders(BASE);
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('simulated drive: events, alerts and voice', () => {
  it('announces the rain ahead once, with the ETA-based time and place, and shows a banner', async () => {
    await plan();
    useAppStore.getState().setSimulationSpeed(60);
    useAppStore.getState().startSimulation();
    const events = useAppStore.getState().derived.intelligence.events;
    const rain = events.find((e) => e.type === 'RAIN_AHEAD');
    expect(rain).toBeDefined();
    // Fake forecast: rain west of 43.7°E from 09:00 → first reached ≈ Khashuri area.
    expect(rain!.estimatedMinutesFromCurrent).toBeGreaterThan(60);

    drive(80); // ~40 min before the rain → first notice
    const spokenRain = h.tts.spoken.filter((t) => /Rain is (likely|possible)/.test(t));
    expect(spokenRain).toHaveLength(1);
    expect(spokenRain[0]).toMatch(/in about \d+ minutes/);
    expect(useAppStore.getState().activeAlert?.title).toMatch(/Rain/);
    expect(Object.values(useAppStore.getState().alertState.events).some((e) => e.firstAt !== undefined)).toBe(true);
    // Nothing is spoken twice during the whole drive.
    drive(230);
    expect(h.tts.spoken.filter((t) => /Rain is (likely|possible)/.test(t))).toHaveLength(1);
    expect(new Set(h.tts.spoken).size).toBe(h.tts.spoken.length);
  });

  it('keeps the "Ahead" list current: next weather, destination last', async () => {
    await plan();
    useAppStore.getState().startSimulation();
    const ahead = useAppStore.getState().derived.intelligence.ahead;
    expect(ahead.at(-1)!.type).toBe('DESTINATION');
    expect(ahead.at(-1)!.title).toBe('Batumi');
    expect(ahead.some((e) => e.category === 'weather')).toBe(true);
    // Guidance is live from the first step.
    drive(2);
    expect(useAppStore.getState().guidance?.next).toBeTruthy();
  });

  it('forecast change mid-drive updates events without repeating old announcements', async () => {
    await plan();
    useAppStore.getState().setSimulationSpeed(60);
    useAppStore.getState().startSimulation();
    drive(70); // rain alert has been given by now
    const before = h.tts.spoken.filter((t) => /Rain/.test(t)).length;
    expect(before).toBe(1);
    // New model run: rain starts an hour later but in the same area.
    h.weather.hourFn = (_lat, lon, hourMs) => {
      const hh = (hourMs - BASE) / H;
      const raining = lon < 43.7 && hh >= 3;
      return { temperature: 15 + hh, code: raining ? 63 : 3, precipitationProbability: raining ? 70 : 10, precipitation: raining ? 1.2 : 0 };
    };
    vi.setSystemTime(BASE + 40 * 60000);
    await useAppStore.getState().loadWeather({ force: true, reason: 'manual' });
    drive(120);
    expect(h.tts.spoken.filter((t) => /Rain is (likely|possible)/.test(t))).toHaveLength(1);
  });

  it('speaks maneuvers at real-time playback, before any weather', async () => {
    await plan();
    useAppStore.getState().setSimulationSpeed(1);
    useAppStore.getState().startSimulation();
    for (let i = 0; i < 240; i++) useAppStore.getState().advanceSimulationBy(1000);
    const maneuverPrompts = getVoiceQueue().log.filter((l) => l.id.startsWith('mv:'));
    expect(maneuverPrompts.length).toBeGreaterThan(0);
    expect(maneuverPrompts[0].text).toMatch(/^(In \d+ (meters|kilometers), |Turn|Bear|Keep|At the|Take|Continue|Make)/);
  });
});

describe('network loss during navigation', () => {
  it('keeps the route, instructions and cached weather; labels offline; resumes when back', async () => {
    await plan();
    useAppStore.getState().startSimulation();
    drive(10);
    const planBefore = useAppStore.getState().plan;
    const eventsBefore = useAppStore.getState().derived.intelligence.events.length;

    useAppStore.getState().setOnline(false);
    h.weather.fail = true;
    vi.setSystemTime(BASE + 50 * 60000);
    await useAppStore.getState().loadWeather({ reason: 'auto' });
    drive(10);
    let s = useAppStore.getState();
    expect(s.online).toBe(false);
    expect(s.plan).toBe(planBefore);
    expect(s.guidance?.next).toBeTruthy();
    expect(s.derived.points.every((p) => p.weather)).toBe(true); // cached forecast still used
    expect(s.weatherStale).toBe(true);
    expect(s.derived.intelligence.events.length).toBeGreaterThanOrEqual(eventsBefore - 2);
    expect(s.mode).toBe('simulating');

    h.weather.fail = false;
    const requests = h.weather.requests.length;
    useAppStore.getState().setOnline(true);
    await vi.waitFor(() => expect(h.weather.requests.length).toBeGreaterThan(requests));
    await vi.waitFor(() => expect(useAppStore.getState().weatherStale).toBe(false));
    s = useAppStore.getState();
    expect(s.weatherError).toBeNull();
  });
});

describe('voice assistant', () => {
  it('answers driving questions from the route model', async () => {
    await plan();
    useAppStore.getState().startSimulation();
    drive(20);
    expect(await respond("What's my ETA?")).toMatch(/^You'll arrive at \d\d:\d\d, in about /);
    expect(await respond('How far is Batumi?')).toMatch(/^Batumi is \d+ kilometers away, about /);
    expect(await respond('When will the rain start?')).toMatch(/^Rain is (likely|possible) in about/);
    expect(await respond("What's the weather in Zestaponi?")).toMatch(/^Around \d\d:\d\d in Zestaponi, expect rain/);
    expect(await respond('Are there traffic problems ahead?')).toBe("Live traffic information isn't available yet.");
    expect(await respond('Avoid toll roads')).toBe("Avoiding toll roads isn't supported by the current routing service.");
    expect(await respond('purple elephants')).toBe("Sorry, I didn't catch that.");
  });

  it('finds places along the route with real detour time', async () => {
    await plan();
    useAppStore.getState().startSimulation();
    drive(10);
    const t = useAppStore.getState().plan!.timed;
    // A fuel station ~300 m off the road 30 km ahead.
    const g = t.route.geometry;
    let i = 0;
    while (t.cumDistM[i] < useAppStore.getState().progress!.distanceAlongM + 30_000) i++;
    h.poi.results = [{ id: 'f1', category: 'fuel', name: 'Gulf', coordinate: [g[i][0], g[i][1] + 0.003], source: 'test' }];
    const reply = await respond('Find a gas station');
    expect(reply).toMatch(/^The best gas station on your route is Gulf, (29|30|31) kilometers ahead, /);
    const r = useAppStore.getState().poi!.results[0];
    expect(r.offRouteM).toBeGreaterThan(200);
    expect(r.detourS).toBeGreaterThan(0);
  });

  it('follow-up questions keep context ("What about Kutaisi?")', async () => {
    await plan();
    await respond("What's the weather in Gori?");
    const r = await respond('What about Kutaisi?');
    expect(r).toMatch(/Kutaisi/);
  });
});

describe('critical path: deviation mid-drive (brief §58)', () => {
  it('re-routes from where the car is and rebuilds ETA, timeline and events — nothing stale survives', async () => {
    await plan();
    useAppStore.getState().setSimulationSpeed(60);
    useAppStore.getState().startSimulation();
    drive(40);
    const before = useAppStore.getState();
    const oldRoute = before.plan!.timed.route.id;
    const oldPoints = new Set(before.derived.points.map((p) => p.id));
    const oldEta = before.derived.arrivalMs;
    expect(before.progress!.distanceAlongM).toBeGreaterThan(20_000);

    simulateDeviation(); // 400 m off the road
    await vi.waitFor(() => expect(useAppStore.getState().plan!.timed.route.id).not.toBe(oldRoute));
    const after = useAppStore.getState();
    expect(after.mode).toBe('simulating');
    expect(after.plan!.timed.route.origin.name).toBe('Your location');
    expect(after.progress!.distanceAlongM).toBe(0); // the drive continues on the new route
    expect(after.derived.arrivalMs).not.toBe(oldEta);
    expect(after.derived.points.some((p) => oldPoints.has(p.id))).toBe(false);
    for (const e of after.derived.intelligence.events) expect(e.distanceAlongM).toBeLessThanOrEqual(after.plan!.timed.totalDistM);
    expect(h.tts.spoken).toContain('Route updated.');

    drive(10);
    expect(useAppStore.getState().progress!.distanceAlongM).toBeGreaterThan(5000);
  });

  it('a reported incident ahead is announced as a report, and "next event" skips to it', async () => {
    await plan();
    useAppStore.getState().setSimulationSpeed(60);
    useAppStore.getState().startSimulation();
    drive(5);
    simulateIncident();
    expect(useAppStore.getState().simulatedData).toBe(true);
    const inc = useAppStore.getState().derived.intelligence.events.find((e) => e.type === 'INCIDENT')!;
    expect(inc.shortMessage).toBe('Unconfirmed report');
    skipToNextEvent();
    drive(4);
    expect(h.tts.spoken.some((t) => /Accident reported ahead/.test(t))).toBe(true);
  });
});

describe('weather re-route while driving (offered, never automatic)', () => {
  async function driving(minutes: number) {
    await plan();
    useAppStore.getState().setSimulationSpeed(60);
    useAppStore.getState().startSimulation();
    drive(minutes);
  }

  it('looks for other routes only with severe weather ahead, and never offers the same road', async () => {
    await driving(20);
    const calls = h.routingCalls.length;
    await maybeOfferWeatherReroute(true); // the fake forecast has plain rain only
    expect(h.routingCalls.length).toBe(calls);
    simulateWeatherChange(); // heavy rain 20–80 km ahead
    await maybeOfferWeatherReroute(true);
    expect(h.routingCalls.length).toBe(calls + 1); // asked for routes from the car
    expect(useAppStore.getState().weatherReroute).toBeNull(); // the only one is the same road
    expect(useAppStore.getState().plan?.timed.route.origin.name).toBe('Tbilisi'); // nothing changed
  });

  function offerOf(): WeatherRerouteOffer {
    const s = useAppStore.getState();
    const e = { score: 60, severeMinutes: 15, wetMinutes: 15, fogMinutes: 0 };
    return { plan: s.plan!, extraS: 300, current: e, alternative: { ...e, score: 5, severeMinutes: 0, wetMinutes: 5 }, condition: 'storm', atProgressM: s.progress!.distanceAlongM, from: s.vehicle!.coordinate };
  }

  it('dismiss keeps the route; accept switches the drive; an old offer lapses', async () => {
    await driving(10);
    const before = useAppStore.getState().plan;
    useAppStore.setState({ weatherReroute: offerOf() });
    useAppStore.getState().dismissWeatherReroute();
    expect(useAppStore.getState().weatherReroute).toBeNull();
    expect(useAppStore.getState().plan).toBe(before);

    const offer = offerOf();
    useAppStore.setState({ weatherReroute: offer });
    await useAppStore.getState().acceptWeatherReroute();
    const s = useAppStore.getState();
    expect(s.weatherReroute).toBeNull();
    expect(s.plan).toBe(offer.plan);
    expect(s.mode).toBe('simulating');

    useAppStore.setState({ weatherReroute: offerOf() });
    drive(5); // ~5 km further on
    expect(useAppStore.getState().weatherReroute).toBeNull();
  });
});
