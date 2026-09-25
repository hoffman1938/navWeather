import { fetchJson, isAbortError, ProviderError, RateLimiter } from './http';

/**
 * Shared Overpass client. The public servers allow very few concurrent
 * requests per client (they answer 429 otherwise), so every Overpass query in
 * the app goes through ONE sequential queue, with endpoint fallback.
 */
const queue = new RateLimiter(1000);

export async function overpassQuery<T>(
  endpoints: string[],
  query: string,
  opts: { provider: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<T> {
  return queue.schedule(async () => {
    let lastError: unknown;
    for (const endpoint of endpoints) {
      if (opts.signal?.aborted) throw new ProviderError('Request aborted', 'aborted', opts.provider);
      try {
        return await fetchJson<T>(endpoint, {
          provider: opts.provider,
          signal: opts.signal,
          timeoutMs: opts.timeoutMs ?? 15000,
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ data: query }).toString(),
          },
        });
      } catch (e) {
        if (isAbortError(e)) throw e;
        lastError = e;
      }
    }
    throw lastError instanceof ProviderError ? lastError : new ProviderError(`${opts.provider} unavailable`, 'network', opts.provider);
  });
}
