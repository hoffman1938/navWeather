/**
 * DEVICE VOICES — Google's voices only (Chrome's "Google русский",
 * "Google US English", …): they sound natural and are free.
 *
 * A browser without Google voices (Safari, Firefox; Android lists its Google
 * voices without the name) speaks with its own voice for the language, and
 * a Google voice that fails offline is repeated with one that works on the
 * device — directions are never silent.
 */

/** The parts of SpeechSynthesisVoice we use (lets tests pass plain objects). */
export interface VoiceInfo {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default?: boolean;
}

export const isGoogleVoice = (v: VoiceInfo) => /\bgoogle\b/i.test(v.name);

/** Same language? "en-US" matches "en_US"/"en-us" exactly (2), "en-GB" only by base (1). */
function langScore(v: VoiceInfo, lang: string): number {
  const norm = (s: string) => s.replace('_', '-').toLowerCase();
  const a = norm(v.lang);
  const b = norm(lang);
  if (a === b) return 2;
  return a.split('-')[0] === b.split('-')[0] ? 1 : 0;
}

function forLang<T extends VoiceInfo>(voices: T[], lang: string): T[] {
  return voices
    .filter((v) => langScore(v, lang) > 0)
    .sort((a, b) => langScore(b, lang) - langScore(a, lang) || Number(!!b.default) - Number(!!a.default) || a.name.localeCompare(b.name));
}

/** Google voices for a language, the exact regional one first (the Settings picker). */
export function googleVoicesFor<T extends VoiceInfo>(voices: T[], lang: string): T[] {
  return forLang(voices.filter(isGoogleVoice), lang);
}

/**
 * The voice to speak with: the Google voice chosen in Settings, else the best
 * Google voice for the language, else the browser's own voice for it. Google
 * voices that need a connection are skipped offline.
 */
export function pickVoice<T extends VoiceInfo>(voices: T[], lang: string, opts: { online: boolean; preferredURI?: string | null }): T | undefined {
  const google = googleVoicesFor(voices, lang).filter((v) => v.localService || opts.online);
  const chosen = opts.preferredURI ? google.find((v) => v.voiceURI === opts.preferredURI) : undefined;
  return chosen ?? google[0] ?? pickLocalVoice(voices, lang);
}

/** The browser's own voice for the language that works without a connection. */
export function pickLocalVoice<T extends VoiceInfo>(voices: T[], lang: string): T | undefined {
  return forLang(
    voices.filter((v) => v.localService),
    lang,
  )[0];
}
