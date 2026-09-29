import { describe, expect, it } from 'vitest';
import { joinSpeech, sentences, trimSilence } from './audio';

/** The natural voice's audio: one sentence at a time, joined like a person pauses. */

const SR = 22050;
const tone = (seconds: number, amp: number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => amp * Math.sin(i / 3));
const silence = (seconds: number) => new Float32Array(Math.round(seconds * SR));
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe('sentences', () => {
  it('splits after . ! ? … and drops empty bits', () => {
    expect(sentences('Около нуля и осадки через 20 минут. Возможен гололёд.')).toEqual(['Около нуля и осадки через 20 минут.', 'Возможен гололёд.']);
    expect(sentences('ახლა წვიმს! შესუსტდება 20 წუთში…  .')).toEqual(['ახლა წვიმს!', 'შესუსტდება 20 წუთში…']);
    expect(sentences('In 300 meters, turn right')).toEqual(['In 300 meters, turn right']);
  });
});

describe('joining speech', () => {
  it('trims the model’s silences but keeps soft sounds at the edges', () => {
    const t = trimSilence(concat(silence(0.5), tone(1, 0.5), silence(0.7)), SR);
    expect(t.length / SR).toBeCloseTo(1.08, 1); // speech + 40 ms of air each side
  });

  it('one pause between sentences, whatever silence the model left', () => {
    const a = concat(silence(0.3), tone(0.5, 0.4), silence(0.9));
    const b = concat(silence(0.05), tone(0.5, 0.4), silence(0.1));
    const out = joinSpeech([a, b], SR);
    // lead 0.03 + (0.5 + 0.08 air) × 2 + gap 0.28 + tail 0.08
    expect(out.length / SR).toBeCloseTo(1.55, 1);
  });

  it('a steady level: quiet voices are raised, nothing clips', () => {
    expect(peak(joinSpeech([tone(0.5, 0.3)], SR))).toBeCloseTo(0.89, 2);
    expect(peak(joinSpeech([tone(0.5, 1.4)], SR))).toBeCloseTo(0.89, 2);
    // A near-silent clip is not blown up into noise.
    expect(peak(joinSpeech([tone(0.5, 0.05)], SR))).toBeCloseTo(0.2, 2);
  });

  it('starts and ends softly (no click)', () => {
    const out = joinSpeech([tone(0.5, 0.8)], SR);
    const first = out.findIndex((x) => x !== 0);
    expect(Math.abs(out[first])).toBeLessThan(0.05);
    expect(Math.abs(out[out.length - Math.round(0.08 * SR) - 1])).toBeLessThan(0.05);
  });

  it('nothing to say: empty audio', () => {
    expect(joinSpeech([silence(0.5)], SR).length).toBe(0);
  });
});
