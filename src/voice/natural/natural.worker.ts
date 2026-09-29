/// <reference lib="webworker" />
/**
 * On-device speech (Piper): text → phonemes (eSpeak NG, WebAssembly) →
 * audio (the voice's ONNX model in ONNX Runtime, WebAssembly). Runs off the
 * main thread so the map and guidance never stutter while it speaks.
 */
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import * as ort from 'onnxruntime-web/wasm';
import { joinSpeech, sentences } from './audio';
import { parsePiperConfig, voiceById, type PiperConfig } from './catalog';
import { readVoice } from './storage';

export type WorkerRequest =
  | { type: 'init'; ortMjs: string; ortWasm: string; phonemizeWasm: string; phonemizeData: string }
  | { type: 'load'; id: number; voiceId: string }
  | { type: 'synth'; id: number; voiceId: string; text: string };

export type WorkerResponse =
  | { type: 'loaded'; id: number }
  | { type: 'audio'; id: number; pcm: Float32Array; sampleRate: number }
  | { type: 'error'; id: number; message: string };

let urls: { ortWasm: string; phonemizeWasm: string; phonemizeData: string } | null = null;
interface LoadedVoice {
  id: string;
  config: PiperConfig;
  session: ort.InferenceSession;
}
let voice: LoadedVoice | null = null;
let loading: Promise<LoadedVoice> | null = null;

/*
 * eSpeak NG (the phonemizer) leaks memory on every run and aborts after
 * about 80 sentences — sooner when a sentence switches language — after
 * which every sentence would fall back to the robotic device voice. A fresh
 * instance from the already-fetched files takes ~20 ms, so it is replaced
 * well before that, and after any failure.
 */
const PHONEMIZER_RUNS = 30;
type Phonemizer = Awaited<ReturnType<typeof createPiperPhonemize>>;
let printed: string[] = [];
let phonemizer: Promise<Phonemizer> | null = null;
let runs = 0;
let files: Promise<{ wasm: ArrayBuffer; data: ArrayBuffer }> | null = null;

async function fileBytes(url: string): Promise<ArrayBuffer> {
  // Downloaded with the voice into Cache Storage: works offline.
  const res = (await caches.match(url).catch(() => undefined)) ?? (await fetch(url));
  if (!res.ok) throw new Error(`Speech runtime missing (${res.status})`);
  return res.arrayBuffer();
}

function getPhonemizer(): Promise<Phonemizer> {
  if (!urls) return Promise.reject(new Error('not initialised'));
  const u = urls;
  if (!files) {
    files = Promise.all([fileBytes(u.phonemizeWasm), fileBytes(u.phonemizeData)]).then(([wasm, data]) => ({ wasm, data }));
    files.catch(() => (files = null));
  }
  if (!phonemizer || runs >= PHONEMIZER_RUNS) {
    runs = 0;
    phonemizer = files.then(({ wasm, data }) =>
      createPiperPhonemize({
        print: (line) => printed.push(line),
        printErr: () => undefined,
        wasmBinary: wasm,
        getPreloadedPackage: () => data,
        locateFile: (f) => (f.endsWith('.wasm') ? u.phonemizeWasm : f.endsWith('.data') ? u.phonemizeData : f),
      }),
    );
    phonemizer.catch(() => (phonemizer = null));
  }
  return phonemizer;
}

async function phonemizeOnce(text: string, espeakVoice: string): Promise<number[]> {
  const mod = await getPhonemizer();
  runs++;
  // Another language's words load another dictionary: that instance is nearly used up.
  if (/[A-Za-z]/.test(text) && !espeakVoice.startsWith('en')) runs = PHONEMIZER_RUNS;
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

export async function phonemize(text: string, espeakVoice: string): Promise<number[]> {
  try {
    return await phonemizeOnce(text, espeakVoice);
  } catch {
    // Out of memory (or crashed): start a fresh instance and try once more.
    phonemizer = null;
    return phonemizeOnce(text, espeakVoice);
  }
}

async function load(voiceId: string): Promise<LoadedVoice> {
  if (voice?.id === voiceId) return voice;
  if (loading) {
    const v = await loading.catch(() => null);
    if (v?.id === voiceId) return v;
  }
  loading = (async (): Promise<LoadedVoice> => {
    const v = voiceById(voiceId);
    const stored = v ? await readVoice(v) : null;
    if (!stored) throw new Error('Voice not downloaded');
    const config = parsePiperConfig(stored.config);
    const session = await ort.InferenceSession.create(stored.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    await voice?.session.release().catch(() => undefined);
    const loaded: LoadedVoice = { id: voiceId, config, session };
    voice = loaded;
    return loaded;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function speakSentence(v: LoadedVoice, text: string): Promise<Float32Array> {
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
  return new Float32Array(data); // the tensor's buffer belongs to the runtime
}

async function synth(voiceId: string, text: string): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const v = await load(voiceId);
  const parts: Float32Array[] = [];
  for (const s of sentences(text)) parts.push(await speakSentence(v, s));
  const pcm = joinSpeech(parts, v.config.sampleRate);
  if (!pcm.length) throw new Error('No audio');
  return { pcm, sampleRate: v.config.sampleRate };
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
      await load(msg.voiceId);
      await getPhonemizer();
      scope.postMessage({ type: 'loaded', id: msg.id } satisfies WorkerResponse);
    } else if (msg.type === 'synth') {
      const { pcm, sampleRate } = await synth(msg.voiceId, msg.text);
      scope.postMessage({ type: 'audio', id: msg.id, pcm, sampleRate } satisfies WorkerResponse, [pcm.buffer]);
    }
  } catch (err) {
    scope.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
  }
};
