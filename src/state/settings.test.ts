import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings } from './settings';

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

  it('survives missing or broken storage', () => {
    expect(parseSettings(null, base)).toEqual(base);
    expect(parseSettings('{not json', base)).toEqual(base);
    expect(parseSettings('null', base)).toEqual(base);
    expect(parseSettings('42', base)).toEqual(base);
  });
});
