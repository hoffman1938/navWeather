/// <reference lib="webworker" />
/**
 * On-device speech (Piper): text → phonemes (eSpeak NG, WebAssembly) →
 * audio (the voice's ONNX model in ONNX Runtime, WebAssembly). Runs off the
 * main thread so the map and guidance never stutter while it speaks.
 */
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import * as ort from 'onnxruntime-web/wasm';
import { NATURAL_VOICES, parsePiperConfig, type PiperConfig } from './catalog';
import type { Locale } from '../../i18n';
import { readVoice } from './storage';

export type WorkerRequest =
  | { type: 'init'; ortMjs: string; ortWasm: string; phonemizeWasm: string; phonemizeData: string }
  | { type: 'load'; id: number; locale: Locale }
  | { type: 'synth'; id: number; locale: Locale; text: string };

export type WorkerResponse =
  | { type: 'loaded'; id: number }
  | { type: 'audio'; id: number; pcm: Float32Array; sampleRate: number }
  | { type: 'error'; id: number; message: string };

let urls: { ortWasm: string; phonemizeWasm: string; phonemizeData: string } | null = null;
interface LoadedVoice {
  locale: Locale;
  config: PiperConfig;
  session: ort.InferenceSession;
}
let voice: LoadedVoice | null = null;
let loading: Promise<LoadedVoice> | null = null;

// eSpeak NG prints one JSON line per input: { phoneme_ids: [...] }.
let printed: string[] = [];
let phonemizer: ReturnType<typeof createPiperPhonemize> | null = null;

function getPhonemizer() {
  if (!urls) throw new Error('not initialised');
  const u = urls;
  phonemizer ??= createPiperPhonemize({
    print: (line) => printed.push(line),
    printErr: () => undefined,
    locateFile: (f) => (f.endsWith('.wasm') ? u.phonemizeWasm : f.endsWith('.data') ? u.phonemizeData : f),
  });
  return phonemizer;
}

export async function phonemize(text: string, espeakVoice: string): Promise<number[]> {
  const mod = await getPhonemizer();
  printed = [];
  mod.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  const ids: number[] = [];
  for (const line of printed) {
    try {
      const o = JSON.parse(line) as { phoneme_ids?: unknown };
      if (Array.isArray(o.phoneme_ids)) ids.push(...o.phoneme_ids.filter((x): x is number => Number.isInteger(x)));
    } catch {
      /* not a result line */
    }
  }
  if (!ids.length) throw new Error('No phonemes');
  return ids;
}

async function load(locale: Locale): Promise<LoadedVoice> {
  if (voice?.locale === locale) return voice;
  if (loading) {
    const v = await loading.catch(() => null);
    if (v?.locale === locale) return v;
  }
  loading = (async (): Promise<LoadedVoice> => {
    const stored = await readVoice(NATURAL_VOICES[locale]);
    if (!stored) throw new Error('Voice not downloaded');
    const config = parsePiperConfig(stored.config);
    const session = await ort.InferenceSession.create(stored.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    await voice?.session.release().catch(() => undefined);
    const loaded: LoadedVoice = { locale, config, session };
    voice = loaded;
    return loaded;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function synth(locale: Locale, text: string): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const v = await load(locale);
  const ids = await phonemize(text, v.config.espeakVoice);
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([v.config.noiseScale, v.config.lengthScale, v.config.noiseW]), [3]),
  };
  if (v.config.multiSpeaker) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const out = await v.session.run(feeds);
  const data = (out.output ?? Object.values(out)[0]).data;
  if (!(data instanceof Float32Array) || !data.length) throw new Error('No audio');
  // A copy we can transfer (the tensor's buffer belongs to the runtime).
  return { pcm: new Float32Array(data), sampleRate: v.config.sampleRate };
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    urls = { ortWasm: msg.ortWasm, phonemizeWasm: msg.phonemizeWasm, phonemizeData: msg.phonemizeData };
    // Single thread: threads need cross-origin isolation, which would block the map tiles.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { mjs: msg.ortMjs, wasm: msg.ortWasm };
    return;
  }
  try {
    if (msg.type === 'load') {
      await load(msg.locale);
      await getPhonemizer();
      scope.postMessage({ type: 'loaded', id: msg.id } satisfies WorkerResponse);
    } else if (msg.type === 'synth') {
      const { pcm, sampleRate } = await synth(msg.locale, msg.text);
      scope.postMessage({ type: 'audio', id: msg.id, pcm, sampleRate } satisfies WorkerResponse, [pcm.buffer]);
    }
  } catch (err) {
    scope.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
  }
};
