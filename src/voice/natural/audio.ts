/**
 * Shaping the natural voice's audio so it sounds like one person talking:
 * each sentence is made on its own (its own intonation, as Piper does), then
 * joined with a breath-length pause, without the model's uneven silences,
 * clicks at the edges or a level that jumps from voice to voice.
 */

/** Pause between sentences, and before/after the whole phrase. */
const GAP_S = 0.28;
const LEAD_S = 0.03;
const TAIL_S = 0.08;
/** Keep this much quiet sound around speech (soft onsets like "с", "ს", "h" start below the threshold). */
const PAD_S = 0.04;
const FADE_S = 0.008;
/** Peak level after normalising (−1 dBFS), and the most it may be boosted (+12 dB). */
const TARGET_PEAK = 0.89;
const MAX_GAIN = 4;

/** Sentences, split after . ! ? … (the text is already spelled out: no "ул." abbreviations left). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** The part of a clip with speech in it, plus a little air on both sides. */
export function trimSilence(pcm: Float32Array, sampleRate: number): Float32Array {
  let peak = 0;
  for (const x of pcm) peak = Math.max(peak, Math.abs(x));
  if (peak === 0) return pcm.subarray(0, 0);
  const threshold = Math.max(0.003, peak * 0.02);
  let start = 0;
  while (start < pcm.length && Math.abs(pcm[start]) < threshold) start++;
  let end = pcm.length - 1;
  while (end > start && Math.abs(pcm[end]) < threshold) end--;
  const pad = Math.round(PAD_S * sampleRate);
  return pcm.subarray(Math.max(0, start - pad), Math.min(pcm.length, end + pad + 1));
}

/** One clip from the sentences' clips: trimmed, faded at the edges, paused between, at a steady level. */
export function joinSpeech(parts: Float32Array[], sampleRate: number): Float32Array {
  const clips = parts.map((p) => trimSilence(p, sampleRate)).filter((p) => p.length > 0);
  if (!clips.length) return new Float32Array(0);
  const gap = Math.round(GAP_S * sampleRate);
  const lead = Math.round(LEAD_S * sampleRate);
  const tail = Math.round(TAIL_S * sampleRate);
  const fade = Math.round(FADE_S * sampleRate);
  const total = lead + tail + clips.reduce((n, c) => n + c.length, 0) + gap * Math.max(0, clips.length - 1);
  const out = new Float32Array(total);
  let at = lead;
  let peak = 0;
  clips.forEach((c, i) => {
    for (let k = 0; k < c.length; k++) {
      const edge = fade > 0 ? Math.min(1, k / fade, (c.length - 1 - k) / fade) : 1;
      const v = c[k] * edge;
      out[at + k] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    at += c.length + (i < clips.length - 1 ? gap : 0);
  });
  if (peak > 0) {
    const gain = Math.min(MAX_GAIN, TARGET_PEAK / peak);
    for (let k = 0; k < out.length; k++) out[k] *= gain;
  }
  return out;
}
