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

export class BrowserSpeechSynthesis implements TextToSpeechProvider {
  readonly name = 'browser-speech-synthesis';
  private current: SpeechSynthesisUtterance | null = null;

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  speak(text: string, opts: { lang: string; onEnd: () => void }): void {
    if (!this.supported) {
      opts.onEnd();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts.lang;
    const voice = pickVoice(opts.lang);
    if (voice) u.voice = voice;
    u.rate = 1;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (this.current === u) this.current = null;
      opts.onEnd();
    };
    u.onend = finish;
    u.onerror = finish;
    this.current = u;
    window.speechSynthesis.speak(u);
  }

  cancel(): void {
    if (!this.supported) return;
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

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.slice(0, 2);
  return (
    voices.find((v) => v.lang === lang && v.localService) ??
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => v.lang.startsWith(base))
  );
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
