import osrmFixture from './fixtures/osrm-tbilisi-batumi.json';
import overpassFixture from './fixtures/overpass-tbilisi-batumi.json';
import { normalizeOsrmRoute } from '../services/routing/OSRMProvider';
import { parseOverpassElements } from '../services/places/OverpassPlacesProvider';
import type { ForecastRequest, WeatherProvider } from '../services/weather/WeatherProvider';
import { normalizeWmoCode } from '../services/weather/weatherCodes';
import type { Place } from '../types/geo';
import type { Route } from '../types/route';
import type { LocationForecast } from '../types/weather';
import type { SpeechRecognitionProvider, TextToSpeechProvider } from '../voice/providers';

export const TBILISI: Place = {
  id: 'test:tbilisi',
  name: 'Tbilisi',
  label: 'Tbilisi, Georgia',
  coordinate: [44.8014495, 41.6934591],
};
export const BATUMI: Place = {
  id: 'test:batumi',
  name: 'Batumi',
  label: 'Batumi, Georgia',
  coordinate: [41.6360085, 41.6509502],
};

type RawOsrmRoute = Parameters<typeof normalizeOsrmRoute>[0];

export function rawTbilisiBatumi(): RawOsrmRoute {
  return structuredClone(osrmFixture.routes[0]) as unknown as RawOsrmRoute;
}

export function tbilisiBatumiRoute(mutate?: (raw: RawOsrmRoute) => void): Route {
  const raw = rawTbilisiBatumi();
  mutate?.(raw);
  return normalizeOsrmRoute(raw, { origin: TBILISI, destination: BATUMI });
}

export function tbilisiBatumiPlaces() {
  return parseOverpassElements(overpassFixture.elements as never, 'en');
}

export interface HourlyValues {
  temperature?: number;
  code?: number;
  precipitationProbability?: number;
  precipitation?: number;
  windSpeed?: number;
  windGusts?: number;
  visibility?: number;
}

/** Synthetic normalized forecast: `hourFn(hourStartMs, index)` → values. */
export function makeForecast(opts: {
  key?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  startMs: number;
  hours: number;
  hourFn: (hourMs: number, i: number) => HourlyValues;
  fetchedAt?: number;
}): LocationForecast {
  const times = Array.from({ length: opts.hours }, (_, i) => opts.startMs + i * 3600_000);
  const vals = times.map((t, i) => opts.hourFn(t, i));
  const codes = vals.map((v) => normalizeWmoCode(v.code ?? 3));
  return {
    locationKey: opts.key ?? 'test',
    latitude: opts.latitude ?? 41.7,
    longitude: opts.longitude ?? 44.8,
    timezone: opts.timezone ?? 'Asia/Tbilisi',
    times,
    hourly: {
      temperature: vals.map((v) => v.temperature ?? 20),
      apparentTemperature: vals.map((v) => (v.temperature ?? 20) - 1),
      precipitationProbability: vals.map((v) => v.precipitationProbability ?? 0),
      precipitation: vals.map((v) => v.precipitation ?? 0),
      rain: vals.map((v) => v.precipitation ?? 0),
      snowfall: vals.map(() => 0),
      condition: codes.map((c) => c?.condition ?? null),
      description: codes.map((c) => c?.description ?? null),
      cloudCover: vals.map(() => 50),
      windSpeed: vals.map((v) => v.windSpeed ?? 10),
      windGusts: vals.map((v) => v.windGusts ?? 20),
      windDirection: vals.map(() => 270),
      visibility: vals.map((v) => v.visibility ?? 30000),
      humidity: vals.map(() => 60),
    },
    provider: 'test',
    fetchedAt: opts.fetchedAt ?? Date.now(),
  };
}

/**
 * Fake weather provider. By default the weather depends on BOTH place and
 * time: rain west of 43.7°E (Khashuri and beyond) only from 2 h after
 * `baseMs`; temperature rises 1°/h. That lets tests prove the weather shown
 * matches the ETA, not "now".
 */
export class FakeWeatherProvider implements WeatherProvider {
  readonly name = 'fake';
  readonly maxLocationsPerRequest = 50;
  requests: ForecastRequest[] = [];
  fail = false;
  version = 0;
  /** Upstream model-run availability time (UTC ms); null = not exposed. */
  latestRun: number | null = null;
  updateChecks = 0;

  async getLatestUpdateTime(): Promise<number | null> {
    this.updateChecks++;
    return this.latestRun;
  }

  constructor(
    public baseMs: number,
    public hourFn?: (lat: number, lon: number, hourMs: number, version: number) => HourlyValues,
  ) {}

  /** Simulated network latency (ms); requests honour their abort signal. */
  delayMs = 0;

  async getForecasts(req: ForecastRequest): Promise<LocationForecast[]> {
    this.requests.push(req);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (this.fail) throw Object.assign(new Error('boom'), { name: 'Error' });
    const start = Math.floor(this.baseMs / 3600_000) * 3600_000 - 3 * 3600_000;
    const fn =
      this.hourFn ??
      ((_lat: number, lon: number, hourMs: number) => {
        const h = (hourMs - this.baseMs) / 3600_000;
        const raining = lon < 43.7 && h >= 2;
        return {
          temperature: 15 + h,
          code: raining ? 63 : 3,
          precipitationProbability: raining ? 70 : 10,
          precipitation: raining ? 1.2 : 0,
        };
      });
    return req.locations.map((loc) =>
      makeForecast({
        key: loc.key,
        latitude: loc.latitude,
        longitude: loc.longitude,
        startMs: start,
        hours: req.forecastHours + req.pastHours,
        hourFn: (t) => fn(loc.latitude, loc.longitude, t, this.version),
      }),
    );
  }
}

/** Records speech; finishes each utterance immediately unless `holdSpeech` is set. */
export class FakeTTS implements TextToSpeechProvider {
  readonly name = 'fake-tts';
  readonly supported = true;
  spoken: string[] = [];
  holdSpeech = false;
  private pending: (() => void) | null = null;
  speak(text: string, opts: { lang: string; onEnd: () => void }): void {
    this.spoken.push(text);
    if (this.holdSpeech) this.pending = opts.onEnd;
    else opts.onEnd();
  }
  /** Finish the utterance currently being "spoken". */
  finish(): void {
    const f = this.pending;
    this.pending = null;
    f?.();
  }
  cancel(): void {
    this.pending = null;
  }
  unlock(): void {}
}

export class FakeRecognition implements SpeechRecognitionProvider {
  readonly name = 'fake-stt';
  supported = true;
  nextTranscript = '';
  listen(opts: Parameters<SpeechRecognitionProvider['listen']>[0]) {
    queueMicrotask(() => {
      opts.onResult(this.nextTranscript, true);
      opts.onEnd();
    });
    return { stop() {} };
  }
}
