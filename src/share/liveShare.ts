import { create } from 'zustand';
import { latestFix } from '../services/location';
import { currentMessages } from '../state/settings';
import { useAppStore } from '../state/store';
import type { LngLat } from '../types/geo';
import { bearingDelta, haversineM } from '../utils/distance';
import { simplifyLine } from '../utils/simplify';
import { liveUrl } from './links';
import { MAX_ROUTE_POINTS, type ShareTrip, type ShareUpdate } from './protocol';

/**
 * SHARER side of live location. Creates a share on the relay, then publishes
 * the current position (GPS, or the simulated vehicle — flagged as such)
 * plus the trip (destination, ETA, route once) while sharing is on.
 */

export interface LiveShareState {
  /** paused: a share survived a reload — it resumes only when the user says so. */
  status: 'idle' | 'starting' | 'active' | 'paused';
  id: string | null;
  url: string | null;
  expiresAt: number | null;
  name: string;
  /** Last accepted update (relay clock not needed: local ms). */
  lastSentAt: number | null;
  failing: boolean;
  dialogOpen: boolean;
  error: string | null;

  openDialog(): void;
  closeDialog(): void;
  start(opts: { minutes: number; name: string }): Promise<void>;
  /** Abandon a share that is still being created. */
  cancelStart(): void;
  resume(): void;
  stop(opts?: { silent?: boolean }): Promise<void>;
}

const STORAGE_KEY = 'navweather.share.v1';
export const MIN_SEND_INTERVAL_MS = 5000;
const HEARTBEAT_MS = 20_000;
/** Only the share's own id/key/expiry are stored (to stop it after a reload) — never positions. */
interface Stored {
  id: string;
  key: string;
  expiresAt: number;
  name: string;
}

let key: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let last: { at: number; c: LngLat; hdg?: number; tripKey: string } | null = null;
let routeSentFor: string | null = null;
let startAbort: AbortController | null = null;
let paused: Stored | null = null;
/** Consecutive failed updates → back off instead of retrying every second. */
let failures = 0;
let retryAt = 0;

function deleteShare(id: string, k: string) {
  return fetch(`/api/share/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${k}` }, keepalive: true }).catch(() => undefined);
}

function save(v: Stored | null) {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: sharing still works for this page */
  }
}

export const useLiveShare = create<LiveShareState>()((set, get) => ({
  status: 'idle',
  id: null,
  url: null,
  expiresAt: null,
  name: '',
  lastSentAt: null,
  failing: false,
  dialogOpen: false,
  error: null,

  openDialog: () => set({ dialogOpen: true, error: null }),
  closeDialog: () => set({ dialogOpen: false }),

  async start({ minutes, name }) {
    if (get().status !== 'idle') return;
    const ctrl = new AbortController();
    startAbort = ctrl;
    set({ status: 'starting', error: null, name });
    const m = currentMessages();
    const timeout = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minutes, name: name || undefined }),
        signal: ctrl.signal,
      });
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) throw new Error('no-server');
      if (!res.ok) throw new Error('failed');
      const body = (await res.json()) as { id: string; key: string; expiresAt: number };
      // Cancelled while the link was being created: remove it, never publish.
      if (startAbort !== ctrl || get().status !== 'starting') {
        void deleteShare(body.id, body.key);
        return;
      }
      activate({ id: body.id, key: body.key, expiresAt: body.expiresAt, name });
    } catch (e) {
      if (startAbort !== ctrl) return; // cancelled by the user
      set({ status: 'idle', error: (e as Error).message === 'no-server' ? m.share.noServer : m.share.failed });
    } finally {
      clearTimeout(timeout);
      if (startAbort === ctrl) startAbort = null;
    }
  },

  cancelStart() {
    if (get().status !== 'starting') return;
    startAbort?.abort();
    startAbort = null;
    set({ status: 'idle' });
  },

  resume() {
    if (get().status !== 'paused' || !paused) return;
    const s = paused;
    paused = null;
    if (s.expiresAt <= Date.now()) {
      deactivate();
      return;
    }
    activate(s);
  },

  async stop({ silent = false } = {}) {
    const { id } = get();
    const k = key ?? paused?.key ?? null;
    deactivate();
    if (!silent) useAppStore.getState().showNotice('info', currentMessages().share.ended);
    if (id && k) await deleteShare(id, k); // if this fails, it still expires on its own
  },
}));

function activate(s: Stored) {
  key = s.key;
  last = null;
  routeSentFor = null;
  failures = 0;
  retryAt = 0;
  save(s);
  useLiveShare.setState({ status: 'active', id: s.id, url: liveUrl(s.id), expiresAt: s.expiresAt, name: s.name, failing: false, lastSentAt: null });
  if (timer) clearInterval(timer);
  timer = setInterval(() => void tick(), 1000);
  void tick();
}

function deactivate() {
  if (timer) clearInterval(timer);
  timer = null;
  key = null;
  paused = null;
  last = null;
  routeSentFor = null;
  save(null);
  useLiveShare.setState({ status: 'idle', id: null, url: null, expiresAt: null, lastSentAt: null, failing: false });
}

/**
 * A share started before a reload (same device) that hasn't expired comes
 * back PAUSED: nothing is published until the user resumes it (or stops it).
 */
