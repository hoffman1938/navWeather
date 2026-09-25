import type { TextToSpeechProvider } from './providers';

/**
 * Voice priorities (lower number = more urgent):
 *  1 immediate maneuver · 2 critical hazard · 3 major traffic ·
 *  4 severe weather · 5 weather transition · 6 minor information
 */
export interface VoiceMessage {
  id: string;
  text: string;
  priority: number;
  createdAt: number;
  expiresAt: number;
  /** Can a more urgent message cut this one off? */
  interruptible: boolean;
}

/**
 * VOICE ANNOUNCEMENT QUEUE — one voice at a time, most urgent first.
 *  - a maneuver never waits behind weather: it interrupts an interruptible
 *    lower-priority message (which is re-queued if still valid);
 *  - lower-priority messages wait while a maneuver is imminent (`holdBelow`);
 *  - expired messages are dropped, never spoken late;
 *  - the same id is never spoken twice (dedupe window).
 */
export class VoiceQueue {
  private queue: VoiceMessage[] = [];
  private speaking: VoiceMessage | null = null;
  private spoken = new Map<string, number>();
  private muted = false;
  /** Messages with priority > this wait (e.g. while a turn is seconds away). */
  private holdAbove = Infinity;
  readonly log: { id: string; text: string; at: number }[] = [];

  constructor(
    private tts: TextToSpeechProvider,
    private getLang: () => string,
    private now: () => number = Date.now,
  ) {}

  get isSpeaking(): boolean {
    return this.speaking !== null;
  }

  get pending(): readonly VoiceMessage[] {
    return this.queue;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.queue = [];
      this.stopCurrent();
    }
  }

  /** While a maneuver is imminent only messages at or above `priority` may start. */
  holdBelowPriority(priority: number | null): void {
    this.holdAbove = priority ?? Infinity;
    if (priority === null) this.next();
  }

  enqueue(msg: Omit<VoiceMessage, 'createdAt'> & { createdAt?: number }): void {
    if (this.muted) return;
    const now = this.now();
    const m: VoiceMessage = { createdAt: now, ...msg };
    const lastSpoken = this.spoken.get(m.id);
    if (lastSpoken !== undefined && now - lastSpoken < 30 * 60000) return;
    if (this.speaking?.id === m.id || this.queue.some((q) => q.id === m.id)) return;
    if (m.expiresAt <= now) return;

    if (this.speaking && m.priority < this.speaking.priority && this.speaking.interruptible) {
      const interrupted = this.speaking;
      this.stopCurrent();
      if (interrupted.expiresAt > now) this.queue.push(interrupted);
      this.queue.push(m);
      this.sort();
      this.next();
      return;
    }
    this.queue.push(m);
    this.sort();
    this.next();
  }

  clear(): void {
    this.queue = [];
    this.stopCurrent();
  }

  private sort(): void {
    this.queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  }

  private stopCurrent(): void {
    if (this.speaking) {
      this.speaking = null;
      this.tts.cancel();
    }
  }

  private next(): void {
    if (this.speaking || this.muted) return;
    const now = this.now();
    this.queue = this.queue.filter((q) => q.expiresAt > now);
    const idx = this.queue.findIndex((q) => q.priority <= this.holdAbove);
    if (idx < 0) return;
    const m = this.queue.splice(idx, 1)[0];
    this.speaking = m;
    this.spoken.set(m.id, now);
    this.log.push({ id: m.id, text: m.text, at: now });
    if (this.log.length > 50) this.log.shift();
    this.tts.speak(m.text, {
      lang: this.getLang(),
      onEnd: () => {
        if (this.speaking === m) this.speaking = null;
        this.next();
      },
    });
  }
}
