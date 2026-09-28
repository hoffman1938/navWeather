import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyLocationError, locateOnce, LocationError, LocationWatcher, rememberFix, type LocationErrorKind } from './location';

type Ok = (p: GeolocationPosition) => void;
type Err = (e: GeolocationPositionError) => void;

function position(lon: number, lat: number, extra: Partial<GeolocationCoordinates> = {}): GeolocationPosition {
  return {
    coords: { longitude: lon, latitude: lat, accuracy: 20, heading: null, speed: null, altitude: null, altitudeAccuracy: null, ...extra } as GeolocationCoordinates,
    timestamp: Date.now(),
  } as GeolocationPosition;
}
const err = (code: number) => ({ code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError;

function fakeGeo() {
  const watches = new Map<number, { ok: Ok; err: Err; opts?: PositionOptions }>();
  const once: { ok: Ok; err: Err; opts?: PositionOptions }[] = [];
  let n = 0;
  const geo = {
    watchPosition: vi.fn((ok: Ok, e: Err, opts?: PositionOptions) => {
      watches.set(++n, { ok, err: e, opts });
      return n;
    }),
    clearWatch: vi.fn((id: number) => watches.delete(id)),
    getCurrentPosition: vi.fn((ok: Ok, e: Err, opts?: PositionOptions) => {
      once.push({ ok, err: e, opts });
    }),
  };
  return { geo: geo as unknown as Geolocation, watches, once, mock: geo };
}

beforeEach(() => rememberFix(null));

describe('classifyLocationError', () => {
  const geo = {} as Geolocation;
  it('names the fixable cause', () => {
    expect(classifyLocationError(err(1), { secure: true, geo })).toBe('denied');
    expect(classifyLocationError(err(2), { secure: true, geo })).toBe('unavailable');
    expect(classifyLocationError(err(3), { secure: true, geo })).toBe('timeout');
    expect(classifyLocationError(null, { secure: true, geo: undefined })).toBe('unsupported');
  });
  it('an insecure page (http on a LAN IP) is reported as such, not as "denied"', () => {
    expect(classifyLocationError(err(1), { secure: false, geo })).toBe('insecure');
  });
});

describe('LocationWatcher', () => {
  function setup() {
    const g = fakeGeo();
    const fixes: number[][] = [];
    const errors: [LocationErrorKind, boolean][] = [];
    const w = new LocationWatcher(
      { onFix: (f) => fixes.push(f.coordinate), onError: (k, had) => errors.push([k, had]) },
      () => ({ secure: true, geo: g.geo }),
    );
    return { ...g, w, fixes, errors };
  }

  it('shares one watch; precision follows the most demanding user', () => {
    const t = setup();
    t.w.acquire('locate');
    expect(t.mock.watchPosition).toHaveBeenCalledTimes(1);
    expect([...t.watches.values()][0].opts?.enableHighAccuracy).toBe(false);
    t.w.acquire('navigate');
    expect(t.watches.size).toBe(1);
    expect([...t.watches.values()][0].opts?.enableHighAccuracy).toBe(true);
    t.w.acquire('locate'); // idempotent
    expect(t.mock.watchPosition).toHaveBeenCalledTimes(2);
    t.w.release('navigate');
    expect([...t.watches.values()][0].opts?.enableHighAccuracy).toBe(false);
    t.w.release('locate');
    expect(t.watches.size).toBe(0);
    expect(t.w.watching).toBe(false);
  });

  it('delivers fixes and reports errors with whether positions were flowing', () => {
    const t = setup();
    t.w.acquire('share');
    const watch = [...t.watches.values()][0];
    watch.err(err(1));
    expect(t.errors).toEqual([['denied', false]]);
    watch.ok(position(44.8, 41.7));
    expect(t.fixes).toEqual([[44.8, 41.7]]);
    watch.err(err(2));
    expect(t.errors.at(-1)).toEqual(['unavailable', true]);
  });

  it('a precise watch that times out before any fix quietly continues with Wi-Fi positioning', () => {
    const t = setup();
    t.w.acquire('navigate');
    [...t.watches.values()][0].err(err(3));
    expect(t.errors).toEqual([]);
    expect(t.watches.size).toBe(1);
    expect([...t.watches.values()][0].opts?.enableHighAccuracy).toBe(false);
  });

  it('reports insecure pages without calling the API', () => {
    const g = fakeGeo();
    const errors: LocationErrorKind[] = [];
    const w = new LocationWatcher({ onFix: () => undefined, onError: (k) => errors.push(k) }, () => ({ secure: false, geo: g.geo }));
    w.acquire('locate');
    expect(errors).toEqual(['insecure']);
    expect(g.mock.watchPosition).not.toHaveBeenCalled();
  });
});

describe('locateOnce', () => {
  it('tries a quick network fix, then a precise one when that times out', async () => {
    const g = fakeGeo();
    const p = locateOnce({ secure: true, geo: g.geo });
    expect(g.once[0].opts?.enableHighAccuracy).toBe(false);
    g.once[0].err(err(3));
    await Promise.resolve();
    await Promise.resolve();
    expect(g.once[1].opts?.enableHighAccuracy).toBe(true);
    g.once[1].ok(position(41.63, 41.64));
    await expect(p).resolves.toMatchObject({ coordinate: [41.63, 41.64] });
    // …and remembers it: the next call needs no new request.
    await expect(locateOnce({ secure: true, geo: g.geo })).resolves.toMatchObject({ coordinate: [41.63, 41.64] });
    expect(g.mock.getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it('rejects with the specific reason', async () => {
    const g = fakeGeo();
    const p = locateOnce({ secure: true, geo: g.geo });
    g.once[0].err(err(1));
    await expect(p).rejects.toEqual(new LocationError('denied'));
    await expect(locateOnce({ secure: false, geo: g.geo })).rejects.toMatchObject({ kind: 'insecure' });
  });
});
