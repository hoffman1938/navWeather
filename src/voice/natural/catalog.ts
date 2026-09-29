import { config } from '../../config';
import type { Locale } from '../../i18n';

/**
 * The on-device natural voices: free Piper voices (https://github.com/rhasspy/piper).
 * Models are downloaded once, on request, from Hugging Face and kept on the
 * device; speech is then made locally — no account, no per-use cost, and it
 * works offline. Each language lists its most natural-sounding voice first.
 */
export interface NaturalVoice {
  id: string;
  locale: Locale;
  /** Path under the voices repository, without the ".onnx" extension. */
  path: string;
  /** Shown to the user before downloading (the model file; the runtime adds RUNTIME_MB once). */
  sizeMB: number;
  /** The voice's name in its own language (voices are listed only in their language's UI). */
  name?: string;
  male: boolean;
}

const voice = (id: string, path: string, male: boolean, name?: string): NaturalVoice => ({
  id,
  locale: path.slice(0, 2) as Locale,
  path: `${path}/${id}`,
  sizeMB: 63,
  name,
  male,
});

export const NATURAL_VOICES: Record<Locale, NaturalVoice[]> = {
  en: [voice('en_US-hfc_female-medium', 'en/en_US/hfc_female/medium', false)],
  ru: [
    // 31 hours of a professional audiobook reading (the RUSLAN corpus): the most lifelike Russian voice.
    voice('ru_RU-ruslan-medium', 'ru/ru_RU/ruslan/medium', true, 'Руслан'),
    voice('ru_RU-irina-medium', 'ru/ru_RU/irina/medium', false, 'Ирина'),
  ],
  ka: [voice('ka_GE-natia-medium', 'ka/ka_GE/natia/medium', false, 'ნათია')],
};

/** What "natural" meant before a language had more than one voice (kept for saved settings). */
const FIRST_VOICE: Record<Locale, string> = { en: 'en_US-hfc_female-medium', ru: 'ru_RU-irina-medium', ka: 'ka_GE-natia-medium' };

export function voiceById(id: string): NaturalVoice | undefined {
  for (const list of Object.values(NATURAL_VOICES)) {
    const v = list.find((x) => x.id === id);
    if (v) return v;
  }
  return undefined;
}

/** The natural voice a Settings choice names ("natural:<id>", or "natural" from older versions), if any. */
export function naturalVoiceFor(locale: Locale, choice: string): NaturalVoice | null {
  const list = NATURAL_VOICES[locale];
  if (choice === 'natural') return list.find((v) => v.id === FIRST_VOICE[locale]) ?? list[0];
  if (!choice.startsWith('natural:')) return null;
  return list.find((v) => v.id === choice.slice(8)) ?? null;
}

/** Speech runtime served by this app (ONNX Runtime + phonemizer), fetched with the first voice. */
export const RUNTIME_MB = 30;

const base = () => config.endpoints.piperVoices.replace(/\/$/, '');
export const modelUrl = (v: NaturalVoice) => `${base()}/${v.path}.onnx`;
export const configUrl = (v: NaturalVoice) => `${base()}/${v.path}.onnx.json`;
const dir = (v: NaturalVoice) => v.path.split('/').slice(0, -1).join('/');
/** Voice details and license (each voice has its own; all are free to download and use). */
export const modelCardUrl = (v: NaturalVoice) => `https://huggingface.co/rhasspy/piper-voices/tree/main/${dir(v)}`;
/** A short recording of the voice, to hear it before downloading. */
export const sampleUrl = (v: NaturalVoice) => `${config.endpoints.piperSamples.replace(/\/$/, '')}/${dir(v)}/speaker_0.mp3`;

/** "en-US" / "ka-GE" / "ru" → the app language whose voice speaks it. */
export function localeOf(lang: string): Locale | null {
  const b = lang.slice(0, 2).toLowerCase();
  return b === 'en' || b === 'ru' || b === 'ka' ? b : null;
}

/** What the phonemizer and the model need from a voice's .onnx.json. */
export interface PiperConfig {
  espeakVoice: string;
  sampleRate: number;
  noiseScale: number;
  lengthScale: number;
  noiseW: number;
  multiSpeaker: boolean;
}

export function parsePiperConfig(raw: unknown): PiperConfig {
  const o = (raw ?? {}) as {
    espeak?: { voice?: unknown };
    audio?: { sample_rate?: unknown };
    inference?: { noise_scale?: unknown; length_scale?: unknown; noise_w?: unknown };
    num_speakers?: unknown;
  };
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const espeakVoice = typeof o.espeak?.voice === 'string' ? o.espeak.voice : '';
  if (!/^[a-z]{2,3}(-[a-z0-9-]+)?$/i.test(espeakVoice)) throw new Error('Voice config has no valid espeak voice');
  return {
    espeakVoice,
    sampleRate: num(o.audio?.sample_rate, 22050),
    noiseScale: num(o.inference?.noise_scale, 0.667),
    lengthScale: num(o.inference?.length_scale, 1),
    noiseW: num(o.inference?.noise_w, 0.8),
    multiSpeaker: num(o.num_speakers, 1) > 1,
  };
}
