import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiAirQualityProvider, aqiLevel, type AirQualityProvider } from '../services/air/AirQualityProvider';
import { airCell, europeanAqi, subIndex, trailingMean } from './air';

/** Air quality from our CAMS tiles (DP-4.6): the European AQI, the grid, the provider's fallback. */

describe('the European Air Quality Index', () => {
  it('each band is 20 points, linear inside: the band edges land on the app’s levels', () => {
    expect(subIndex('pm2_5', 0)).toBe(0);
    expect(subIndex('pm2_5', 10)).toBe(20); // good | fair
    expect(subIndex('pm2_5', 15)).toBe(30);
    expect(subIndex('no2', 120)).toBe(60); // moderate | poor
    expect(subIndex('o3', 380)).toBe(100); // very poor | extremely poor
    expect(subIndex('so2', null)).toBeNull();
    expect(subIndex('pm10', -1)).toBeNull();
    expect(aqiLevel(subIndex('pm10', 45)!)).toBe('moderate');
  });

  it('the index is the worst pollutant; unknown only when nothing is known', () => {
    expect(europeanAqi({ pm2_5: 8, pm10: 15, no2: 100, o3: 60, so2: 5 })).toBe(47); // NO2 is the worst: 40 + 20 × 10/30
    expect(europeanAqi({ pm2_5: null, pm10: null, no2: null, o3: 30, so2: null })).toBe(12);
    expect(europeanAqi({ pm2_5: null, pm10: null, no2: null, o3: null, so2: null })).toBeNull();
  });

  it('particles count over the last 24 hours (what exists of them)', () => {
    const v = Float32Array.from({ length: 30 }, (_, i) => (i < 24 ? 10 : 70));
    expect(trailingMean(v, 0)).toBe(10);
    expect(trailingMean(v, 29)).toBe((18 * 10 + 6 * 70) / 24);
    expect(trailingMean(Float32Array.from([NaN, 4, NaN]), 2)).toBe(4);
    expect(trailingMean(Float32Array.from([NaN]), 0)).toBeNull();
  });

  it('a point → its 0.4° cell and 4° tile', () => {
    expect(airCell(41.6935, 44.8015)).toEqual({ row: 329, col: 562, ty: 32, tx: 56, i: 92 });
    expect(airCell(0, 180).col).toBe(0);
  });
});

describe('ApiAirQualityProvider', () => {
  afterEach(() => vi.unstubAllGlobals());
  const fallback = (): AirQualityProvider & { n: number } => ({
    name: 'fake',
    n: 0,
    async current() {
      this.n++;
      return { europeanAqi: 99, observedAt: 0 };
    },
  });

  it('our index; the fallback only when our Worker can’t answer; at sea there is simply no index', async () => {
    let reply = () => Response.json({ current: { time: 1791190800, european_aqi: 27 } });
    vi.stubGlobal('fetch', async () => reply());
    const fb = fallback();
    expect(await new ApiAirQualityProvider('/api/v1/air', fb).current([44.8, 41.69])).toEqual({ europeanAqi: 27, observedAt: 1791190800000 });
    reply = () => Response.json({ current: { time: 1791190800, european_aqi: null } });
    expect(await new ApiAirQualityProvider('/api/v1/air', fb).current([-150, 30])).toBeNull();
    expect(fb.n).toBe(0);
    reply = () => Response.json({ error: 'unavailable' }, { status: 503 });
    expect(await new ApiAirQualityProvider('/api/v1/air', fb).current([44.8, 41.69])).toMatchObject({ europeanAqi: 99 });
    await expect(new ApiAirQualityProvider('/api/v1/air', null).current([44.8, 41.69])).rejects.toThrow();
  });
});
