/**
 * DEVICE VOICES — which of the browser's own voices sounds most human.
 *
 * Browsers ship several voices per language and the default is often the
 * oldest, most robotic one (SAPI "Desktop" voices on Windows, eSpeak on
 * Linux, "compact" voices on Apple devices). The natural-sounding ones are
 * usually marked in the name — Edge "… Online (Natural)", Chrome "Google …",
 * Apple "(Enhanced)"/"(Premium)" — and some of them need a connection.
 */

/** The parts of SpeechSynthesisVoice we use (lets tests pass plain objects). */
export interface VoiceInfo {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default?: boolean;
}

export type VoiceQuality = 'natural' | 'good' | 'basic';

const NATURAL = /\b(natural|neural|premium|enhanced|wavenet|studio)\b|siri/i;
const GOOD = /^google\b|\bgoogle\b|samsung|\bonline\b/i;
const ROBOTIC = /espeak|\bcompact\b|\bdesktop\b|mbrola|festival|\bpico\b|novelty|bad news|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|\b(albert|fred|junior|ralph)\b/i;

export function voiceQuality(v: VoiceInfo): VoiceQuality {
  if (ROBOTIC.test(v.name)) return 'basic';
  if (NATURAL.test(v.name)) return 'natural';
  if (GOOD.test(v.name)) return 'good';
  return 'basic';
}

/** Same language? "en-US" matches "en_US"/"en-us" exactly, "en-GB" only by base. */
function langScore(v: VoiceInfo, lang: string): number {
  const norm = (s: string) => s.replace('_', '-').toLowerCase();
  const a = norm(v.lang);
  const b = norm(lang);
  if (a === b) return 2;
  return a.split('-')[0] === b.split('-')[0] ? 1 : 0;
}

/** Higher is better; voices of another language score 0 and are never picked. */
export function scoreVoice(v: VoiceInfo, lang: string, opts: { online: boolean }): number {
  const l = langScore(v, lang);
  if (!l) return 0;
  const q = voiceQuality(v);
  let s = q === 'natural' ? 60 : q === 'good' ? 40 : 10;
  // A network voice fails silently offline — never choose one then.
  if (!v.localService && !opts.online) return 1;
  s += l === 2 ? 8 : 0;
  // Among equals, one that works without a connection is the safer choice.
  if (v.localService) s += 3;
  if (v.default) s += 1;
  return s;
}

/** Voices for a language, most natural first (for the Settings picker). */
export function voicesFor<T extends VoiceInfo>(voices: T[], lang: string, opts: { online: boolean } = { online: true }): T[] {
  return voices
    .map((v) => ({ v, s: scoreVoice(v, lang, opts) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.v.name.localeCompare(b.v.name))
    .map((x) => x.v);
}

/**
 * The voice to speak with: the user's choice when it exists (and works right
 * now), otherwise the most natural voice for the language.
 */
export function pickVoice<T extends VoiceInfo>(voices: T[], lang: string, opts: { online: boolean; preferredURI?: string | null }): T | undefined {
  if (opts.preferredURI) {
    const chosen = voices.find((v) => v.voiceURI === opts.preferredURI);
    if (chosen && (chosen.localService || opts.online) && langScore(chosen, lang)) return chosen;
  }
  return voicesFor(voices, lang, opts)[0];
}

/** The best voice that works without a connection (fallback after a network voice fails). */
export function pickLocalVoice<T extends VoiceInfo>(voices: T[], lang: string): T | undefined {
  return voicesFor(
    voices.filter((v) => v.localService),
    lang,
    { online: false },
  )[0];
}
