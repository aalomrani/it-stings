import { describe, expect, it } from 'vitest';

import { buildFeatureProfile } from '@/lib/engine/featureProfile';
import { isGenreOnlyTrait, SCORED_DIMENSIONS } from '@/lib/engine/rank';
import {
  FLAG_WEAK_WHY_UNFIXED,
  scorePair,
  SIMILARITY_DIMENSIONS,
} from '@/lib/engine/similarity';
import type { SourceRef, TrackRecord } from '@/lib/types';

const SRC: SourceRef = { source: 'deezer' };
const AB: SourceRef = { source: 'acousticbrainz' };

function makeTrack(partial: Partial<TrackRecord> = {}): TrackRecord {
  return {
    key: 'deezer:1',
    isrc: null,
    title: 'Seed Title',
    artist: 'Seed Artist',
    album: null,
    year: null,
    durationMs: null,
    artwork: null,
    preview: null,
    tempoBpm: null,
    keySignature: null,
    links: {},
    ids: {},
    tags: null,
    features: null,
    resolvedAt: 0,
    degraded: [],
    ...partial,
  };
}

const profile = (partial: Partial<TrackRecord>) => buildFeatureProfile(makeTrack(partial));

/** Pull one dimension's score out of a scorePair result. */
function dim(dims: ReturnType<typeof scorePair>['dimensions'], name: string): number {
  const found = dims.find((d) => d.dimension === name);
  if (!found) throw new Error(`no dimension ${name}`);
  return found.score;
}

describe('dimension contract', () => {
  it('emits exactly rank.SCORED_DIMENSIONS, in order', () => {
    expect([...SIMILARITY_DIMENSIONS]).toEqual(SCORED_DIMENSIONS);
    const { dimensions } = scorePair(
      profile({ tempoBpm: { value: 92, source: SRC } }),
      profile({ tempoBpm: { value: 92, source: SRC } }),
    );
    expect(dimensions.map((d) => d.dimension)).toEqual(SCORED_DIMENSIONS);
    expect(dimensions).toHaveLength(9);
  });

  it('stamps the honest pair tier into every note', () => {
    const { dimensions } = scorePair(
      profile({ tempoBpm: { value: 92, source: SRC } }),
      profile({ tempoBpm: { value: 92, source: SRC } }),
    );
    for (const d of dimensions) expect(d.note).toContain('[bpm+tags]');
  });
});

describe('rhythmic_character (bpm gaussian)', () => {
  it('is 1.0 for an identical bpm', () => {
    const { dimensions } = scorePair(
      profile({ tempoBpm: { value: 92, source: SRC } }),
      profile({ tempoBpm: { value: 92, source: SRC } }),
    );
    expect(dim(dimensions, 'rhythmic_character')).toBe(1);
  });

  it('is exp(-(Δ/12)^2) for a bpm gap', () => {
    const { dimensions } = scorePair(
      profile({ tempoBpm: { value: 92, source: SRC } }),
      profile({ tempoBpm: { value: 95, source: SRC } }),
    );
    expect(dim(dimensions, 'rhythmic_character')).toBeCloseTo(Math.exp(-((3 / 12) ** 2)), 4);
  });

  it('is a low-confidence neutral when neither track has a bpm', () => {
    const { dimensions } = scorePair(profile({}), profile({}));
    expect(dim(dimensions, 'rhythmic_character')).toBe(0.5);
  });
});

describe('harmonic_language (key / scale / Camelot)', () => {
  it('scores 1.0 for the same key and names it in the why', () => {
    const seed = profile({ keySignature: { value: 'F major', source: AB } });
    const cand = profile({ keySignature: { value: 'F major', source: AB } });
    const res = scorePair(seed, cand);
    expect(dim(res.dimensions, 'harmonic_language')).toBe(1);
    expect(res.sharedTraits).toContain('both in F major');
    expect(res.why.toLowerCase()).toContain('both in f major');
    expect(res.flags).not.toContain(FLAG_WEAK_WHY_UNFIXED);
  });

  it('rewards a relative major/minor as harmonically adjacent', () => {
    // F major and D minor are relative keys (Camelot 7B / 7A).
    const res = scorePair(
      profile({ keySignature: { value: 'F major', source: AB } }),
      profile({ keySignature: { value: 'D minor', source: AB } }),
    );
    expect(dim(res.dimensions, 'harmonic_language')).toBeCloseTo(0.7, 6);
  });
});

