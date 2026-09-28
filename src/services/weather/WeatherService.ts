import { matchForecastToTime } from '../../algorithms/weatherMatching';
import type { LocationForecast, WeatherAtTime } from '../../types/weather';
import { spatialKey, TtlCache } from '../../utils/cache';
import { HOUR_MS } from '../../utils/time';
import { isAbortError, ProviderError } from '../http';
import type { ForecastLocation, WeatherProvider } from './WeatherProvider';

export interface WeatherServiceOptions {
  ttlMs: number;
  batchSize: number;
  resolutionDeg: number;
  maxEntries: number;
  minForecastHours: number;
  /** Minimum interval between "is there a newer model run?" checks. */
  updateCheckMs?: number;
  now?: () => number;
}

export interface ForecastQuery {
  latitude: number;
  longitude: number;
}

export interface ForecastLookup {
  /** Forecast per spatial key (fresh or, on failure, stale). */
  forecasts: Map<string, LocationForecast>;
  /** Keys served from stale cache because the provider failed. */
  staleKeys: Set<string>;
  /** Keys with no forecast at all. */
  missingKeys: Set<string>;
  /** Provider error, if any request failed. */
  error?: ProviderError;
  /** Number of locations actually requested from the provider. */
  requestedCount: number;
  /** Number of HTTP requests made (after batching). */
  requestCount: number;
}

/**
 * Weather access layer. Guarantees:
 *  - never one request per coordinate: points are snapped to a spatial grid,
 *    deduplicated, and batched (many locations per HTTP request);
 *  - fresh cache entries are reused (configurable TTL);
 *  - concurrent lookups for the same location share one in-flight request;
 *  - on provider failure, stale cached data is returned and flagged;
 *  - each cached forecast records the model-run time it was based on
 *    (`forecastGeneratedAt`), so newer upstream runs can trigger a refresh.
 */
export class WeatherService {
  private cache: TtlCache<LocationForecast>;
  /** Counters for development diagnostics (no locations recorded). */
  readonly stats = { lookups: 0, cacheHits: 0, sharedInflight: 0, fetchedLocations: 0, httpRequests: 0, failures: 0, staleServed: 0, lastRequestMs: 0 };
  private inflight = new Map<string, { promise: Promise<LocationForecast>; signal?: AbortSignal }>();
  private now: () => number;
  /** Newest upstream model run we know of, and when we last asked. */
  private latestUpdate: { value: number | null; checkedAt: number } | null = null;
  private latestUpdatePending: Promise<number | null> | null = null;

  constructor(
    private provider: WeatherProvider,
    private opts: WeatherServiceOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.cache = new TtlCache<LocationForecast>(opts.ttlMs, opts.maxEntries, this.now);
  }

  get providerName(): string {
    return this.provider.name;
  }

  keyFor(latitude: number, longitude: number): string {
    return spatialKey(latitude, longitude, this.opts.resolutionDeg);
  }

  /** Last fetch time for a key (fresh or stale), for "Updated N min ago". */
  fetchedAt(key: string): number | undefined {
    return this.cache.peek(key)?.value.fetchedAt;
  }

  clear(): void {
    this.cache.clear();
    this.latestUpdate = null;
  }

  /**
   * Newest upstream forecast availability time (UTC ms), asked at most every
   * `updateCheckMs`. Null when the provider doesn't expose it.
   */
  async latestUpdateTime(): Promise<number | null> {
    if (!this.provider.getLatestUpdateTime) return null;
    const maxAge = this.opts.updateCheckMs ?? 10 * 60000;
    if (this.latestUpdate && this.now() - this.latestUpdate.checkedAt < maxAge) return this.latestUpdate.value;
    if (!this.latestUpdatePending) {
      this.latestUpdatePending = this.provider
        // No caller signal: this check is shared and must not be cancelled by one caller.
        .getLatestUpdateTime()
        .catch(() => null)
        .then((value) => {
          // Keep the last known value if this check failed.
          const v = value ?? this.latestUpdate?.value ?? null;
          this.latestUpdate = { value: v, checkedAt: this.now() };
          return v;
        })
        .finally(() => (this.latestUpdatePending = null));
    }
    return this.latestUpdatePending;
  }

  /**
   * Has a newer forecast become available than the one behind any of these
   * forecasts? (Unknown generation times count as "not newer".)
   */
  async hasNewerForecast(forecasts: Iterable<LocationForecast>): Promise<boolean> {
    const latest = await this.latestUpdateTime();
    if (latest === null) return false;
    for (const f of forecasts) {
      if (f.forecastGeneratedAt !== undefined && latest > f.forecastGeneratedAt) return true;
    }
    return false;
  }