export function resumeLiveShare() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Stored;
    if (typeof s.id !== 'string' || typeof s.key !== 'string' || !(s.expiresAt > Date.now())) {
      save(null);
      return;
    }
    paused = s;
    useLiveShare.setState({ status: 'paused', id: s.id, url: liveUrl(s.id), expiresAt: s.expiresAt, name: s.name, failing: false, lastSentAt: null });
  } catch {
    save(null);
  }
}

/** What to publish right now: the simulated vehicle, or the device position. */
export function currentShareSource(): { pos: ShareUpdate['pos']; sim: boolean } | null {
  const app = useAppStore.getState();
  if (app.mode === 'simulating' && app.vehicle) {
    const v = app.vehicle;
    return { pos: { c: v.coordinate, hdg: norm(v.headingDeg), spd: v.speedMps, t: Date.now() }, sim: true };
  }
  // The last known fix (with its own timestamp) keeps the heartbeat going when a
  // stationary device stops reporting new positions.
  const fix = app.mode === 'navigating' && app.vehicle ? app.vehicle : latestFix(24 * 3_600_000);
  if (!fix) return null;
  return { pos: { c: fix.coordinate, acc: fix.accuracyM, hdg: norm(fix.headingDeg), spd: fix.speedMps, t: fix.timestampMs }, sim: false };
}

function norm(h: number | undefined): number | undefined {
  return h === undefined || !Number.isFinite(h) ? undefined : ((h % 360) + 360) % 360;
}

/** Destination, ETA and remaining distance whenever a route is set. */
export function currentTrip(): ShareTrip | null {
  const app = useAppStore.getState();
  const plan = app.plan;
  if (!plan) return null;
  const route = plan.timed.route;
  const remM = app.progress ? app.progress.remainingDistanceM : plan.timed.totalDistM;
  return {
    dest: { name: route.destination.name, c: route.destination.coordinate },
    eta: app.derived.arrivalMs ?? undefined,
    remM: Math.round(remM),
    routeId: route.id.replace(/[^A-Za-z0-9:_.-]/g, '').slice(0, 64) || 'route',
  };
}

/**
 * Send when there is something new: moved ≥ 10 m, turned ≥ 20°, trip changed,
 * or a 20 s heartbeat (so viewers can tell "live" from "lost"). Never more
 * often than every 5 s — viewers animate between updates, and this keeps a
 * full day of sharing well inside the free relay's daily request budget.
 */
export function shouldSend(
  prev: { at: number; c: LngLat; hdg?: number; tripKey: string } | null,
  next: { c: LngLat; hdg?: number; tripKey: string },
  now: number,
): boolean {
  if (!prev) return true;
  const dt = now - prev.at;
  if (dt < MIN_SEND_INTERVAL_MS) return false;
  if (dt >= HEARTBEAT_MS) return true;
  if (next.tripKey !== prev.tripKey) return true;
  if (haversineM(prev.c, next.c) >= 10) return true;
  if (prev.hdg !== undefined && next.hdg !== undefined && Math.abs(bearingDelta(prev.hdg, next.hdg)) >= 20) return true;
  return false;
}

async function tick() {
  const s = useLiveShare.getState();
  if (s.status !== 'active' || !s.id || !key || inFlight) return;
  const now = Date.now();
  if (now < retryAt) return;
  if (s.expiresAt && now >= s.expiresAt) {
    deactivate();
    useAppStore.getState().showNotice('info', currentMessages().share.ended);
    return;
  }
  const src = currentShareSource();
  if (!src) return;
  const trip = currentTrip();
  const tripKey = trip ? `${trip.routeId}|${trip.dest.c.join(',')}|${Math.round((trip.eta ?? 0) / 60_000)}` : '';
  if (!shouldSend(last, { c: src.pos.c, hdg: src.pos.hdg, tripKey }, now)) return;

  const update: ShareUpdate = { pos: src.pos, trip, sim: src.sim };
  const app = useAppStore.getState();
  if (trip && trip.routeId !== routeSentFor && app.plan) {
    trip.route = simplifyLine(app.plan.timed.route.geometry, MAX_ROUTE_POINTS);
  }
  inFlight = true;
  try {
    const res = await fetch(`/api/share/${s.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(update),
      // A request stuck on a bad mobile connection must not stall sharing forever.
      signal: timeoutSignal(10_000),
    });
    if (res.status === 404 || res.status === 403) {
      // Expired or stopped elsewhere.
      deactivate();
      useAppStore.getState().showNotice('info', currentMessages().share.ended);
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { needsRoute?: boolean };
    last = { at: now, c: src.pos.c, hdg: src.pos.hdg, tripKey };
    if (trip?.route) routeSentFor = trip.routeId ?? null;
    if (body.needsRoute) routeSentFor = null;
    failures = 0;
    useLiveShare.setState({ lastSentAt: now, failing: false });
  } catch {
    // Back off: 2 s, 4 s, 8 s … up to 30 s between attempts.
    failures++;
    retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** failures);
    useLiveShare.setState({ failing: true });
  } finally {
    inFlight = false;
  }
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}

/** Test helper. */
export function __resetLiveShare() {
  deactivate();
  inFlight = false;
}
