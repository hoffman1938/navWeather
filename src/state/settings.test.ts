import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings, useSettings } from './settings';

describe('stored settings', () => {
  const base = defaultSettings();

  it('keeps valid stored values and fills in new ones with defaults', () => {
    const s = parseSettings(JSON.stringify({ language: 'ru', theme: 'dark', units: { distance: 'imperial' }, speedCameras: true }), base);
    expect(s).toMatchObject({ language: 'ru', theme: 'dark', speedCameras: true, driverReports: true });
    expect(s.units).toEqual({ ...base.units, distance: 'imperial' });
  });

  it('ignores values an older or hand-edited copy could hold', () => {
    const s = parseSettings(
      JSON.stringify({
        language: 'fr',
        theme: 'blue',
        voice: 'yes',
        alertOutput: 'loud',
        units: { distance: 'furlongs', wind: 'knots' },
        weatherAlerts: { level: 'extreme', types: { rain: false, snow: 'no' } },
        fuelRangeKm: -5,
      }),
      base,
    );
    expect(s.language).toBe(base.language);
    expect(s.theme).toBe('auto');
    expect(s.voice).toBe(true);
    expect(s.alertOutput).toBe('both');
    expect(s.units).toEqual(base.units);
    expect(s.weatherAlerts).toEqual({ level: 'all', types: { rain: false, snow: true, fog: true, wind: true, temperature: true } });
    expect(s.fuelRangeKm).toBeNull();
  });

  it('keeps valid voice choices per language and drops anything else', () => {
    const s = parseSettings(JSON.stringify({ voiceByLang: { en: 'device:Google US English', ru: 'auto', ka: 'auto', fr: 'auto' } }), base);
    expect(s.voiceByLang).toEqual({ en: 'device:Google US English', ru: 'auto' });
    // The downloadable natural voice is gone: such a choice falls back to automatic.
    expect(parseSettings(JSON.stringify({ voiceByLang: { ru: 'natural:ru_RU-ruslan-medium', en: 'natural' } }), base).voiceByLang).toEqual({});
    // Georgian was removed: a saved Georgian UI falls back to the default language.
    expect(parseSettings(JSON.stringify({ language: 'ka' }), base).language).toBe(base.language);
    expect(parseSettings(JSON.stringify({ voiceByLang: 'natural' }), base).voiceByLang).toEqual({});
  });

  it('survives missing or broken storage', () => {
    expect(parseSettings(null, base)).toEqual(base);
    expect(parseSettings('{not json', base)).toEqual(base);
    expect(parseSettings('null', base)).toEqual(base);
    expect(parseSettings('42', base)).toEqual(base);
  });
});

describe('speed camera alerts are on by default', () => {
  const base = defaultSettings();

  it('on for a new user', () => {
    expect(base.speedCameras).toBe(true);
    expect(parseSettings(null, base).speedCameras).toBe(true);
  });

  it('on for someone whose stored "off" was only the old default, not their choice', () => {
    expect(parseSettings(JSON.stringify({ speedCameras: false }), base).speedCameras).toBe(true);
  });

  it('off for someone who switched them off themselves — and it stays off', () => {
    const stored = JSON.stringify({ speedCameras: false, speedCamerasChosen: true });
    expect(parseSettings(stored, base)).toMatchObject({ speedCameras: false, speedCamerasChosen: true });
  });

  it('switching them in the app counts as a choice', () => {
    useSettings.getState().reset();
    expect(useSettings.getState().speedCamerasChosen).toBe(false);
    useSettings.getState().update({ speedCameras: false });
    const saved = parseSettings(localStorage.getItem('navweather.settings.v1'), base);
    expect(saved).toMatchObject({ speedCameras: false, speedCamerasChosen: true });
    useSettings.getState().reset();
  });
});

