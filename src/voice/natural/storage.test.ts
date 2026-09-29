import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configUrl, modelUrl, NATURAL_VOICES, parsePiperConfig } from './catalog';
import { downloadVoice, isVoiceStored, readVoice, removeVoice, VOICE_CACHE } from './storage';

/** Voice downloads: stored only when complete, with progress, removable. */

class FakeCache {
  store = new Map<string, Response>();
  async match(url: string) {
    return this.store.get(url)?.clone();
  }
  async put(url: string, res: Response) {
    this.store.set(url, res);
  }
  async delete(url: string) {
    return this.store.delete(url);
  }
}

let cache: FakeCache;
const voice = NATURAL_VOICES.ka;
const model = new Uint8Array(3_000_000);
const config = JSON.stringify({ espeak: { voice: 'ka' }, audio: { sample_rate: 22050 }, inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 }, num_speakers: 1 });

function serve(overrides: Record<string, () => Response> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (overrides[url]) return overrides[url]();
      if (url === configUrl(voice)) return new Response(config);
      if (url === modelUrl(voice)) return new Response(model, { headers: { 'content-length': String(model.length) } });
      return new Response('runtime file');
    }),
  );
}

beforeEach(() => {
  // jsdom's Blob isn't readable by Node's Response (browsers have one implementation of both).
  vi.stubGlobal('Blob', NodeBlob);
  cache = new FakeCache();
  vi.stubGlobal('caches', { open: vi.fn(async (name: string) => (name === VOICE_CACHE ? cache : new FakeCache())) });
});
afterEach(() => vi.unstubAllGlobals());

describe('natural voice storage', () => {
  it('downloads from the free voice repository with progress, then reads it back', async () => {
    serve();
    const progress: number[] = [];
    await downloadVoice(voice, ['/assets/ort.wasm', '/assets/phonemize.data'], (f) => progress.push(f));
    expect(modelUrl(voice)).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/ka/ka_GE/natia/medium/ka_GE-natia-medium.onnx');
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);
    expect(await isVoiceStored(voice)).toBe(true);
    const stored = await readVoice(voice);
    expect(stored!.model.byteLength).toBe(model.length);
    expect(parsePiperConfig(stored!.config).espeakVoice).toBe('ka');
    await removeVoice(voice);
    expect(await isVoiceStored(voice)).toBe(false);
  });

  it('stores nothing when the download is broken or incomplete', async () => {
    serve({ [configUrl(voice)]: () => new Response('<html>rate limited</html>') });
    await expect(downloadVoice(voice, [], () => undefined)).rejects.toThrow();
    expect(await isVoiceStored(voice)).toBe(false);

    serve({ [modelUrl(voice)]: () => new Response(new Uint8Array(1000)) });
    await expect(downloadVoice(voice, [], () => undefined)).rejects.toThrow(/incomplete/);
    expect(await isVoiceStored(voice)).toBe(false);

    serve({ [modelUrl(voice)]: () => new Response('gone', { status: 404 }) });
    await expect(downloadVoice(voice, [], () => undefined)).rejects.toThrow();
    expect(await isVoiceStored(voice)).toBe(false);
  });

  it('refuses a voice config without a usable phonemizer voice', () => {
    expect(() => parsePiperConfig({ espeak: { voice: '../../etc' } })).toThrow();
    expect(parsePiperConfig({ espeak: { voice: 'en-us' } })).toMatchObject({ sampleRate: 22050, lengthScale: 1, multiSpeaker: false });
  });
});
