import { describe, expect, it } from 'vitest';
import { parseCommand } from './parser';

describe('navigation command parser', () => {
  it.each([
    ["What's the weather ahead?", { type: 'weather_ahead' }],
    ['Is it going to rain?', { type: 'rain_when' }],
    ['When will the rain start?', { type: 'rain_when' }],
    ['How long until the rain?', { type: 'rain_when' }],
    ["What's the weather in Kutaisi?", { type: 'weather_at', place: 'Kutaisi' }],
    ["What's my ETA?", { type: 'eta' }],
    ['How far is Batumi?', { type: 'distance_to', place: 'Batumi' }],
    ['How far is it?', { type: 'distance_to', place: undefined }],
    ["What's my next turn?", { type: 'next_turn' }],
    ['Are there traffic problems ahead?', { type: 'traffic' }],
    ['Find a gas station nearby', { type: 'find_poi', category: 'fuel', maxDetourMin: undefined, near: undefined }],
    ['Find a restaurant with less than 5 minutes detour', { type: 'find_poi', category: 'restaurant', maxDetourMin: 5, near: undefined }],
    ['Find an EV charger ahead', { type: 'find_poi', category: 'ev_charging', maxDetourMin: undefined, near: undefined }],
    ['Find a hotel near Batumi', { type: 'find_poi', category: 'hotel', maxDetourMin: undefined, near: 'Batumi' }],
    ['Show another route', { type: 'alternatives' }],
    ['Avoid toll roads', { type: 'avoid', what: 'tolls' }],
    ['Avoid highways', { type: 'avoid', what: 'highways' }],
    ['Stop navigation', { type: 'stop_navigation' }],
    ['Where am I?', { type: 'where_am_i' }],
    ['Mute', { type: 'mute' }],
    ['Какая погода впереди?', { type: 'weather_ahead' }],
    ['Где я?', { type: 'where_am_i' }],
    ['სად ვარ?', { type: 'where_am_i' }],
  ])('%s', (text, intent) => {
    expect(parseCommand(text)).toEqual(intent);
  });

  it('uses context for follow-ups', () => {
    expect(parseCommand('What about Kutaisi?', { last: { type: 'weather_at', place: 'Gori' } })).toEqual({
      type: 'weather_at',
      place: 'Kutaisi',
    });
    expect(parseCommand('And Kutaisi?', { last: { type: 'distance_to', place: 'Batumi' } })).toEqual({
      type: 'distance_to',
      place: 'Kutaisi',
    });
  });

  it('reports unknown input rather than guessing', () => {
    expect(parseCommand('purple elephants').type).toBe('unknown');
  });
});

describe('route and safety commands', () => {
  it('recalculate', () => {
    for (const u of ['Recalculate route', 'reroute', 'update my route', 'Пересчитай маршрут', 'გადაითვალე მარშრუტი']) {
      expect(parseCommand(u).type).toBe('recalculate');
    }
  });
  it('find a hospital', () => {
    expect(parseCommand('Find a hospital')).toMatchObject({ type: 'find_poi', category: 'hospital' });
    expect(parseCommand('Где ближайшая больница?')).toMatchObject({ type: 'find_poi', category: 'hospital' });
  });
});

describe('driver reports by voice', () => {
  it.each([
    ['Report an accident', 'accident'],
    ['report a crash', 'accident'],
    ['Report road works', 'roadworks'],
    ['report construction', 'roadworks'],
    ['Report the road is closed', 'closure'],
    ['Report ice on the road', 'weather'],
    ['Report fog', 'weather'],
    ['Report a hazard', 'hazard'],
    ['report a pothole', 'hazard'],
    ['I want to report an accident', 'accident'],
    ['Сообщи о ДТП', 'accident'],
    ['Сообщить о гололёде', 'weather'],
    ['Отметь ремонт дороги', 'roadworks'],
    ['Сообщи, что дорога перекрыта', 'closure'],
    ['Сообщи о яме на дороге', 'hazard'],
    ['შეატყობინე ავარია', 'accident'],
    ['შეატყობინე ნისლი', 'weather'],
  ])('%s', (text, kind) => {
    expect(parseCommand(text)).toEqual({ type: 'report', kind });
  });

  it('keeps questions about reports as questions', () => {
    expect(parseCommand('Any accident reports ahead?').type).not.toBe('report');
    expect(parseCommand('Is there an accident ahead?').type).toBe('traffic');
    expect(parseCommand('Есть сообщения о ДТП?').type).not.toBe('report');
    // Russian word pieces must not trigger a report ("следующий" contains "лед", "прямая" contains "яма").
    expect(parseCommand('Сообщи следующий поворот').type).not.toBe('report');
    expect(parseCommand('Сообщи, дорога прямая').type).not.toBe('report');
  });

  it('a report without a recognisable kind is not guessed', () => {
    expect(parseCommand('Report something').type).toBe('unknown');
  });
});
