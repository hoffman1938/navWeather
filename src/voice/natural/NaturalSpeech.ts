// Runtime files served by this app (hashed, cached for offline use). ONNX
// Runtime doesn't export these paths, hence the relative imports; it loads
// its WebAssembly glue (.mjs) at run time, so that file must ship too.
import ortMjsUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import phonemizeDataUrl from '@diffusionstudio/piper-wasm/build/piper_phonemize.data?url';
import phonemizeWasmUrl from '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url';
import type { Locale } from '../../i18n';
import type { WorkerRequest, WorkerResponse } from './natural.worker';

export const RUNTIME_URLS = [ortMjsUrl, ortWasmUrl, phonemizeWasmUrl, phonemizeDataUrl];

export interface NaturalAudio {
  pcm: Float32Array;
  sampleRate: number;
}

/** Can this browser run the on-device voice at all? */
export function naturalSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof WebAssembly === 'object' &&
    typeof caches !== 'undefined' &&
    typeof (window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) === 'function'
  );
}

/** Recently spoken phrases ("Recalculating the route.", "Speed camera ahead.") are reused instantly. */
const RECENT_MAX = 24;

/**
 * The on-device natural voice (Piper). `synthesize` makes audio in a
 * worker; `play` plays it through Web Audio. Routing between this and the
 * browser's voices (and the fallback when it's too slow) is in speech.ts.
 */
export class NaturalSpeech {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: NaturalAudio | null) => void; reject: (e: Error) => void }>();
  private recent = new Map<string, NaturalAudio>();
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private safety: ReturnType<typeof setTimeout> | null = null;

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./natural.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message));
      else p.resolve(m.type === 'audio' ? { pcm: m.pcm, sampleRate: m.sampleRate } : null);
    };
    w.onerror = () => {
      // A crashed worker: fail everything waiting and start fresh next time.
      for (const p of this.pending.values()) p.reject(new Error('Speech worker failed'));
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    const base = new URL('.', location.href);
    const abs = (u: string) => new URL(u, base).href;
    w.postMessage({
      type: 'init',
      ortMjs: abs(ortMjsUrl),
      ortWasm: abs(ortWasmUrl),
      phonemizeWasm: abs(phonemizeWasmUrl),
      phonemizeData: abs(phonemizeDataUrl),
    } satisfies WorkerRequest);
    this.worker = w;
    return w;
  }

  private request(msg: { type: 'load'; locale: Locale } | { type: 'synth'; locale: Locale; text: string }): Promise<NaturalAudio | null> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.getWorker().postMessage({ ...msg, id } as WorkerRequest);
    });
  }

  /** Load the voice ahead of time (at drive start) so the first sentence isn't late. */
  prepare(locale: Locale): Promise<void> {
    return this.request({ type: 'load', locale }).then(() => undefined);
  }

  async synthesize(text: string, locale: Locale): Promise<NaturalAudio> {
    const key = `${locale}|${text}`;
    const hit = this.recent.get(key);
    if (hit) {
      this.recent.delete(key);
      this.recent.set(key, hit);
      return hit;
    }
    const audio = await this.request({ type: 'synth', locale, text });
    if (!audio) throw new Error('No audio');
    this.recent.set(key, audio);
    if (this.recent.size > RECENT_MAX) this.recent.delete(this.recent.keys().next().value!);
    return audio;
  }

  /** Create/resume audio output — must run inside a user gesture on iOS. */
  unlock(): void {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx ??= new Ctor();
      void this.ctx.resume().catch(() => undefined);
      // iOS: play through the ring/silent switch like a navigation app.
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
    } catch {
      /* no audio output: speech falls back to the browser voice */
    }
  }

  /** Play; false if audio output isn't available right now (caller falls back). */
  play(audio: NaturalAudio, onEnd: () => void): boolean {
    this.stop();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return false;
    const buf = ctx.createBuffer(1, audio.pcm.length, audio.sampleRate);
    buf.copyToChannel(audio.pcm as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (this.safety) clearTimeout(this.safety);
      this.safety = null;
      if (this.source === src) this.source = null;
      onEnd();
    };
    src.onended = end;
    // Never leave the voice queue waiting if the output stalls (device sleep, route change).
    this.safety = setTimeout(end, buf.duration * 1000 + 2000);
    this.source = src;
    src.start();
    return true;
  }

  stop(): void {
    if (this.safety) clearTimeout(this.safety);
    this.safety = null;
    const s = this.source;
    this.source = null;
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
  }
}