describe('emotional_register (mood vector)', () => {
  it('is 1.0 for an identical mood vector and names the classifiers', () => {
    const moods = {
      source: AB,
      danceability: 0.7,
      moodHappy: 0.3,
      moodSad: 0.6,
      moodAggressive: 0.1,
      moodRelaxed: 0.8,
    };
    const res = scorePair(profile({ features: moods }), profile({ features: moods }));
    expect(dim(res.dimensions, 'emotional_register')).toBe(1);
    expect(res.sharedTraits).toContain('both classified relaxed and low-aggression');
  });
});

describe('cover / same-song detection', () => {
  it('flags a same-title different-artist candidate as a cover', () => {
    const seed = profile({ title: 'The Lovecats', artist: 'The Cure' });
    const cover = profile({ title: 'The Lovecats', artist: 'Some Tribute Band' });
    expect(scorePair(seed, cover).isCoverOrSameSong).toBe(true);
  });

  it('does not flag a same-title SAME-artist pair as a cover', () => {
    const seed = profile({ title: 'The Lovecats', artist: 'The Cure' });
    const same = profile({ title: 'The Lovecats', artist: 'The Cure' });
    expect(scorePair(seed, same).isCoverOrSameSong).toBe(false);
  });
});

describe('genre-only honesty guard', () => {
  const tagsOnly = (names: [string, number][]) =>
    profile({ tags: { value: names.map(([name, count]) => ({ name, count })), source: SRC } });

  it('raises FLAG_WEAK_WHY_UNFIXED when the only agreement is genre tags', () => {
    const seed = tagsOnly([['rock', 5], ['pop', 3]]);
    const cand = tagsOnly([['rock', 4], ['pop', 2]]);
    const res = scorePair(seed, cand);
    expect(res.flags).toContain(FLAG_WEAK_WHY_UNFIXED);
    expect(res.sharedTraits.length).toBeGreaterThan(0);
    // Every shared trait is genre-only, which is exactly what rank.ts rule 4 cuts.
    expect(res.sharedTraits.every(isGenreOnlyTrait)).toBe(true);
    expect(res.why).toContain('Shared tags');
  });

  it('does NOT raise the flag when a concrete trait leads the why', () => {
    const seed = tagsOnly([['rock', 5], ['pop', 3]]);
    const cand = profile({
      tempoBpm: { value: 120, source: SRC },
      tags: { value: [{ name: 'rock', count: 4 }, { name: 'pop', count: 2 }], source: SRC },
    });
    const seedWithBpm = profile({
      tempoBpm: { value: 122, source: SRC },
      tags: { value: [{ name: 'rock', count: 5 }, { name: 'pop', count: 3 }], source: SRC },
    });
    void seed;
    const res = scorePair(seedWithBpm, cand);
    expect(res.flags).not.toContain(FLAG_WEAK_WHY_UNFIXED);
    // At least one shared trait is concrete (passes the genre-only guard).
    expect(res.sharedTraits.some((t) => !isGenreOnlyTrait(t))).toBe(true);
    expect(res.why.endsWith('.')).toBe(true);
  });

  it('reports no measured traits honestly for two bare tracks', () => {
    const res = scorePair(profile({}), profile({}));
    expect(res.sharedTraits).toEqual([]);
    expect(res.flags).toContain(FLAG_WEAK_WHY_UNFIXED);
    expect(res.why).toBe('No concrete shared musical traits were measured.');
  });
});
