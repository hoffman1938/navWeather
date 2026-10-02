import { config } from '../config';
import type { LngLat } from '../types/geo';

/**
 * Device location. One watcher shared by everything that needs position
 * ("show my location", navigation, live sharing), with failures classified
 * so the UI can say exactly what to fix. Fixes live in memory only.
 */

export type LocationErrorKind = 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'timeout';
export type LocationReason = 'locate' | 'navigate' | 'share';

export interface LocationFix {
  coordinate: LngLat;
  accuracyM?: number;
  headingDeg?: number;
  speedMps?: number;
  timestampMs: number;
}

export class LocationError extends Error {
  constructor(readonly kind: LocationErrorKind) {
    super(`location-${kind}`);
  }
}

interface Env {
  secure: boolean;
  geo: Geolocation | undefined;
}

function defaultEnv(): Env {
  return {
    secure: typeof window === 'undefined' || window.isSecureContext !== false,
    geo: typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : undefined,
  };
}

/** Browsers only expose location on https (or localhost). Chrome reports that as "denied". */
export function classifyLocationError(err: { code: number } | null, env: Pick<Env, 'secure' | 'geo'> = defaultEnv()): LocationErrorKind {
  if (!env.secure) return 'insecure';
  if (!env.geo || !err) return 'unsupported';
  if (err.code === 1) return 'denied';
  if (err.code === 3) return 'timeout';
  return 'unavailable';
}

export function toFix(p: GeolocationPosition): LocationFix {
  const { longitude, latitude, accuracy, heading, speed } = p.coords;
  return {
    coordinate: [longitude, latitude],
    accuracyM: Number.isFinite(accuracy) ? accuracy : undefined,
    headingDeg: heading !== null && Number.isFinite(heading) ? heading : undefined,
    speedMps: speed !== null && Number.isFinite(speed) ? speed : undefined,
    timestampMs: p.timestamp || Date.now(),
  };
}

let lastFix: LocationFix | null = null;

/** Most recent fix from any source, if not older than `maxAgeMs`. */
export function latestFix(maxAgeMs = 60_000): LocationFix | null {
  return lastFix && Date.now() - lastFix.timestampMs <= maxAgeMs ? lastFix : null;
}
export function rememberFix(fix: LocationFix | null) {
  lastFix = fix;
}

/**
 * One position, fast: a recent cached/network fix first (Wi-Fi is enough to
 * start a route), then a precise (GPS) attempt if that times out or can't
 * work out a position — phones with Wi-Fi scanning off, desktops whose
 * network lookup fails.
 */
export function locateOnce(env: Env = defaultEnv(), signal?: AbortSignal): Promise<LocationFix> {
  const recent = latestFix(60_000);
  if (recent) return Promise.resolve(recent);
  if (!env.secure || !env.geo) return Promise.reject(new LocationError(classifyLocationError(null, env)));
  const geo = env.geo;
  // Browsers start the API timeout only after permission is granted; an ignored
  // prompt would otherwise wait forever.
  const overall = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new LocationError('timeout')), LOCATE_OVERALL_MS);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
  overall.catch(() => undefined);
  const attempt = (opts: PositionOptions) =>
    new Promise<LocationFix>((resolve, reject) =>
      geo.getCurrentPosition(
        (p) => resolve(toFix(p)),
        (e) => reject(new LocationError(classifyLocationError(e, env))),
        opts,
      ),
    );
  const located = attempt({ enableHighAccuracy: false, maximumAge: 120_000, timeout: 10_000 })
    .catch((e: LocationError) =>
      e.kind === 'timeout' || e.kind === 'unavailable' ? attempt({ enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }) : Promise.reject(e),
    )
    .then((fix) => {
      rememberFix(fix);
      return fix;
    });
  return Promise.race([located, overall]);
}

/** Upper bound for a one-shot position, including an unanswered permission prompt. */
const LOCATE_OVERALL_MS = 35_000;

export interface ApproximateLocation {
  coordinate: LngLat;
  city: string | null;
}

let approx: { at: number; value: ApproximateLocation } | null = null;
/** The device just couldn't give a position: don't make the next tap wait for the same failure. */
let failed: { at: number; kind: LocationErrorKind } | null = null;
const FAILED_MS = 60_000;
const SLOW_FAILURES: LocationErrorKind[] = ['timeout', 'unavailable'];

/**
 * The connection's rough area (city level), from our own Worker — for when the
 * device can't give a position at all (location off or blocked, no GPS on a
 * desktop), so a trip can still start from the right city. Asks nothing of
 * the device and involves no third party; kept in memory for 10 minutes.
 */
export async function approximateLocation(signal?: AbortSignal): Promise<ApproximateLocation> {
  if (approx && Date.now() - approx.at < 10 * 60_000) return approx.value;
  const res = await fetch(config.endpoints.whereami, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`whereami ${res.status}`);
  const b = (await res.json()) as { lat?: unknown; lon?: unknown; city?: unknown };
  const lat = Number(b.lat);
  const lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('whereami: no position');
  const value = { coordinate: [lon, lat] as LngLat, city: typeof b.city === 'string' && b.city.trim() ? b.city.trim().slice(0, 80) : null };
  approx = { at: Date.now(), value };
  return value;
}

