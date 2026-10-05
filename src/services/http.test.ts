import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from './http';

/** fetchJson's timeout: a slow network gives up; a busy page does not throw away an answer that has arrived. */

afterEach(() => vi.unstubAllGlobals());

/** A fetch that answers after `ms` (real timers) and honours its abort signal. */
function fetchAnswering(ms: number) {
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(Response.json({ ok: true })), ms);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }),
  );
}

const busy = (ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* a long task on a slow phone */
  }
};

describe('fetchJson timeouts', () => {
  it('a page too busy to read the answer in time still gets it (the timer fired late, not the network)', async () => {
    fetchAnswering(100);
    const p = fetchJson<{ ok: boolean }>('/x', { provider: 'Test', timeoutMs: 60 });
    busy(1300); // the 60 ms timer can only run ~1.25 s late
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('a network that does not answer in time is a timeout', async () => {
    fetchAnswering(10_000);
    await expect(fetchJson('/x', { provider: 'Test', timeoutMs: 40 })).rejects.toMatchObject({ kind: 'timeout' });
  });
});
