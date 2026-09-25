import { describe, expect, it } from 'vitest';
import { FakeTTS } from '../test/helpers';
import { VoiceQueue } from './queue';

function setup() {
  let now = 0;
  const tts = new FakeTTS();
  tts.holdSpeech = true;
  const q = new VoiceQueue(tts, () => 'en-US', () => now);
  return { q, tts, advance: (ms: number) => (now += ms) };
}

const msg = (id: string, priority: number, text = id, ttlMs = 60_000) => ({
  id,
  text,
  priority,
  expiresAt: ttlMs,
  interruptible: priority > 1,
});

describe('voice announcement queue', () => {
  it('turn in 200 m + heavy rain in 15 min → the turn is spoken first', () => {
    const { q, tts } = setup();
    q.holdBelowPriority(null);
    // Both become due in the same tick; weather happens to be enqueued first.
    tts.holdSpeech = true;
    const busy = { id: 'busy', text: 'x', priority: 6, expiresAt: 60_000, interruptible: false };
    q.enqueue(busy); // something already speaking
    q.enqueue(msg('rain', 4, 'Heavy rain is expected in about 15 minutes.'));
    q.enqueue(msg('turn', 1, 'In 200 meters, turn right.'));
    tts.finish();
    expect(tts.spoken[1]).toBe('In 200 meters, turn right.');
    tts.finish();
    expect(tts.spoken[2]).toBe('Heavy rain is expected in about 15 minutes.');
  });

  it('a maneuver interrupts weather speech; the weather is re-queued, not lost', () => {
    const { q, tts } = setup();
    q.enqueue(msg('rain', 4, 'Rain ahead.'));
    expect(tts.spoken).toEqual(['Rain ahead.']);
    q.enqueue(msg('turn', 1, 'Turn left.'));
    expect(tts.spoken).toEqual(['Rain ahead.', 'Turn left.']);
    tts.finish();
    expect(tts.spoken.at(-1)).toBe('Rain ahead.');
  });

  it('weather never interrupts a maneuver', () => {
    const { q, tts } = setup();
    q.enqueue(msg('turn', 1, 'Turn left.'));
    q.enqueue(msg('storm', 2, 'Storm.'));
    expect(tts.spoken).toEqual(['Turn left.']);
    tts.finish();
    expect(tts.spoken).toEqual(['Turn left.', 'Storm.']);
  });

  it('holds low-priority messages while a maneuver is imminent', () => {
    const { q, tts } = setup();
    q.holdBelowPriority(1);
    q.enqueue(msg('rain', 5, 'Rain.'));
    expect(tts.spoken).toEqual([]);
    q.holdBelowPriority(null);
    expect(tts.spoken).toEqual(['Rain.']);
  });

  it('drops expired messages and never repeats an id', () => {
    const { q, tts, advance } = setup();
    q.enqueue(msg('a', 3, 'A'));
    q.enqueue(msg('late', 5, 'Late', 10_000));
    advance(20_000);
    tts.finish(); // A done; "Late" has expired
    expect(tts.spoken).toEqual(['A']);
    q.enqueue(msg('a', 3, 'A'));
    tts.finish();
    expect(tts.spoken).toEqual(['A']);
  });

  it('muting clears the queue', () => {
    const { q, tts } = setup();
    q.setMuted(true);
    q.enqueue(msg('a', 1, 'A'));
    expect(tts.spoken).toEqual([]);
  });
});
