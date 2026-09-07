/**
 * The reorder arithmetic, on its own. Both ways of moving a row — the pointer drag and
 * Alt+↑/↓ — go through `move`, and what gets PATCHed is `orderOf` of its result, so these
 * are the only two functions that can put a playlist in the wrong order.
 */

import { describe, expect, it } from 'vitest';

import { exportHref, move, orderChanged, orderOf } from '@/lib/client/playlists';

const rows = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }];

describe('move', () => {
  it('lifts a row out and drops it in, closing up behind it', () => {
    expect(orderOf(move(rows, 0, 2) as { id: number }[])).toEqual([20, 30, 10, 40]);
    expect(orderOf(move(rows, 3, 0) as { id: number }[])).toEqual([40, 10, 20, 30]);
    expect(orderOf(move(rows, 2, 1) as { id: number }[])).toEqual([10, 30, 20, 40]);
  });

  it('returns the SAME array for a no-op, so a pointerup can skip the request', () => {
    expect(move(rows, 1, 1)).toBe(rows);
    expect(move(rows, -1, 2)).toBe(rows);
    expect(move(rows, 9, 2)).toBe(rows);
  });

  it('clamps a drop past either end rather than losing the row', () => {
    expect(orderOf(move(rows, 1, 99) as { id: number }[])).toEqual([10, 30, 40, 20]);
    expect(orderOf(move(rows, 2, -5) as { id: number }[])).toEqual([30, 10, 20, 40]);
  });

  it('never drops or duplicates a row', () => {
    for (let from = 0; from < rows.length; from += 1) {
      for (let to = 0; to < rows.length; to += 1) {
        const next = move(rows, from, to);
        expect(orderOf(next as { id: number }[]).slice().sort((a, b) => a - b)).toEqual([
          10, 20, 30, 40,
        ]);
      }
    }
  });

  it('does not mutate the array it was given', () => {
    move(rows, 0, 3);
    expect(orderOf(rows)).toEqual([10, 20, 30, 40]);
  });
});

describe('orderChanged', () => {
  it('is false only when the two orders are identical', () => {
    expect(orderChanged([1, 2, 3], [1, 2, 3])).toBe(false);
    expect(orderChanged([1, 2, 3], [1, 3, 2])).toBe(true);
    expect(orderChanged([1, 2, 3], [1, 2])).toBe(true);
  });
});

describe('exportHref', () => {
  it('points at the export route with the format the button says', () => {
    expect(exportHref('pl_a b', 'txt')).toBe('/api/playlists/pl_a%20b/export?format=txt');
    expect(exportHref('pl_1', 'json')).toBe('/api/playlists/pl_1/export?format=json');
  });
});
