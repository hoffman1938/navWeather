/**
 * Small in-memory TTL cache with LRU eviction. Deliberately memory-only:
 * weather cache keys encode places along the user's route, and we do not
 * persist travel history.
 */
export interface CacheEntry<T> {
  key: string;
  value: T;
  storedAt: number;
}

export class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries = 500,
    private now: () => number = Date.now,
  ) {}

  get ttl(): number {
    return this.ttlMs;
  }

  /** Returns the entry even if stale (callers decide what to do with stale data). */
  peek(key: string): CacheEntry<T> | undefined {
    return this.map.get(key);
  }

  /** Fresh value or undefined. Touches the entry for LRU. */
  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.isStale(entry)) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  isStale(entry: CacheEntry<T>): boolean {
    return this.now() - entry.storedAt >= this.ttlMs;
  }

  set(key: string, value: T, storedAt = this.now()): void {
    this.map.delete(key);
    this.map.set(key, { key, value, storedAt });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * Spatial cache key: coordinates snapped to a grid of `resolutionDeg`.
 * 41.98231,44.11242 and 41.98252,44.11261 share a key at 0.02°.
 */
export function spatialKey(lat: number, lon: number, resolutionDeg: number): string {
  const decimals = Math.max(0, Math.ceil(-Math.log10(resolutionDeg)) + 1);
  const snap = (v: number) => (Math.round(v / resolutionDeg) * resolutionDeg).toFixed(decimals);
  return `${snap(lat)},${snap(lon)}`;
}