  async getForecasts(
    points: ForecastQuery[],
    options: { needUntilMs?: number; force?: boolean; signal?: AbortSignal } = {},
  ): Promise<ForecastLookup> {
    const now = this.now();
    const needUntil = options.needUntilMs ?? now + 6 * HOUR_MS;

    // 1. Spatial dedupe: first point in each grid cell is the representative.
    const unique = new Map<string, ForecastLocation>();
    for (const p of points) {
      const key = this.keyFor(p.latitude, p.longitude);
      if (!unique.has(key)) unique.set(key, { key, latitude: p.latitude, longitude: p.longitude });
    }

    const forecasts = new Map<string, LocationForecast>();
    const staleKeys = new Set<string>();
    const missingKeys = new Set<string>();
    this.stats.lookups += unique.size;
    const waits: Promise<void>[] = [];
    const toFetch: ForecastLocation[] = [];
    const adoptFailed: ForecastLocation[] = [];

    // 2. Cache + in-flight dedupe.
    for (const loc of unique.values()) {
      const cached = options.force ? undefined : this.cache.get(loc.key);
      if (cached && covers(cached, needUntil)) {
        forecasts.set(loc.key, cached);
        this.stats.cacheHits++;
        continue;
      }
      const pending = options.force ? undefined : this.inflight.get(loc.key);
      if (pending && !pending.signal?.aborted) {
        this.stats.sharedInflight++;
        waits.push(
          pending.promise.then(
            (f) => void forecasts.set(loc.key, f),
            () => void adoptFailed.push(loc), // owner failed/aborted → fetch ourselves
          ),
        );
        continue;
      }
      toFetch.push(loc);
    }

    // 3. Batch the rest (learning the current model-run time alongside).
    const generatedAtPromise = toFetch.length ? this.latestUpdateTime() : Promise.resolve(null);
    const forecastHours = this.forecastHoursFor(needUntil, now);
    const batchSize = Math.max(1, Math.min(this.opts.batchSize, this.provider.maxLocationsPerRequest));
    let error: ProviderError | undefined;
    let requestCount = 0;
    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      requestCount++;
      this.stats.httpRequests++;
      this.stats.fetchedLocations += batch.length;
      const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
      const request = this.provider.getForecasts({
        locations: batch,
        forecastHours,
        pastHours: 3,
        signal: options.signal,
      });
      batch.forEach((loc, j) => {
        const p = request.then((list) => {
          const f = list[j];
          if (!f) throw new ProviderError('Missing forecast', 'invalid-response', 'Weather service');
          return { ...f, fetchedAt: this.now() };
        });
        p.catch(() => undefined);
        this.inflight.set(loc.key, { promise: p, signal: options.signal });
      });
      waits.push(
        request.then(
          async (list) => {
            // Freshness is the service's concern: stamp with its own clock.
            if (typeof performance !== 'undefined') this.stats.lastRequestMs = Math.round(performance.now() - startedAt);
            const receivedAt = this.now();
            const generatedAt = await generatedAtPromise;
            list.forEach((raw, j) => {
              const f = { ...raw, fetchedAt: receivedAt, forecastGeneratedAt: raw.forecastGeneratedAt ?? generatedAt ?? undefined };
              this.cache.set(batch[j].key, f, receivedAt);
              forecasts.set(batch[j].key, f);
            });
          },
          (e: unknown) => {
            if (isAbortError(e)) throw e;
            this.stats.failures++;
            error =
              e instanceof ProviderError
                ? e
                : new ProviderError(String((e as Error)?.message ?? e), 'network', 'Weather service');
          },
        ).finally(() => {
          for (const loc of batch) {
            const cur = this.inflight.get(loc.key);
            if (cur && cur.signal === options.signal) this.inflight.delete(loc.key);
          }
        }),
      );
    }

    await Promise.all(waits);

    // Shared requests that were cancelled by their owner: fetch those keys now.
    if (adoptFailed.length && !options.signal?.aborted) {
      const retry = await this.getForecasts(adoptFailed, { ...options, force: true });
      for (const [k, f] of retry.forecasts) forecasts.set(k, f);
      requestCount += retry.requestCount;
      if (retry.error && !error) error = retry.error;
    }

    // 4. Anything still missing: serve stale cache if we have it.
    for (const loc of unique.values()) {
      if (forecasts.has(loc.key)) continue;
      const stale = this.cache.peek(loc.key)?.value;
      if (stale) {
        forecasts.set(loc.key, stale);
        staleKeys.add(loc.key);
        this.stats.staleServed++;
      } else {
        missingKeys.add(loc.key);
      }
    }
    if (!error && missingKeys.size > 0) {
      error = new ProviderError('Weather data temporarily unavailable', 'network', 'Weather service');
    }

    return { forecasts, staleKeys, missingKeys, error, requestedCount: toFetch.length, requestCount };
  }

  /**
   * "What weather will it be at (lat, lon) when I arrive at `arrivalMs`?"
   * Fetches (or reuses) the location's hourly forecast and matches it to the
   * arrival time.
   */
  async getWeatherForArrivalTime(
    latitude: number,
    longitude: number,
    arrivalMs: number,
    signal?: AbortSignal,
  ): Promise<WeatherAtTime | null> {
    const { forecasts } = await this.getForecasts([{ latitude, longitude }], {
      needUntilMs: arrivalMs,
      signal,
    });
    const f = forecasts.get(this.keyFor(latitude, longitude));
    return f ? matchForecastToTime(f, arrivalMs) : null;
  }

  private forecastHoursFor(needUntil: number, now: number): number {
    const needed = Math.ceil((needUntil - now) / HOUR_MS) + 2;
    const rounded = Math.ceil(Math.max(this.opts.minForecastHours, needed) / 24) * 24;
    return Math.min(16 * 24, rounded);
  }
}

function covers(f: LocationForecast, untilMs: number): boolean {
  const last = f.times[f.times.length - 1];
  return last !== undefined && last >= untilMs;
}
