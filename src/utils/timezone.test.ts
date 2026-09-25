import { describe, expect, it } from 'vitest';
import {
  formatLocalTime,
  formatUtcOffset,
  parseDateTimeLocal,
  timeZoneOffsetMinutes,
  toDateTimeLocalValue,
  zonedWallTimeToUtc,
} from './timezone';
import { formatDuration, formatRelative } from './time';

const T = Date.UTC(2026, 8, 26, 4, 5); // 2026-09-26 04:05Z

describe('timezone conversion', () => {
  it('formats the same instant differently per route location', () => {
    expect(formatLocalTime(T, 'Asia/Tbilisi')).toBe('08:05'); // UTC+4
    expect(formatLocalTime(T, 'Europe/Istanbul')).toBe('07:05'); // UTC+3
    expect(formatLocalTime(T, 'UTC')).toBe('04:05');
  });

  it('computes offsets and labels', () => {
    expect(timeZoneOffsetMinutes(T, 'Asia/Tbilisi')).toBe(240);
    expect(formatUtcOffset(T, 'Asia/Tbilisi')).toBe('GMT+4');
    expect(formatUtcOffset(T, 'Asia/Kolkata')).toBe('GMT+5:30');
    expect(formatUtcOffset(T, 'America/New_York')).toBe('GMT−4');
  });

  it('converts a wall time in the route timezone to UTC (not the device timezone)', () => {
    const utc = zonedWallTimeToUtc({ year: 2026, month: 9, day: 26, hour: 8, minute: 5 }, 'Asia/Tbilisi');
    expect(utc).toBe(T);
    expect(parseDateTimeLocal('2026-09-26T08:05', 'Asia/Tbilisi')).toBe(T);
    expect(toDateTimeLocalValue(T, 'Asia/Tbilisi')).toBe('2026-09-26T08:05');
  });

  it('handles DST transitions', () => {
    // Europe/Berlin springs forward 2026-03-29 02:00 → 03:00.
    const skipped = zonedWallTimeToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, 'Europe/Berlin');
    expect(formatLocalTime(skipped, 'Europe/Berlin')).toBe('03:30');
    // Falls back 2026-10-25 03:00 → 02:00; 02:30 occurs twice → earlier (CEST) instant.
    const repeated = zonedWallTimeToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, 'Europe/Berlin');
    expect(repeated).toBe(Date.UTC(2026, 9, 25, 0, 30));
    // Summer / winter offsets
    expect(timeZoneOffsetMinutes(Date.UTC(2026, 6, 1), 'Europe/Berlin')).toBe(120);
    expect(timeZoneOffsetMinutes(Date.UTC(2026, 0, 1), 'Europe/Berlin')).toBe(60);
  });
});

describe('duration formatting', () => {
  it('formats travel durations', () => {
    expect(formatDuration(0)).toBe('<1 min');
    expect(formatDuration(55 * 60)).toBe('55 min');
    expect(formatDuration(5 * 3600 + 5 * 60)).toBe('5h 05m');
    expect(formatDuration(2 * 3600)).toBe('2h');
    expect(formatRelative(30)).toBe('Now');
    expect(formatRelative(105 * 60)).toBe('+1h 45m');
  });
});
