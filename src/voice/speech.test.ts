import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLocale } from '../i18n';
import { useSettings } from '../state/settings';
import type { NaturalAudio, NaturalSpeech } from './natural/NaturalSpeech';
import { useNaturalVoice } from './natural/state';
import type { BrowserSpeechSynthesis } from './providers';
import { NATURAL_BUDGET_MS, SpeechRouter } from './speech';

/** Which voice speaks, and what happens when the natural voice is slow, missing or silent. */

function fakeDevice(canSpeak = true) {
  const said: { text: string; voiceURI: string | null | undefined }[] = [];
  const device = {
    supported: true,
    preferredVoice: (_lang: string): string | null => null,
    canSpeak: () => canSpeak,
    speak: vi.fn((text: string, o: { onEnd: () => void; voiceURI?: string | null }) => {
      said.push({ text, voiceURI: o.voiceURI });
      o.onEnd();
    }),
    cancel: vi.fn(),
    unlock: vi.fn(),
  };
  return { device: device as unknown as BrowserSpeechSynthesis, said };
}

function fakeNatural(opts: { delayMs?: number; fail?: boolean; output?: boolean } = {}) {
  const played: string[] = [];
  const natural = {
    synthesize: vi.fn(
      (text: string) =>
        new Promise<NaturalAudio>((resolve, reject) =>
          setTimeout(() => (opts.fail ? reject(new Error('boom')) : resolve({ pcm: new Float32Array([text.length]), sampleRate: 22050 })), opts.delayMs ?? 100),
        ),
    ),
    play: vi.fn((audio: NaturalAudio, onEnd: () => void) => {
      if (opts.output === false) return false;
      played.push(String(audio.pcm[0]));
      setTimeout(onEnd, 50);
      return true;
    }),
    stop: vi.fn(),
    unlock: vi.fn(),
    prepare: vi.fn(async () => undefined),
  };
  return { natural: natural as unknown as NaturalSpeech, played, raw: natural };
}

const choose = (en: string) => useSettings.getState().update({ language: 'en', voiceByLang: { en } });
const setReady = (ready: boolean) => useNaturalVoice.setState({ status: { en: ready ? 'ready' : 'none', ru: 'none', ka: 'none' } });

beforeEach(() => {
  vi.useFakeTimers();
  useSettings.getState().reset();
  setReady(false);
});
afterEach(() => vi.useRealTimers());

describe('speech router', () => {
  it('auto: the best device voice (the natural voice is for when the device has none)', async () => {
    const { device, said } = fakeDevice();
    const { natural, raw } = fakeNatural();
    setReady(true);
    choose('auto');
    const onEnd = vi.fn();
    new SpeechRouter(device, natural).speak('Turn right.', { lang: 'en-US', onEnd });
    expect(said).toEqual([{ text: 'Turn right.', voiceURI: null }]);
    expect(raw.synthesize).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalled();
  });

  it('auto with no device voice for the language: the downloaded natural voice speaks', async () => {
    const { device, said } = fakeDevice(false);
    const { natural, played } = fakeNatural();
    setReady(true);
    choose('auto');
    const onEnd = vi.fn();
    new SpeechRouter(device, natural).speak('Hello', { lang: 'en-US', onEnd });
    await vi.advanceTimersByTimeAsync(200);
    expect(played).toEqual(['5']);
    expect(said).toEqual([]);
    expect(onEnd).toHaveBeenCalled();
  });

  it('natural chosen and downloaded: speaks with it and reports the end', async () => {
    const { device, said } = fakeDevice();
    const { natural, played } = fakeNatural();
    setReady(true);
    choose('natural');
    const onEnd = vi.fn();
    new SpeechRouter(device, natural).speak('In 300 meters, turn left.', { lang: 'en-US', onEnd });
    await vi.advanceTimersByTimeAsync(120);
    expect(played).toHaveLength(1);
    expect(onEnd).not.toHaveBeenCalled(); // still playing
    await vi.advanceTimersByTimeAsync(60);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(said).toEqual([]);
  });

  it('too slow: the device voice says it on time and the late audio is never played', async () => {
    const { device, said } = fakeDevice();
    const { natural, played } = fakeNatural({ delayMs: NATURAL_BUDGET_MS + 1000 });
    setReady(true);
    choose('natural');
    new SpeechRouter(device, natural).speak('Turn right now.', { lang: 'en-US', onEnd: () => undefined });
    await vi.advanceTimersByTimeAsync(NATURAL_BUDGET_MS + 10);
    expect(said.map((s) => s.text)).toEqual(['Turn right now.']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(played).toEqual([]);
  });

  it('synthesis error, no audio output, or not downloaded: the device voice speaks', async () => {
    for (const setup of [() => fakeNatural({ fail: true }), () => fakeNatural({ output: false })]) {
      const { device, said } = fakeDevice();
      setReady(true);
      choose('natural');
      new SpeechRouter(device, setup().natural).speak('Speed camera ahead.', { lang: 'en-US', onEnd: () => undefined });
      await vi.advanceTimersByTimeAsync(200);
      expect(said.map((s) => s.text)).toEqual(['Speed camera ahead.']);
    }
    const { device, said } = fakeDevice();
    setReady(false);
    new SpeechRouter(device, fakeNatural().natural).speak('Not downloaded.', { lang: 'en-US', onEnd: () => undefined });
    expect(said.map((s) => s.text)).toEqual(['Not downloaded.']);
  });

  it('cancelled while synthesizing (a more urgent message): nothing is played', async () => {
    const { device, said } = fakeDevice();
    const { natural, played } = fakeNatural();
    setReady(true);
    choose('natural');
    const router = new SpeechRouter(device, natural);
    const onEnd = vi.fn();
    router.speak('Weather ahead.', { lang: 'en-US', onEnd });
    router.cancel();
    await vi.advanceTimersByTimeAsync(NATURAL_BUDGET_MS + 500);
    expect(played).toEqual([]);
    expect(said).toEqual([]);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('a specific device voice chosen in Settings is passed on', () => {
    const { device, said } = fakeDevice();
    choose('device:Google US English');
    const router = new SpeechRouter(device, null);
    router.speak('Hi.', { lang: 'en-US', onEnd: () => undefined });
    expect(said[0].voiceURI).toBe('Google US English');
    expect(device.preferredVoice('en-US')).toBe('Google US English');
  });

  it('can speak a language if the device or the downloaded natural voice can', () => {
    setReady(false);
    expect(new SpeechRouter(fakeDevice(false).device, fakeNatural().natural).canSpeak('en-US')).toBe(false);
    setReady(true);
    expect(new SpeechRouter(fakeDevice(false).device, fakeNatural().natural).canSpeak('en-US')).toBe(true);
    expect(new SpeechRouter(fakeDevice(false).device, null).canSpeak('en-US')).toBe(false);
  });

  it('after a reload, finds out whether the natural voice was downloaded (and again on a language switch)', async () => {
    await loadLocale('ru'); // language switches wait for the text to load
    const check = vi.spyOn(useNaturalVoice.getState(), 'check').mockResolvedValue(undefined);
    useSettings.getState().update({ language: 'en' });
    new SpeechRouter(fakeDevice().device, fakeNatural().natural);
    expect(check).toHaveBeenCalledWith('en');
    useSettings.getState().update({ language: 'ru' });
    expect(check).toHaveBeenCalledWith('ru');
    check.mockRestore();
  });

  it('loads a voice as soon as its download finishes', () => {
    const { natural, raw } = fakeNatural();
    new SpeechRouter(fakeDevice().device, natural);
    setReady(true);
    expect(raw.prepare).toHaveBeenCalledWith('en');
  });
});