/**
 * Where a trip from "Your location" starts: the device's position, else —
 * location off, blocked or unavailable — the connection's rough area
 * (`approximate` says so, with the reason). Rejects with the device's
 * LocationError only when neither works.
 */
export async function tripStart(
  signal?: AbortSignal,
  env?: Env,
): Promise<{ coordinate: LngLat; approximate: { city: string | null; reason: LocationErrorKind } | null }> {
  try {
    if (failed && Date.now() - failed.at < FAILED_MS && !latestFix(60_000)) throw new LocationError(failed.kind);
    const fix = await locateOnce(env, signal);
    failed = null;
    return { coordinate: fix.coordinate, approximate: null };
  } catch (e) {
    if (!(e instanceof LocationError)) throw e;
    // Only remember failures that took time (no signal yet). A refusal is instant and free to ask again —
    // and remembering it would keep saying "blocked" for a minute after the user allows location.
    if (SLOW_FAILURES.includes(e.kind) && (!failed || Date.now() - failed.at >= FAILED_MS)) failed = { at: Date.now(), kind: e.kind };
    else if (!SLOW_FAILURES.includes(e.kind)) failed = null;
    try {
      const a = await approximateLocation(signal);
      return { coordinate: a.coordinate, approximate: { city: a.city, reason: e.kind } };
    } catch (e2) {
      if (signal?.aborted) throw e2;
      throw e;
    }
  }
}

/** The browser's location permission changed (e.g. the user just allowed it): forget old failures. */
export function forgetLocationFailure() {
  failed = null;
}

/** Test helper. */
export function __resetApproximate() {
  approx = null;
  failed = null;
}

export interface WatcherHandlers {
  onFix(fix: LocationFix): void;
  /** `hadFix`: the watch already produced positions (the error is likely transient). */
  onError(kind: LocationErrorKind, hadFix: boolean): void;
}

/**
 * Reference-counted watchPosition. Navigation and sharing ask for GPS-grade
 * accuracy; "show my location" alone is happy with Wi-Fi positioning. A
 * precise watch that times out before its first fix falls back to a coarse
 * one (desktops without GPS).
 */
export class LocationWatcher {
  private reasonSet = new Set<LocationReason>();
  private watchId: number | null = null;
  private precise = false;
  private coarseFallback = false;
  private preciseRetry = false;
  private hadFix = false;

  constructor(
    private handlers: WatcherHandlers,
    private env: () => Env = defaultEnv,
  ) {}

  has(reason: LocationReason): boolean {
    return this.reasonSet.has(reason);
  }
  get watching(): boolean {
    return this.watchId !== null;
  }
  /** For diagnostics. */
  get reasons(): LocationReason[] {
    return [...this.reasonSet];
  }

  acquire(reason: LocationReason) {
    if (this.reasonSet.has(reason)) return;
    this.reasonSet.add(reason);
    // A new drive or share deserves a fresh attempt at GPS precision.
    if (reason !== 'locate') this.coarseFallback = false;
    this.sync();
  }

  release(reason: LocationReason) {
    if (!this.reasonSet.delete(reason)) return;
    this.sync();
  }

  releaseAll() {
    this.reasonSet.clear();
    this.sync();
  }

  private sync() {
    if (!this.reasonSet.size) {
      this.stop();
      this.coarseFallback = false;
      this.preciseRetry = false;
      return;
    }
    const precise = (this.reasonSet.has('navigate') || this.reasonSet.has('share')) && !this.coarseFallback;
    if (this.watchId !== null && precise === this.precise) return;
    this.stop();
    this.start(precise);
  }

  private start(precise: boolean) {
    const env = this.env();
    if (!env.secure || !env.geo) {
      this.handlers.onError(classifyLocationError(null, env), false);
      return;
    }
    this.precise = precise;
    this.watchId = env.geo.watchPosition(
      (p) => {
        this.hadFix = true;
        const fix = toFix(p);
        rememberFix(fix);
        this.handlers.onFix(fix);
      },
      (e) => {
        const kind = classifyLocationError(e, env);
        if (kind === 'timeout' && this.precise && !this.hadFix) {
          // No GPS fix in time (typical on desktops): continue with Wi-Fi positioning.
          this.coarseFallback = true;
          this.stop();
          this.start(false);
          return;
        }
        if (kind === 'unavailable' && !this.precise && !this.hadFix && !this.preciseRetry) {
          // No network position (Wi-Fi scanning off, a desktop lookup that failed): try the GPS once.
          this.preciseRetry = true;
          this.stop();
          this.start(true);
          return;
        }
        this.handlers.onError(kind, this.hadFix);
      },
      { enableHighAccuracy: precise, maximumAge: precise ? 2000 : 30_000, timeout: precise ? 20_000 : 15_000 },
    );
  }

  private stop() {
    if (this.watchId !== null) this.env().geo?.clearWatch(this.watchId);
    this.watchId = null;
    this.hadFix = false;
  }
}
