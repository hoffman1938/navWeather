import { describe, expect, it } from 'vitest';
import { pickLocalVoice, pickVoice, voiceQuality, voicesFor, type VoiceInfo } from './voices';

const v = (name: string, lang: string, localService = true, extra: Partial<VoiceInfo> = {}): VoiceInfo => ({ name, lang, voiceURI: name, localService, ...extra });

// What real browsers report (abridged).
const windowsChrome = [
  v('Microsoft David - English (United States)', 'en-US', true, { default: true }),
  v('Microsoft Zira Desktop - English (United States)', 'en-US'),
  v('Google US English', 'en-US', false),
  v('Google UK English Female', 'en-GB', false),
  v('Google русский', 'ru-RU', false),
  v('Microsoft Irina Desktop - Russian', 'ru-RU'),
];
const edge = [
  v('Microsoft David - English (United States)', 'en-US', true, { default: true }),
  v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
  v('Microsoft Eka Online (Natural) - Georgian (Georgia)', 'ka-GE', false),
];
const iphone = [v('Samantha', 'en-US', true, { default: true }), v('Samantha (Enhanced)', 'en-US'), v('Fred', 'en-US'), v('Milena', 'ru-RU')];
const linux = [v('English (America)+espeak', 'en-US'), v('Russian+espeak', 'ru')];

describe('device voices', () => {
  it('prefers natural-sounding voices over the robotic default', () => {
    expect(pickVoice(windowsChrome, 'en-US', { online: true })?.name).toBe('Google US English');
    expect(pickVoice(edge, 'en-US', { online: true })?.name).toMatch(/Aria Online \(Natural\)/);
    expect(pickVoice(iphone, 'en-US', { online: true })?.name).toBe('Samantha (Enhanced)');
    expect(pickVoice(windowsChrome, 'ru-RU', { online: true })?.name).toBe('Google русский');
  });

  it('labels quality from the name', () => {
    expect(voiceQuality(edge[1])).toBe('natural');
    expect(voiceQuality(windowsChrome[2])).toBe('good');
    expect(voiceQuality(windowsChrome[1])).toBe('basic');
    expect(voiceQuality(iphone[2])).toBe('basic'); // novelty voice
    expect(voiceQuality(linux[0])).toBe('basic');
  });

  it('offline, never picks a voice that needs the internet', () => {
    expect(pickVoice(windowsChrome, 'en-US', { online: false })?.localService).toBe(true);
    expect(pickVoice(edge, 'en-US', { online: false })?.name).toMatch(/David/);
    expect(pickLocalVoice(windowsChrome, 'ru-RU')?.name).toBe('Microsoft Irina Desktop - Russian');
  });

  it('honours the voice chosen in Settings (if it can work right now and fits the language)', () => {
    expect(pickVoice(windowsChrome, 'en-US', { online: true, preferredURI: 'Microsoft Zira Desktop - English (United States)' })?.name).toMatch(/Zira/);
    // Online-only choice while offline → best local voice instead.
    expect(pickVoice(windowsChrome, 'en-US', { online: false, preferredURI: 'Google US English' })?.localService).toBe(true);
    // A voice of another language is never used.
    expect(pickVoice(windowsChrome, 'en-US', { online: true, preferredURI: 'Google русский' })?.name).toBe('Google US English');
  });

  it('lists only the language, best first, and finds nothing for a language the device lacks', () => {
    expect(voicesFor(windowsChrome, 'en-US').map((x) => x.name)).toEqual([
      'Google US English',
      'Google UK English Female',
      'Microsoft David - English (United States)',
      'Microsoft Zira Desktop - English (United States)',
    ]);
    expect(voicesFor(windowsChrome, 'ka-GE')).toEqual([]);
    expect(voicesFor(edge, 'ka-GE').map((x) => x.name)).toEqual(['Microsoft Eka Online (Natural) - Georgian (Georgia)']);
    expect(voicesFor(linux, 'ru-RU').map((x) => x.name)).toEqual(['Russian+espeak']);
  });
});
