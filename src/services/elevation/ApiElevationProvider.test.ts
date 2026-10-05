import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LngLat } from '../../types/geo';
import { ApiElevationProvider } from './ApiElevationProvider';
import type { ElevationProvider } from './ElevationProvider';

/** Heights from our DEM in the app (DP-4.7, DP-6.6); the public API only for what our tiles don't cover. */

let reply: (url: URL) => Response;
let sent: string[];
beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', async (input: string) => {
    sent.push(input);
    return reply(new URL(input, 'http://localhost'));
  });
});
afterEach(() => vi.unstubAllGlobals());

function fallback(): ElevationProvider & { asked: LngLat[][] } {
  const asked: LngLat[][] = [];
  return {
    name: 'fake-open-meteo',
    asked,
    async getElevations(coords) {
      asked.push(coords);
      return coords.map(() => 111);
    },
  };
}

const route: LngLat[] = [
  [44.8015, 41.6935],
  [44.64, 42.66],
  [28.97, 41.01],
];

describe('ApiElevationProvider', () => {
  it('asks our Worker; only the points outside our tiles go to the fallback, in order', async () => {
    reply = () => Response.json({ elevation: [428, 2370, null] });
    const fb = fallback();
    expect(await new ApiElevationProvider('/api/v1/elevation', fb).getElevations(route)).toEqual([428, 2370, 111]);
    expect(new URL(sent[0], 'http://localhost').searchParams.get('latitude')).toBe('41.69350,42.66000,41.01000');
    expect(fb.asked).toEqual([[[28.97, 41.01]]]);
  });

  it('our Worker unable to answer → the fallback answers everything; without one, the error shows', async () => {
    reply = () => Response.json({ error: 'unavailable' }, { status: 503 });
    const fb = fallback();
    expect(await new ApiElevationProvider('/api/v1/elevation', fb).getElevations(route)).toEqual([111, 111, 111]);
    await expect(new ApiElevationProvider('/api/v1/elevation', null).getElevations(route)).rejects.toThrow();
    reply = () => Response.json({ elevation: [428, null, null] });
    await expect(new ApiElevationProvider('/api/v1/elevation', null).getElevations(route)).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('a long route goes in batches of 100', async () => {
    reply = (u) => Response.json({ elevation: u.searchParams.get('latitude')!.split(',').map(() => 5) });
    const many = Array.from({ length: 250 }, (_, i): LngLat => [44 + i / 1000, 41.5]);
    expect(await new ApiElevationProvider('/api/v1/elevation', null).getElevations(many)).toHaveLength(250);
    expect(sent).toHaveLength(3);
  });
});
