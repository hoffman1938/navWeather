import { pickLocalVoice, pickVoice, voicesFor } from './voices';

/**
 * Speech provider contracts. Browser implementations below; a native shell
 * or cloud speech service can replace them without touching navigation code.
 */
export interface TextToSpeechProvider {
  readonly name: string;
  readonly supported: boolean;
  speak(text: string, opts: { lang: string; onEnd: () => void }): void;
  cancel(): void;
  /** iOS/Safari only allow speech after a user gesture — call from one. */
  unlock(): void;
  /** False when nothing on this device can speak the language (e.g. no Georgian voice). */
  canSpeak?(lang: string): boolean;
  /** Settings: say `text` with a voice choice that isn't saved yet. */
  preview?(text: string, lang: string, choice: string): void;
}

export interface SpeechRecognitionSession {
  stop(): void;
}

export interface SpeechRecognitionProvider {
  readonly name: string;
  readonly supported: boolean;
  listen(opts: {
    lang: string;
    onResult: (text: string, final: boolean) => void;
    onEnd: () => void;
    onError: (reason: 'denied' | 'no-speech' | 'network' | 'unsupported' | 'other') => void;
  }): SpeechRecognitionSession;
}

// ---------------------------------------------------------------------------

/**
 * The browser's own voices. Picks the most natural-sounding voice for the
 * language (or the one chosen in Settings) — not the robotic default — and,
 * if a voice that needs a connection fails, says it again with one that
 * works on the device.
 */
export class BrowserSpeechSynthesis implements TextToSpeechProvider {
  readonly name = 'browser-speech-synthesis';
  private current: SpeechSynthesisUtterance | null = null;
  /** The voice chosen in Settings for a language (voiceURI), if any. */
  preferredVoice: (lang: string) => string | null = () => null;

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /** Voices for a language, most natural first (they load asynchronously in some browsers). */
  voices(lang: string): SpeechSynthesisVoice[] {
    if (!this.supported) return [];
    return voicesFor(window.speechSynthesis.getVoices(), lang, { online: isOnline() });
  }

  canSpeak(lang: string): boolean {
    if (!this.supported) return false;
    // Chrome/Safari fill the list asynchronously: an empty list means "not known yet", not "none".
    if (!window.speechSynthesis.getVoices().length) return true;
    return this.voices(lang).length > 0;
  }

  speak(text: string, opts: { lang: string; onEnd: () => void; voiceURI?: string | null }): void {
    if (!this.supported) {
      opts.onEnd();
      return;
    }
    const all = window.speechSynthesis.getVoices();
    const voice = pickVoice(all, opts.lang, { online: isOnline(), preferredURI: opts.voiceURI ?? this.preferredVoice(opts.lang) });
    this.say(text, opts.lang, voice, opts.onEnd, () => {
      // A network voice (Edge "Natural", Chrome "Google …") can fail with no signal: repeat on the device.
      const local = !voice || voice.localService ? undefined : pickLocalVoice(all, opts.lang);
      if (local) this.say(text, opts.lang, local, opts.onEnd, opts.onEnd);
      else opts.onEnd();
    });
  }

  private say(text: string, lang: string, voice: SpeechSynthesisVoice | undefined, onEnd: () => void, onFail: () => void) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang ?? lang;
    if (voice) u.voice = voice;
    u.rate = 1;
    let done = false;
    const finish = (failed: boolean) => {
      if (done) return;
      done = true;
      if (this.current === u) this.current = null;
      // Cancelled on purpose (a more urgent message): that is an end, not a failure.
      if (failed && this.current === null && !cancelled.has(u)) onFail();
      else onEnd();
    };
    u.onend = () => finish(false);
    u.onerror = (e) => finish(e.error !== 'interrupted' && e.error !== 'canceled');
    this.current = u;
    window.speechSynthesis.speak(u);
  }

  cancel(): void {
    if (!this.supported) return;
    if (this.current) cancelled.add(this.current);
    this.current = null;
    window.speechSynthesis.cancel();
  }

  unlock(): void {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
}

/** Utterances stopped by cancel() (their error event is not a voice failure). */
const cancelled = new WeakSet<SpeechSynthesisUtterance>();

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

type RecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

export class BrowserSpeechRecognition implements SpeechRecognitionProvider {
  readonly name = 'browser-speech-recognition';

  private get ctor(): RecognitionCtor | undefined {
    if (typeof window === 'undefined') return undefined;
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition;
  }

  get supported(): boolean {
    return !!this.ctor;
  }

  listen(opts: Parameters<SpeechRecognitionProvider['listen']>[0]): SpeechRecognitionSession {
    const Ctor = this.ctor;
    if (!Ctor) {
      opts.onError('unsupported');
      opts.onEnd();
      return { stop() {} };
    }
    const r = new Ctor();
    r.lang = opts.lang;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.continuous = false;
    r.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      opts.onResult(res[0]?.transcript ?? '', res.isFinal);
    };
    r.onerror = (e) => {
      const map: Record<string, 'denied' | 'no-speech' | 'network'> = {
        'not-allowed': 'denied',
        'service-not-allowed': 'denied',
        'no-speech': 'no-speech',
        network: 'network',
      };
      opts.onError(map[e.error] ?? 'other');
    };
    r.onend = () => opts.onEnd();
    r.start();
    return { stop: () => r.stop() };
  }
}
