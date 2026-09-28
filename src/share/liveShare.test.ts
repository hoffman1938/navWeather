import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberFix } from '../services/location';
import { setProviders } from '../services/providers';
import { useSettings } from '../state/settings';
import { __resetStoreRuntime, useAppStore } from '../state/store';
import { installFakeProviders } from '../test/harness';
import { simplifyLine } from '../utils/simplify';
import { __resetLiveShare, currentShareSource, shouldSend, useLiveShare } from './liveShare';
import type { ShareUpdate } from './protocol';

const BASE = Date.UTC(2026, 8, 27, 4, 0);
const initialApp = useAppStore.getState();

describe('publishing cadence', () => {
  const p = { at: 0, c: [44.8, 41.7] as [number, number], hdg: 90, tripKey: '' };
  it('first update immediately; then only when something changed, never faster than 5 s', () => {
    expect(shouldSend(null, { c: p.c, tripKey: '' }, 0)).toBe(true);
    expect(shouldSend(p, { c: [44.81, 41.7], tripKey: '' }, 4000)).toBe(false); // too soon
    expect(shouldSend(p, { c: [44.81, 41.7], tripKey: '' }, 5000)).toBe(true); // moved ~800 m
    expect(shouldSend(p, { c: [44.80005, 41.7], hdg: 92, tripKey: '' }, 8000)).toBe(false); // ~4 m, 2°
    expect(shouldSend(p, { c: p.c, hdg: 130, tripKey: '' }, 8000)).toBe(true); // turned
    expect(shouldSend(p, { c: p.c, hdg: 90, tripKey: 'r1' }, 8000)).toBe(true); // new trip / ETA
    expect(shouldSend(p, { c: p.c, hdg: 90, tripKey: '' }, 19_000)).toBe(false);
    expect(shouldSend(p, { c: p.c, hdg: 90, tripKey: '' }, 20_000)).toBe(true); // heartbeat
  });
});

describe('route simplification', () => {
  it('caps the geometry and keeps endpoints', () => {
    const line = Array.from({ length: 5000 }, (_, i) => [44 + i * 0.001, 41.7 + Math.sin(i / 50) * 0.05] as [number, number]);
    const out = simplifyLine(line, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out[0]).toEqual(line[0]);
    expect(out.at(-1)).toEqual(line.at(-1));
  });
});

describe('sharer', () => {
  let puts: { body: ShareUpdate; auth: string | null }[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let putStatus = 200;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(BASE);
    __resetStoreRuntime();
    __resetLiveShare();
    rememberFix(null);
    useAppStore.setState(initialApp, true);
    useSettings.getState().reset();
    useSettings.getState().update({ language: 'en', units: { distance: 'metric', temperature: 'c', wind: 'kmh' } });
    installFakeProviders(BASE);
    puts = [];
    putStatus = 200;
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/share' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'AAAAAAAAAAAAAAAAAAAAAA', key: 'secret', expiresAt: BASE + 3_600_000 }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as ShareUpdate;
        puts.push({ body, auth: new Headers(init.headers).get('Authorization') });
        return new Response(JSON.stringify({ ok: true, needsRoute: false }), { status: putStatus, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    __resetLiveShare();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setProviders(null);
  });

  async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('shares the simulated drive — flagged as simulated — with destination, ETA and the route once', async () => {
    const s = useAppStore.getState();
    s.setOriginText('Tbilisi');
    s.setDestinationText('Batumi');
    useAppStore.setState({ departure: { mode: 'at', utcMs: BASE } });
    await useAppStore.getState().calculateRoute();
    useAppStore.getState().startSimulation();

    await useLiveShare.getState().start({ minutes: 60, name: 'Gio' });
    expect(useLiveShare.getState()).toMatchObject({ status: 'active', url: expect.stringMatching(/\/live\/AAAAAAAAAAAAAAAAAAAAAA$/) });
    await vi.waitFor(() => expect(puts.length).toBe(1), { timeout: 4000 });
    const first = puts[0];
    expect(first.auth).toBe('Bearer secret');
    expect(first.body.sim).toBe(true);
    expect(first.body.trip).toMatchObject({ dest: { name: 'Batumi' }, remM: expect.any(Number), eta: expect.any(Number) });
    expect(first.body.trip!.route!.length).toBeGreaterThan(10);
    expect(first.body.trip!.route!.length).toBeLessThanOrEqual(500);

    // Drive on; the next update carries the new position but not the route again.
    for (let i = 0; i < 20; i++) useAppStore.getState().advanceSimulationBy(1000);
    vi.setSystemTime(BASE + 6000);
    vi.advanceTimersByTime(1000);
    await flush();
    await vi.waitFor(() => expect(puts.length).toBe(2), { timeout: 4000 });
    expect(puts[1].body.pos.c).not.toEqual(first.body.pos.c);
    expect(puts[1].body.trip!.route).toBeUndefined();
  });

  it('shares GPS position when not simulating; stops when the relay says the share is gone', async () => {
    rememberFix({ coordinate: [44.79, 41.71], accuracyM: 12, timestampMs: BASE });
    await useLiveShare.getState().start({ minutes: 60, name: '' });
    await vi.waitFor(() => expect(puts.length).toBe(1), { timeout: 4000 });
    expect(puts[0].body).toMatchObject({ pos: { c: [44.79, 41.71], acc: 12 }, sim: false, trip: null });

    putStatus = 404;
    rememberFix({ coordinate: [44.8, 41.72], timestampMs: BASE + 6000 });
    vi.setSystemTime(BASE + 6000);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(useLiveShare.getState().status).toBe('idle'), { timeout: 4000 });
    expect(useAppStore.getState().notice?.text).toBe('Location sharing ended');
  });

  it('nothing to send before the first fix', () => {
    expect(currentShareSource()).toBeNull();
  });

  it('explains when the relay is missing (static hosting)', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await useLiveShare.getState().start({ minutes: 60, name: '' });
    expect(useLiveShare.getState()).toMatchObject({ status: 'idle', error: expect.stringMatching(/needs the navWeather server/) });
  });
});
