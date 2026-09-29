import { describe, expect, it } from 'vitest';
import { googleVoicesFor, pickLocalVoice, pickVoice, type VoiceInfo } from './voices';

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
];
const iphone = [v('Samantha', 'en-US', true, { default: true }), v('Samantha (Enhanced)', 'en-US'), v('Milena', 'ru-RU')];

describe('Google voices only', () => {
  it('speaks with a Google voice when the browser has one', () => {
    expect(pickVoice(windowsChrome, 'en-US', { online: true })?.name).toBe('Google US English');
    expect(pickVoice(windowsChrome, 'ru-RU', { online: true })?.name).toBe('Google русский');
  });

  it('lists only Google voices for the language, the exact region first', () => {
    expect(googleVoicesFor(windowsChrome, 'en-US').map((x) => x.name)).toEqual(['Google US English', 'Google UK English Female']);
    expect(googleVoicesFor(windowsChrome, 'ru-RU').map((x) => x.name)).toEqual(['Google русский']);
    expect(googleVoicesFor(edge, 'en-US')).toEqual([]);
  });

  it('honours the Google voice chosen in Settings; other voices and languages are never chosen', () => {
    expect(pickVoice(windowsChrome, 'en-US', { online: true, preferredURI: 'Google UK English Female' })?.name).toBe('Google UK English Female');
    expect(pickVoice(windowsChrome, 'en-US', { online: true, preferredURI: 'Microsoft Zira Desktop - English (United States)' })?.name).toBe('Google US English');
    expect(pickVoice(windowsChrome, 'en-US', { online: true, preferredURI: 'Google русский' })?.name).toBe('Google US English');
  });

  it('no Google voice (Edge, Safari): the browser’s own voice, so guidance is never silent', () => {
    expect(pickVoice(edge, 'en-US', { online: true })?.name).toMatch(/David/);
    expect(pickVoice(iphone, 'ru-RU', { online: true })?.name).toBe('Milena');
  });

  it('offline: Google voices need a connection, so a device voice speaks', () => {
    expect(pickVoice(windowsChrome, 'en-US', { online: false })?.name).toMatch(/David/);
    expect(pickLocalVoice(windowsChrome, 'ru-RU')?.name).toBe('Microsoft Irina Desktop - Russian');
  });
});
