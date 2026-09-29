import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSpeechSynthesis } from './providers';

/** The browser voice: a Google voice; one that fails (no connection) is repeated on the device. */

interface FakeUtterance {
  text: string;
  lang: string;
  voice: { name: string } | null;
  rate: number;
  volume: number;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

let spoken: FakeUtterance[];
const voices = [
  { name: 'Microsoft David - English (United States)', lang: 'en-US', voiceURI: 'david', localService: true, default: true },
  { name: 'Google US English', lang: 'en-US', voiceURI: 'google', localService: false, default: false },
];

beforeEach(() => {
  spoken = [];
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string;
      lang = '';
      voice = null;
      rate = 1;
      volume = 1;
      onend = null;
      onerror = null;
      constructor(text: string) {
        this.text = text;
      }
    },
  );
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { getVoices: () => voices, speak: (u: FakeUtterance) => spoken.push(u), cancel: vi.fn() },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
});

describe('browser speech', () => {
  it('speaks with the Google voice, not the default', () => {
    new BrowserSpeechSynthesis().speak('Turn left.', { lang: 'en-US', onEnd: () => undefined });
    expect(spoken[0].voice?.name).toBe('Google US English');
  });

  it('a Google voice that fails (no signal) is repeated with a device voice', () => {
    const onEnd = vi.fn();
    new BrowserSpeechSynthesis().speak('Turn left.', { lang: 'en-US', onEnd });
    spoken[0].onerror?.({ error: 'network' });
    expect(spoken).toHaveLength(2);
    expect(spoken[1].voice?.name).toMatch(/David/);
    expect(onEnd).not.toHaveBeenCalled();
    spoken[1].onend?.();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('being cut off by a more urgent message is not a failure (no repeat)', () => {
    const tts = new BrowserSpeechSynthesis();
    const onEnd = vi.fn();
    tts.speak('Weather ahead.', { lang: 'en-US', onEnd });
    tts.cancel();
    spoken[0].onerror?.({ error: 'interrupted' });
    expect(spoken).toHaveLength(1);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('offline it goes straight to a device voice', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    new BrowserSpeechSynthesis().speak('Recalculating.', { lang: 'en-US', onEnd: () => undefined });
    expect(spoken[0].voice?.name).toMatch(/David/);
  });

  it('knows when there is no voice for a language (but not before the list has loaded)', () => {
    const tts = new BrowserSpeechSynthesis();
    expect(tts.canSpeak('en-US')).toBe(true);
    expect(tts.canSpeak('ru-RU')).toBe(false);
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], speak: vi.fn(), cancel: vi.fn() } });
    expect(tts.canSpeak('ru-RU')).toBe(true);
  });

  it('Russian text is spelled out for the ear', () => {
    new BrowserSpeechSynthesis().speak('Впереди ограничение 60 км/ч.', { lang: 'ru-RU', onEnd: () => undefined });
    expect(spoken[0].text).toBe('Впереди ограничение 60 километров в час.');
  });

  it('Settings sample: the Google voice picked there', () => {
    new BrowserSpeechSynthesis().preview('Hello.', 'en-US', 'device:google');
    expect(spoken.at(-1)?.voice?.name).toBe('Google US English');
  });
});
