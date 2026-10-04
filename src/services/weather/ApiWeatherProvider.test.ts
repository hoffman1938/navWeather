import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocationForecast } from '../../types/weather';
import { ApiWeatherProvider } from './ApiWeatherProvider';
import type { ForecastRequest, WeatherProvider } from './WeatherProvider';

/** Our forecast in the app (DP-6.6): `/api/v1/weather`, Open-Meteo's shape; the public API only where ours is missing. */

const T = Date.UTC(2026, 9, 5, 0) / 1000;
const located = (lat: number, lon: number, elevation = 717) => ({
  latitude: lat,
  longitude: lon,
  elevation,
  timezone: 'Asia/Tbilisi',
  utc_offset_seconds: 14400,
  hourly: { time: [T, T + 3600], temperature_2m: [8.9, 8.5], weather_code: [0, 61], precipitation: [0, 0.4], visibility: [24140, 24140] },
});

let sent: string[];
let reply: (url: URL) => Response;

beforeEach(() => {
  sent = [];
  reply = () => Response.json([located(41.75, 44.75), located(42, 43.5)]);
  vi.stubGlobal('fetch', async (input: string) => {
    sent.push(input);
    return reply(new URL(input, 'http://localhost'));
  });
});
afterEach(() => vi.unstubAllGlobals());

const req = (n = 2, elevations: (number | undefined)[] = []): ForecastRequest => ({
  locations: [
    { key: 'a', latitude: 41.6935, longitude: 44.8015, elevationM: elevations[0] },
    { key: 'b', latitude: 42.0, longitude: 43.5, elevationM: elevations[1] },
    { key: 'c', latitude: 30.0, longitude: -150.0, elevationM: elevations[2] },
  ].slice(0, n),
  forecastHours: 48,
  pastHours: 3,
});

function fakeOpenMeteo(): WeatherProvider & { asked: ForecastRequest[] } {
  const asked: ForecastRequest[] = [];
  return {
    name: 'fake-open-meteo',
    maxLocationsPerRequest: 50,
    asked,
    async getForecasts(r) {
      asked.push(r);
      return r.locations.map((l) => ({ locationKey: l.key, provider: 'open-meteo' }) as LocationForecast);
    },
    async getLatestUpdateTime() {
      return 42;
    },
  };
}

describe('ApiWeatherProvider', () => {
  it('asks our Worker with Open-Meteo’s query (heights when known) and reads its answer', async () => {
    const om = fakeOpenMeteo();
    const got = await new ApiWeatherProvider('/api/v1/weather', om).getForecasts(req(2, [450, undefined]));
    const url = new URL(sent[0], 'http://localhost');
    expect(url.pathname).toBe('/api/v1/weather/forecast');
    expect(url.searchParams.get('latitude')).toBe('41.6935,42.0000');
    expect(url.searchParams.get('elevation')).toBe('450,nan');
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(got[0]).toMatchObject({ locationKey: 'a', provider: 'navweather', timezone: 'Asia/Tbilisi', elevationM: 717, times: [T * 1000, (T + 3600) * 1000] });
    expect(got[0].hourly.condition).toEqual(['CLEAR', 'RAIN']);
    expect(got[0].hourly.precipitationProbability).toEqual([null, null]); // unknown, not invented
    expect(om.asked).toEqual([]);
    expect(new URL(((await new ApiWeatherProvider('/w', null).getForecasts(req(2))), sent[1]), 'http://localhost').searchParams.has('elevation')).toBe(false);
  });

  it('only the points without our data go to the fallback — or come back empty without one', async () => {
    reply = () => Response.json([located(41.75, 44.75), located(42, 43.5), { latitude: 30, longitude: -150, timezone: 'Pacific/Honolulu', missing: true }]);
    const om = fakeOpenMeteo();
    const got = await new ApiWeatherProvider('/api/v1/weather', om).getForecasts(req(3));
    expect(got.map((f) => f.provider)).toEqual(['navweather', 'navweather', 'open-meteo']);
    expect(om.asked.map((r) => r.locations.map((l) => l.key))).toEqual([['c']]);
    const alone = await new ApiWeatherProvider('/api/v1/weather', null).getForecasts(req(3));
    expect(alone[2]).toMatchObject({ locationKey: 'c', timezone: 'Pacific/Honolulu', times: [] });
  });

  it('the fallback answers when our data are not there (not built, too old) or the Worker is down — not for refused requests', async () => {
    const om = fakeOpenMeteo();
    const p = new ApiWeatherProvider('/api/v1/weather', om);
    reply = () => Response.json({ error: 'unavailable', reason: 'stale' }, { status: 503 });
    expect((await p.getForecasts(req(2))).map((f) => f.provider)).toEqual(['open-meteo', 'open-meteo']);
    reply = () => {
      throw new TypeError('fetch failed');
    };
    expect(await p.getForecasts(req(1))).toHaveLength(1);
    expect(om.asked).toHaveLength(2);
    reply = () => Response.json({ error: 'too-many-requests' }, { status: 429 });
    await expect(p.getForecasts(req(1))).rejects.toMatchObject({ kind: 'rate-limited' });
    reply = () => Response.json({ error: 'bad-request' }, { status: 400 });
    await expect(p.getForecasts(req(1))).rejects.toMatchObject({ status: 400 });
    expect(om.asked).toHaveLength(2);
    reply = () => Response.json({ error: 'unavailable' }, { status: 503 });
    await expect(new ApiWeatherProvider('/api/v1/weather', null).getForecasts(req(1))).rejects.toMatchObject({ status: 503 });
  });

  it('knows when our newest forecast arrived; while ours is old or missing, the fallback’s', async () => {
    const om = fakeOpenMeteo();
    const p = new ApiWeatherProvider('/api/v1/weather', om);
    reply = () => Response.json({ last_run_availability_time: 1791144712, fresh: true });
    expect(await p.getLatestUpdateTime()).toBe(1791144712000);
    expect(sent.at(-1)).toBe('/api/v1/weather/meta');
    reply = () => Response.json({ last_run_availability_time: 1791144712, fresh: false });
    expect(await p.getLatestUpdateTime()).toBe(42);
    reply = () => Response.json({ error: 'unavailable' }, { status: 503 });
    expect(await p.getLatestUpdateTime()).toBe(42);
    expect(await new ApiWeatherProvider('/api/v1/weather', null).getLatestUpdateTime()).toBeNull();
  });
});
