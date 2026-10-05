import { describe, expect, it } from 'vitest';
import { cellOf, decodeHeader, ELEV_BLOCKS, elevTileKey, elevTileOf, encodeHeader, parseElevationQuery, tileStatus } from './elevation';

/** Our DEM tiles (DP-4.7): header and block index, where a point falls, the query. */

describe('elevation tiles', () => {
  const h = { rows: 1200, cols: 1200, blockRows: 120, blockCols: 120, lat: 41, lon: 44 };

  it('the header and the block index survive the trip through bytes', () => {
    const blocks = Array.from({ length: ELEV_BLOCKS * ELEV_BLOCKS }, (_, i) => ({ offset: 820 + i * 100, length: i % 7 ? 100 : 0 }));
    const back = decodeHeader(encodeHeader(h, blocks).buffer as ArrayBuffer)!;
    expect(back).toMatchObject(h);
    expect(back.offsets[3]).toBe(1120);
    expect(back.lengths[7]).toBe(0);
    expect(decodeHeader(new ArrayBuffer(820))).toBeNull(); // no magic
  });

  it('a point → its tile, its DEM cell (the one it lies in) and the block holding it', () => {
    expect(elevTileOf(41.6935, 44.8015)).toEqual({ lat: 41, lon: 44 });
    expect(elevTileOf(-33.87, 151.21)).toEqual({ lat: -34, lon: 151 });
    expect(elevTileOf(90, 180)).toEqual({ lat: 89, lon: 179 });
    expect(elevTileKey(-34, 151)).toBe('elev/v1/-34/151.bin');
    // Tbilisi: row 832, column 961 → block (6, 8), cell (112, 1) inside it.
    expect(cellOf(h, 41.6935, 44.8015)).toEqual({ block: 68, i: 112 * 120 + 1 });
    expect(cellOf(h, 41, 44)).toEqual({ block: 0, i: 0 });
    expect(cellOf(h, 41.99999, 44.99999)).toEqual({ block: 99, i: 119 * 120 + 119 });
    // Fewer columns towards the poles (800 per degree between 50° and 60°).
    expect(cellOf({ ...h, lat: 55, lon: 37, cols: 800, blockCols: 80 }, 55.5, 37.5).block).toBe(55);
  });

  it('a tile is built, known to be sea, or unknown (another area: the client asks elsewhere)', () => {
    const index = { tiles: new Set(['41/44']), sea: new Set(['42/38']) };
    expect(tileStatus(index, 41.69, 44.8)).toBe('land');
    expect(tileStatus(index, 42.5, 38.5)).toBe('sea');
    expect(tileStatus(index, 41.01, 28.97)).toBe('unknown');
    expect(tileStatus(index, 42, 44.8)).toBe('unknown'); // the north edge belongs to the next row of tiles
  });

  it('reads the Open-Meteo-style query', () => {
    expect(parseElevationQuery(new URLSearchParams('latitude=41.69,42.66&longitude=44.80,44.64'))).toEqual([
      { lat: 41.69, lon: 44.8 },
      { lat: 42.66, lon: 44.64 },
    ]);
    expect(parseElevationQuery(new URLSearchParams('latitude=1&longitude=1,2'))).toMatch(/same length/);
    expect(parseElevationQuery(new URLSearchParams('latitude=95&longitude=1'))).toMatch(/range/);
    expect(parseElevationQuery(new URLSearchParams(`latitude=${Array(101).fill(1)}&longitude=${Array(101).fill(1)}`))).toMatch(/at most/);
  });
});
