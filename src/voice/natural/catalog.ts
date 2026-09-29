import { config } from '../../config';
import type { Locale } from '../../i18n';

/**
 * The on-device natural voice: one free Piper voice per app language
 * (https://github.com/rhasspy/piper). Models are downloaded once, on
 * request, from Hugging Face and kept on the device; speech is then made
 * locally — no account, no per-use cost, and it works offline.
 */
export interface NaturalVoice {
  id: string;
  locale: Locale;
  /** Path under the voices repository, without the ".onnx" extension. */
  path: string;
  /** Shown to the user before downloading (the model file; the runtime adds RUNTIME_MB once). */
  sizeMB: number;
}

export const NATURAL_VOICES: Record<Locale, NaturalVoice> = {
  en: { id: 'en_US-hfc_female-medium', locale: 'en', path: 'en/en_US/hfc_female/medium/en_US-hfc_female-medium', sizeMB: 63 },
  ru: { id: 'ru_RU-irina-medium', locale: 'ru', path: 'ru/ru_RU/irina/medium/ru_RU-irina-medium', sizeMB: 63 },
  ka: { id: 'ka_GE-natia-medium', locale: 'ka', path: 'ka/ka_GE/natia/medium/ka_GE-natia-medium', sizeMB: 63 },
};

/** Speech runtime served by this app (ONNX Runtime + phonemizer), fetched with the first voice. */
export const RUNTIME_MB = 30;

const base = () => config.endpoints.piperVoices.replace(/\/$/, '');
export const modelUrl = (v: NaturalVoice) => `${base()}/${v.path}.onnx`;
export const configUrl = (v: NaturalVoice) => `${base()}/${v.path}.onnx.json`;
/** Voice details and license (each voice has its own; all are free to download and use). */
export const modelCardUrl = (v: NaturalVoice) => `https://huggingface.co/rhasspy/piper-voices/tree/main/${v.path.split('/').slice(0, -1).join('/')}`;

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
