export type ProviderErrorKind =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'http'
  | 'rate-limited'
  | 'invalid-response'
  | 'not-found'
  | 'no-route';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: ProviderErrorKind,
    public readonly provider: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof ProviderError && e.kind === 'aborted') ||
    (e instanceof DOMException && e.name === 'AbortError')
  );
}

export interface FetchJsonOptions {
  provider: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  init?: RequestInit;
}

/** fetch + JSON with timeout, abort propagation and normalized errors. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const { provider, signal, timeoutMs = 15000, init } = opts;
  if (signal?.aborted) throw new ProviderError('Request aborted', 'aborted', provider);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
      if (timedOut) throw new ProviderError(`${provider} request timed out`, 'timeout', provider);
      if (signal?.aborted) throw new ProviderError('Request aborted', 'aborted', provider);
      throw new ProviderError(`${provider} is unreachable (${(e as Error)?.message ?? 'network error'})`, 'network', provider);
    }
    if (res.status === 429) {
      throw new ProviderError(`${provider} rate limit reached`, 'rate-limited', provider, 429);
    }
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      throw new ProviderError(
        `${provider} responded ${res.status}${detail ? `: ${detail}` : ''}`,
        'http',
        provider,
        res.status,
      );
    }
    try {
      return (await res.json()) as T;
    } catch {
      if (timedOut) throw new ProviderError(`${provider} request timed out`, 'timeout', provider);
      if (signal?.aborted) throw new ProviderError('Request aborted', 'aborted', provider);
      throw new ProviderError(`${provider} returned invalid JSON`, 'invalid-response', provider);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Serializes calls so consecutive requests start at least `minIntervalMs`
 * apart (e.g. Nominatim's 1 request/second usage policy).
 */
export class RateLimiter {
  private chain: Promise<unknown> = Promise.resolve();
  private lastStart = 0;

  constructor(
    private minIntervalMs: number,
    private now: () => number = Date.now,
  ) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.lastStart + this.minIntervalMs - this.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastStart = this.now();
      return fn();
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }
}

/** Run async tasks with bounded concurrency, preserving result order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
