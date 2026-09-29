import { configUrl, modelUrl, type NaturalVoice } from './catalog';

/**
 * Downloaded voice models live in their own Cache Storage bucket (never
 * touched by the app-shell service worker's clean-up), so a voice
 * downloaded once keeps working offline and across updates.
 */
export const VOICE_CACHE = 'navweather-voices-v1';

function cacheStorage(): CacheStorage | null {
  return typeof caches !== 'undefined' ? caches : null;
}

export async function isVoiceStored(v: NaturalVoice): Promise<boolean> {
  const cs = cacheStorage();
  if (!cs) return false;
  try {
    const c = await cs.open(VOICE_CACHE);
    return !!(await c.match(modelUrl(v))) && !!(await c.match(configUrl(v)));
  } catch {
    return false;
  }
}

export async function removeVoice(v: NaturalVoice): Promise<void> {
  const cs = cacheStorage();
  if (!cs) return;
  const c = await cs.open(VOICE_CACHE);
  await Promise.all([c.delete(modelUrl(v)), c.delete(configUrl(v))]);
}

/** Fetch with a byte-level progress callback (0…1; estimated when the size isn't sent). */
async function fetchWithProgress(url: string, expectedBytes: number, onProgress: (f: number) => void, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || expectedBytes;
  const reader = res.body.getReader();
  const parts: BlobPart[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress(Math.min(0.99, loaded / total));
  }
  return new Blob(parts, { type: res.headers.get('content-type') ?? 'application/octet-stream' });
}

/**
 * Download a voice (config + model) into the voice cache, plus the speech
 * runtime files so the first offline use works too. Resolves when stored.
 */
export async function downloadVoice(
  v: NaturalVoice,
  runtimeUrls: string[],
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const cs = cacheStorage();
  if (!cs) throw new Error('This browser cannot store voices');
  // Ask the browser to keep it (best effort; it may still evict under pressure).
  void navigator.storage?.persist?.().catch(() => false);
  const configRes = await fetch(configUrl(v), { signal, mode: 'cors', credentials: 'omit' });
  if (!configRes.ok) throw new Error(`Download failed (${configRes.status})`);
  const configBody = await configRes.text();
  JSON.parse(configBody); // a broken download must not be stored
  const model = await fetchWithProgress(modelUrl(v), v.sizeMB * 1_000_000, (f) => onProgress(f * 0.9), signal);
  if (model.size < 1_000_000) throw new Error('Voice model looks incomplete');
  // Runtime (same origin, immutable hashed files): fetched once so the HTTP cache /
  // service worker has it for offline use.
  let done = 0;
  await Promise.all(
    runtimeUrls.map((u) =>
      fetch(u, { signal }).then(async (r) => {
        if (!r.ok) throw new Error(`Download failed (${r.status})`);
        await r.arrayBuffer();
        onProgress(0.9 + (0.1 * ++done) / runtimeUrls.length);
      }),
    ),
  );
  const c = await cs.open(VOICE_CACHE);
  await c.put(configUrl(v), new Response(configBody, { headers: { 'content-type': 'application/json' } }));
  await c.put(modelUrl(v), new Response(model, { headers: { 'content-type': 'application/octet-stream' } }));
  onProgress(1);
}

/** The stored voice (config JSON text + model bytes); null when not downloaded. */
export async function readVoice(v: NaturalVoice): Promise<{ config: unknown; model: ArrayBuffer } | null> {
  const cs = cacheStorage();
  if (!cs) return null;
  const c = await cs.open(VOICE_CACHE);
  const [cfg, model] = await Promise.all([c.match(configUrl(v)), c.match(modelUrl(v))]);
  if (!cfg || !model) return null;
  return { config: await cfg.json(), model: await model.arrayBuffer() };
}
