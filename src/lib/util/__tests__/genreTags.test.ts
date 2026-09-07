import { describe, expect, it } from 'vitest';

import {
  normalizeGenreTag,
  normalizeTags,
  setJaccard,
  sharedTags,
  tagNameSet,
  weightedJaccard,
} from '@/lib/util/genreTags';

describe('normalizeGenreTag', () => {
  it('collapses the synth-pop spelling variants onto one canonical tag', () => {
    expect(normalizeGenreTag('Synth-Pop')).toEqual(['synthpop']);
    expect(normalizeGenreTag('synthpop')).toEqual(['synthpop']);
    expect(normalizeGenreTag('Synth Pop')).toEqual(['synthpop']);
  });

  it('applies the synonym map (goth -> gothic rock, rnb -> rhythm and blues)', () => {
    expect(normalizeGenreTag('Goth')).toEqual(['gothic rock']);
    expect(normalizeGenreTag('RnB')).toEqual(['rhythm and blues']);
  });

  it('splits a "/"-blob into its parts', () => {
    expect(normalizeGenreTag('rock/pop')).toEqual(['rock', 'pop']);
    expect(normalizeGenreTag('electro swing / nu jazz')).toEqual(['electro swing', 'nu jazz']);
  });

  it('folds diacritics and deletes apostrophes', () => {
    expect(normalizeGenreTag("Rock 'n' Roll")).toEqual(['rock n roll']);
    expect(normalizeGenreTag('Métal')).toEqual(['metal']);
  });

  it('drops nationality/language, decade, year and UUID junk', () => {
    expect(normalizeGenreTag('British')).toEqual([]);
    expect(normalizeGenreTag('britannique')).toEqual([]);
    expect(normalizeGenreTag('1985')).toEqual([]);
    expect(normalizeGenreTag('1980s')).toEqual([]);
    expect(normalizeGenreTag('80s')).toEqual([]);
    expect(normalizeGenreTag('seen live')).toEqual([]);
    expect(normalizeGenreTag('1c19fbb9-edce-49e1-a934-de6071dd7964')).toEqual([]);
  });
});

describe('normalizeTags', () => {
  it('sums counts of tags that collapse onto the same canonical name', () => {
    expect(
      normalizeTags([
        { name: 'synth-pop', count: 3 },
        { name: 'synthpop', count: 2 },
        { name: 'British', count: 9 },
      ]),
    ).toEqual([{ name: 'synthpop', count: 5 }]);
  });

  it('gives each part of a "/"-blob the full count', () => {
    expect(normalizeTags([{ name: 'rock/pop', count: 4 }])).toEqual([
      { name: 'pop', count: 4 },
      { name: 'rock', count: 4 },
    ]);
  });
});

describe('weightedJaccard', () => {
  it('is Σmin/Σmax over count>1 tags', () => {
    const seed = [
      { name: 'electro swing', count: 5 },
      { name: 'swing', count: 3 },
    ];
    const cand = [
      { name: 'electro swing', count: 2 },
      { name: 'jazz', count: 4 },
    ];
    // min: electro swing 2, swing 0, jazz 0 = 2; max: 5 + 3 + 4 = 12.
    expect(weightedJaccard(seed, cand)).toBeCloseTo(2 / 12, 6);
  });

  it('drops count-1 tags, so a single stray coincidence scores 0', () => {
    expect(
      weightedJaccard([{ name: 'rock', count: 1 }, { name: 'pop', count: 1 }], [{ name: 'rock', count: 1 }]),
    ).toBe(0);
  });

  it('is 1 for identical count>1 tag sets', () => {
    const t = [{ name: 'swing', count: 4 }];
    expect(weightedJaccard(t, t)).toBe(1);
  });

  it('is 0 for empty input', () => {
    expect(weightedJaccard([], [])).toBe(0);
    expect(weightedJaccard(null, undefined)).toBe(0);
  });
});

describe('sharedTags', () => {
  it('returns the shared canonical tags, strongest (min count) first', () => {
    const seed = [
      { name: 'electro swing', count: 5 },
      { name: 'swing', count: 3 },
      { name: 'jazz', count: 1 },
    ];
    const cand = [
      { name: 'electro swing', count: 2 },
      { name: 'jazz', count: 6 },
    ];
    expect(sharedTags(seed, cand)).toEqual([
      { name: 'electro swing', count: 2 },
      { name: 'jazz', count: 1 },
    ]);
  });
});

describe('setJaccard / tagNameSet', () => {
  it('is unweighted intersection over union', () => {
    const a = tagNameSet([{ name: 'rock', count: 1 }, { name: 'pop', count: 1 }]);
    const b = tagNameSet([{ name: 'rock', count: 1 }, { name: 'jazz', count: 1 }]);
    expect(setJaccard(a, b)).toBeCloseTo(1 / 3, 6);
  });
});
