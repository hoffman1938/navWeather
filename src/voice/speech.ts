import { useSettings } from '../state/settings';
import { localeOf, naturalVoiceFor, type NaturalVoice } from './natural/catalog';
import type { NaturalSpeech } from './natural/NaturalSpeech';
import { readyVoice, useNaturalVoice } from './natural/state';
import type { BrowserSpeechSynthesis, TextToSpeechProvider } from './providers';
import { speakable } from './speakable';

/**
 * Settings value per language: 'auto' (the most natural voice available),
 * 'natural:<voice id>' (an on-device Piper voice; plain 'natural' from older
 * versions) or `device:<voiceURI>`.
 */
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
 * Text is spelled out for the ear first ("60 км/ч" → "60 километров в час").
 */
export class SpeechRouter implements TextToSpeechProvider {
  readonly name = 'speech';
  private token = 0;

  constructor(
    readonly device: BrowserSpeechSynthesis,
    readonly natural: NaturalSpeech | null,
  ) {
    this.device.preferredVoice = (lang) => {
      const c = this.choiceFor(lang);
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
      for (const id of Object.keys(st.status)) {
        if (st.status[id] === 'ready' && prev.status[id] !== 'ready') void this.natural?.prepare(id).catch(() => undefined);
      }
    });
  }

  get supported(): boolean {
    return this.device.supported || this.natural !== null;
  }

  private choiceFor(lang: string): VoiceChoice {
    const locale = localeOf(lang);
    return (locale && useSettings.getState().voiceByLang[locale]) || 'auto';
  }

  /** The downloaded natural voice that should say this language with this choice, if any. */
  private naturalVoice(lang: string, choice: VoiceChoice): NaturalVoice | null {
    const locale = localeOf(lang);
    if (!this.natural || !locale) return null;
    const chosen = naturalVoiceFor(locale, choice);
    if (chosen) return useNaturalVoice.getState().status[chosen.id] === 'ready' ? chosen : null;
    // 'auto': a downloaded natural voice beats the device's, unless the device has a truly natural one.
    if (choice === 'auto' && !this.device.hasNaturalVoice(lang)) return readyVoice(locale);
    return null;
  }

  canSpeak(lang: string): boolean {
    const locale = localeOf(lang);
    return this.device.canSpeak(lang) || (!!this.natural && !!locale && readyVoice(locale) !== null);
  }

  speak(text: string, opts: { lang: string; onEnd: () => void }): void {
    this.speakWith(text, opts.lang, this.choiceFor(opts.lang), opts.onEnd);
  }

  /** Settings: hear a voice before choosing it. */
  preview(text: string, lang: string, choice: VoiceChoice): void {
    this.unlock(choice);
    this.cancel();
    this.speakWith(text, lang, choice, () => undefined, PREVIEW_BUDGET_MS);
  }

  private speakWith(text: string, lang: string, choice: VoiceChoice, onEnd: () => void, budgetMs = NATURAL_BUDGET_MS): void {
    const token = ++this.token;
    const locale = localeOf(lang);
    const voiceURI = choice.startsWith('device:') ? choice.slice(7) : null;
    const viaDevice = () => this.device.speak(locale ? speakable(text, locale) : text, { lang, onEnd, voiceURI });
    const voice = this.naturalVoice(lang, choice);
    if (!voice || !this.natural || !locale) {
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
    natural.synthesize(speakable(text, locale, { natural: true }), voice.id).then(
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
    const voice = this.naturalVoice(lang, choice ?? this.choiceFor(lang));
    if (voice) void this.natural.prepare(voice.id).catch(() => undefined);
  }
}
