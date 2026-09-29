import { describe, expect, it } from 'vitest';
import { chargingSummary, parseCharging, parseOutputKw, socketName } from './evCharging';

const upTo = (kw: string) => `up to ${kw}`;

describe('EV charging details from OSM tags', () => {
  it('parses outputs in the forms mappers use', () => {
    expect(parseOutputKw('50 kW')).toBe(50);
    expect(parseOutputKw('22kW')).toBe(22);
    expect(parseOutputKw('7,4 kW')).toBe(7.4);
    expect(parseOutputKw('50000 W')).toBe(50);
    expect(parseOutputKw('150 kW;50 kW')).toBe(150);
    expect(parseOutputKw('fast')).toBeUndefined();
    expect(parseOutputKw(undefined)).toBeUndefined();
  });

  it('lists connectors fast-first with counts and the fastest output', () => {
    const info = parseCharging({
      amenity: 'charging_station',
      'socket:type2': '2',
      'socket:type2:output': '22 kW',
      'socket:type2_combo': '1',
      'socket:type2_combo:output': '150 kW',
      'socket:chademo': 'no',
      capacity: '3',
    })!;
    expect(info.sockets.map((s) => s.type)).toEqual(['type2_combo', 'type2']);
    expect(info.maxKw).toBe(150);
    expect(info.capacity).toBe(3);
    expect(chargingSummary(info, upTo)).toBe('CCS2 · Type 2 ×2 · up to 150 kW');
  });

  it('nothing mapped → nothing claimed; unknown sockets keep their OSM name', () => {
    expect(parseCharging({ amenity: 'charging_station', name: 'X' })).toBeUndefined();
    const info = parseCharging({ 'socket:type2': 'yes', 'socket:cee_blue': 'yes' })!;
    expect(info.maxKw).toBeUndefined();
    expect(chargingSummary(info, upTo)).toBe('Type 2 · Cee Blue');
    expect(socketName('type2_combo')).toBe('CCS2');
  });

  it('station-level output when sockets have none', () => {
    const info = parseCharging({ 'socket:type2': '4', 'charging_station:output': '11 kW' })!;
    expect(chargingSummary(info, upTo)).toBe('Type 2 ×4 · up to 11 kW');
  });
});
