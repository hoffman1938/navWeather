import type { Locale } from '../i18n';
import { useSettings } from '../state/settings';
import { localeOf } from './natural/catalog';
import type { NaturalSpeech } from './natural/NaturalSpeech';
import { useNaturalVoice } from './natural/state';
import type { BrowserSpeechSynthesis, TextToSpeechProvider } from './providers';

/** Settings value per language: 'auto' (best device voice), 'natural' (on-device Piper) or `device:<voiceURI>`. */
export type VoiceChoice = string;

/**
 * How long a sentence may take to synthesize before the device voice says
 * it instead: guidance is never late because a phone is slow.
 */
export const NATURAL_BUDGET_MS = 2500;
/** A sample in Settings is about hearing that voice: wait for it (first use loads the model). */
const PREVIEW_BUDGET_MS = 20_000;

/**
 * The app's voice: the on-device natural voice when chosen and downloaded,
 * otherwise the most natural browser voice (or the one picked in Settings).
 */
export class SpeechRouter implements TextToSpeechProvider {
  readonly name = 'speech';
  private token = 0;

  constructor(
    readonly device: BrowserSpeechSynthesis,
    readonly natural: NaturalSpeech | null,
  ) {
    this.device.preferredVoice = (lang) => {
      const c = this.choiceFor(localeOf(lang));
      return c.startsWith('device:') ? c.slice(7) : null;
    };
    if (natural) {
      // Downloaded in an earlier visit? Find out now (and for each language switched to), not only in Settings.
      void useNaturalVoice.getState().check(useSettings.getState().language);
      useSettings.subscribe((st, prev) => {
        if (st.language !== prev.language) void useNaturalVoice.getState().check(st.language);
      });
    }
    // Just downloaded: load it now, so the first spoken sentence isn't late (and it's cached for offline use).
    useNaturalVoice.subscribe((st, prev) => {
      for (const l of Object.keys(st.status) as Locale[]) {
        if (st.status[l] === 'ready' && prev.status[l] !== 'ready') void this.natural?.prepare(l).catch(() => undefined);
      }
    });
  }

  get supported(): boolean {
    return this.device.supported || this.natural !== null;
  }

  private choiceFor(locale: Locale | null): VoiceChoice {
    return (locale && useSettings.getState().voiceByLang[locale]) || 'auto';
  }

  private naturalReady(locale: Locale | null): locale is Locale {
    return !!this.natural && !!locale && useNaturalVoice.getState().status[locale] === 'ready';
  }

  /** Should this language be spoken by the natural voice with this choice? */
  private useNatural(lang: string, choice: VoiceChoice): Locale | null {
    const locale = localeOf(lang);
    if (!this.naturalReady(locale)) return null;
    // 'auto' uses it only when the device has no voice for the language at all.
    return choice === 'natural' || (choice === 'auto' && !this.device.canSpeak(lang)) ? locale : null;
  }

  canSpeak(lang: string): boolean {
    return this.device.canSpeak(lang) || this.naturalReady(localeOf(lang));
  }

  speak(text: string, opts: { lang: string; onEnd: () => void }): void {
    this.speakWith(text, opts.lang, this.choiceFor(localeOf(opts.lang)), opts.onEnd);
  }

  /** Settings: hear a voice before choosing it. */
  preview(text: string, lang: string, choice: VoiceChoice): void {
    this.unlock(choice);
    this.cancel();
    this.speakWith(text, lang, choice, () => undefined, PREVIEW_BUDGET_MS);
  }

  private speakWith(text: string, lang: string, choice: VoiceChoice, onEnd: () => void, budgetMs = NATURAL_BUDGET_MS): void {
    const token = ++this.token;
    const voiceURI = choice.startsWith('device:') ? choice.slice(7) : null;
    const viaDevice = () => this.device.speak(text, { lang, onEnd, voiceURI });
    const locale = this.useNatural(lang, choice);
    if (!locale || !this.natural) {
      viaDevice();
      return;
    }
    const natural = this.natural;
    let started = false;
    const start = (fn: () => void) => {
      if (started || token !== this.token) return;
      started = true;
      fn();
    };
    const deadline = setTimeout(() => start(viaDevice), budgetMs);
    natural.synthesize(text, locale).then(
      (audio) => {
        clearTimeout(deadline);
        start(() => {
          const playing = natural.play(audio, () => {
            if (token === this.token) onEnd();
          });
          if (!playing) viaDevice();
        });
      },
      () => {
        clearTimeout(deadline);
        start(viaDevice);
      },
    );
  }

  cancel(): void {
    this.token++;
    this.natural?.stop();
    this.device.cancel();
  }

  /** Inside a user gesture (Start / Simulate / a Settings tap): enable audio and load the natural voice early. */
  unlock(choice?: VoiceChoice): void {
    this.device.unlock();
    if (!this.natural) return;
    this.natural.unlock();
    const lang = useSettings.getState().language;
    if (this.useNatural(lang, choice ?? this.choiceFor(lang))) void this.natural.prepare(lang).catch(() => undefined);
  }
}
