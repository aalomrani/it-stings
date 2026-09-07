/**
 * The ranking rules are the only place where the app decides what the user sees, so every
 * rule in docs/architecture.md ("Code-enforced ranking rules") gets its own test with
 * hand-built fixtures. No I/O, no clock, no network.
 */

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_BONUS,
  FLAG_COVER_OR_SAME_SONG,
  FLAG_GENERIC_WHY,
  DEFAULT_DIMENSION_WEIGHTS,
  ENTHUSIASM_BONUS,
  GENRE_ONLY_TERMS,
  SAME_ARTIST_MIN_SCORE,
  finalScore,
  isGenreOnly,
  isGenreOnlyTrait,
  isSameArtist,
  modelScore,
  primaryGenre,
  decadeOf,
  rank,
} from '@/lib/engine/rank';
import type {
  Channel,
  DimensionScore,
  Evidence,
  Recommendation,
  TrackRecord,
} from '@/lib/types';

/* ------------------------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------------------------ */

function track(over: Partial<TrackRecord> & { artist: string; title: string }): TrackRecord {
  const base: TrackRecord = {
    key: '',
    isrc: null,
    title: over.title,
    artist: over.artist,
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
  };
  const merged = { ...base, ...over };
  return {
    ...merged,
    key: merged.key || `deezer:${over.artist}-${over.title}`.replace(/\s+/g, '_'),
  };
}

const YEAR = (value: number): TrackRecord['year'] => ({
  value,
  source: { source: 'itunes', field: 'releaseDate' },
});

const ALL_DIMENSIONS = Object.keys(DEFAULT_DIMENSION_WEIGHTS) as DimensionScore['dimension'][];

/** Every dimension at the same score, unless `over` names a different value for one. */
function dims(base: number, over: Partial<Record<string, number>> = {}): DimensionScore[] {
  return ALL_DIMENSIONS.map((dimension) => ({
    dimension,
    score: over[dimension] ?? base,
    note: 'fixture',
  }));
}

function rec(over: {
  artist: string;
  title?: string;
  key?: string;
  channels?: Channel[];
  dimensions?: DimensionScore[];
  evidence?: Evidence[];
  sharedTraits?: string[];
  why?: string;
  year?: number;
  genreLabels?: string[];
}): Recommendation {
  const t = track({
    artist: over.artist,
    title: over.title ?? 'A Song',
    key: over.key,
    year: over.year === undefined ? null : YEAR(over.year),
    features: over.genreLabels
      ? { source: { source: 'acousticbrainz' }, genreLabels: over.genreLabels }
      : null,
  });
  return {
    track: t,
    channels: over.channels ?? ['A'],
    evidence: over.evidence ?? [],
    dimensions: over.dimensions ?? dims(0.8),
    modelScore: 0,
    finalScore: 0,
    why: over.why ?? 'the same swung upright-bass walk under a nonsense-syllable vocal',
    sharedTraits: over.sharedTraits ?? ['walking upright bass in quarters'],
    sameArtist: false,
    flags: [],
  };
}

const seed = track({ artist: 'The Cure', title: 'The Lovecats', year: YEAR(1983) });

const LIVE_ALL: Channel[] = ['A', 'B', 'C'];

/* ------------------------------------------------------------------------------------ *
 * modelScore — the weighted mean (rule 3, first half)
 * ------------------------------------------------------------------------------------ */

describe('modelScore: weighted mean of the nine dimensions', () => {
  it('the DEFAULT distribution sums to 27 — the user weights (genre=scene_context 5)', () => {
    const total = Object.values(DEFAULT_DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(27);
    expect(DEFAULT_DIMENSION_WEIGHTS).toMatchObject({
      rhythmic_character: 6,
      vocal_delivery: 0,
      emotional_register: 6,
      scene_context: 5, // shown as "genre" in the UI
      signature_hook: 0,
      instrumentation: 3,
      harmonic_language: 2,
      production_texture: 1,
      era: 4,
      tempo_feel: 0,
    });
  });

  it('all dimensions equal -> that value', () => {
    expect(modelScore(dims(0.6))).toBe(0.6);
    expect(modelScore(dims(1))).toBe(1);
  });

  it('under the DEFAULT, genre (scene_context) and era both count; vocals/hook do not', () => {
    const d = dims(0, {
      rhythmic_character: 0.9, // weight 6
      vocal_delivery: 0.8, // weight 0 -> contributes nothing
      emotional_register: 0.7, // weight 6
      scene_context: 0.6, // weight 5 (genre)
      signature_hook: 0.5, // weight 0 -> contributes nothing
      instrumentation: 0.4, // weight 3
      harmonic_language: 0.3, // weight 2
      production_texture: 0.2, // weight 1
      era: 1, // weight 4
    });
    // (6·.9+6·.7+5·.6+3·.4+2·.3+1·.2+4·1) / 27 = 18.6/27 = 0.6888 -> 0.69
    expect(modelScore(d)).toBe(0.69);
  });

  it('rounds to 2 dp', () => {
    // (6 x 0.5 + 3 x 1) / 9 = 6/9 = 0.6667 -> 0.67
    expect(
      modelScore([
        { dimension: 'rhythmic_character', score: 0.5, note: '' },
        { dimension: 'instrumentation', score: 1, note: '' },
      ]),
    ).toBe(0.67);
  });

  it('no scorable dimensions -> 0', () => {
    expect(modelScore([])).toBe(0);
    // vocal_delivery and tempo_feel both carry weight 0 in the default, so a lone one of
    // either contributes nothing (scene_context is now weight 5, so no longer an example).
    expect(modelScore([{ dimension: 'vocal_delivery', score: 1, note: '' }])).toBe(0);
    expect(modelScore([{ dimension: 'tempo_feel', score: 1, note: '' }])).toBe(0);
  });

  it('clamps a model that returns a score outside 0-1', () => {
    expect(modelScore([{ dimension: 'rhythmic_character', score: 4, note: '' }])).toBe(1);
    expect(modelScore([{ dimension: 'rhythmic_character', score: -2, note: '' }])).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------ *
 * modelScore — a PASSED per-run weights map (Feature 1)
 * ------------------------------------------------------------------------------------ */

/** A FULL weights map, every dimension zero unless `over` names it — for isolating one. */
const only = (over: Partial<Record<string, number>>): Partial<Record<string, number>> => ({
  ...Object.fromEntries(ALL_DIMENSIONS.map((d) => [d, 0])),
  ...over,
});

describe('modelScore: honours a passed weights map', () => {
  it('a full map that isolates one dimension makes the score exactly that dimension', () => {
    // Every weight 0 except era: the score is the era dimension's value.
    expect(modelScore(dims(0.2, { era: 0.9 }), only({ era: 1 }))).toBe(0.9);
    // Every weight 0 except rhythmic_character.
    expect(modelScore(dims(0.2, { rhythmic_character: 0.8 }), only({ rhythmic_character: 5 })))
      .toBe(0.8);
  });

  it('a dimension NOT named in a PARTIAL map falls back to its default weight', () => {
    // The map overrides only rhythmic_character (5); the rest keep their DEFAULT weights,
    // including scene_context 0 (still ignored) and era 1 (still counted).
    const d = dims(0, { rhythmic_character: 1, era: 1 });
    // weights: rc 5 (override), vd 0, emo 6, sc 5, sh 0, inst 3, harm 2, prod 1, era 4
    // weighted = 5·1 + 4·1 = 9 ; total = 5+0+6+5+0+3+2+1+4 = 26 ; 9/26 = 0.3462 -> 0.35
    expect(modelScore(d, { rhythmic_character: 5 })).toBe(0.35);
  });

  it('scene_context 0 removes its contribution; a positive weight restores it', () => {
    const d = dims(0, { rhythmic_character: 0, scene_context: 1 });
    // Isolate rhythmic_character (value 0) with scene_context pinned at 0 -> score 0.
    expect(modelScore(d, only({ rhythmic_character: 1, scene_context: 0 }))).toBe(0);
    // Give scene_context all the weight -> the score becomes its value (1).
    expect(modelScore(d, only({ scene_context: 4 }))).toBe(1);
  });

  it('a weight above 10 clamps to 10', () => {
    const d = dims(0, { rhythmic_character: 1, era: 1 });
    // rc 100 -> 10 (override); era stays default 4; the rest keep defaults but sit at 0.
    // weighted = 10·1 + 4·1 = 14 ; total = 10 + 0 + 6 + 5 + 0 + 3 + 2 + 1 + 4 = 31 ; = 0.4516 -> 0.45
    expect(modelScore(d, { rhythmic_character: 100 })).toBe(0.45);
  });

  it('a negative weight clamps to 0 — the dimension drops out', () => {
    // rc -5 -> 0, so rhythmic_character (0.9) no longer counts; every other dim is 0.2.
    expect(modelScore(dims(0.2, { rhythmic_character: 0.9 }), { rhythmic_character: -5 })).toBe(0.2);
  });

  it('the default argument is exactly DEFAULT_DIMENSION_WEIGHTS', () => {
    const d = dims(0.3, { era: 0.9, scene_context: 0.9 });
    expect(modelScore(d)).toBe(modelScore(d, DEFAULT_DIMENSION_WEIGHTS));
  });
});

/* ------------------------------------------------------------------------------------ *
 * rank — a passed weights map re-orders the SAME candidates (Feature 1)
 * ------------------------------------------------------------------------------------ */

describe('rank: a per-run weights map changes the order', () => {
  // Two candidates that TIE under the default but separate once a single dimension is
  // weighted: X is strong on era, Y is strong on rhythmic_character, mirror images
  // otherwise, so only the weight on those two dimensions decides who leads.
  // Base 0.7 keeps every other dimension strong (rule 4 needs >=2 dims at 0.6+), so both
  // survive and only the era/rhythmic_character weights decide the order.
  const candX = rec({
    artist: 'X',
    title: 'Era Twin',
    dimensions: dims(0.7, { era: 1, rhythmic_character: 0.4 }),
  });
  const candY = rec({
    artist: 'Y',
    title: 'Rhythm Twin',
    dimensions: dims(0.7, { era: 0.4, rhythmic_character: 1 }),
  });

  const order = (weights?: Partial<Record<string, number>>) =>
    rank([candX, candY], seed, {
      includeSameArtist: false,
      liveChannels: LIVE_ALL,
      ...(weights ? { weights } : {}),
    }).results.map((r) => r.track.artist);

  it('era 0 vs era heavily weighted flips the leader', () => {
    // era 0, rhythmic_character heavy -> Y (the rhythm-strong one) leads.
    expect(order({ era: 0, rhythmic_character: 10 })[0]).toBe('Y');
    // era heavy, rhythmic_character 0 -> X (the era-strong one) leads.
    expect(order({ era: 10, rhythmic_character: 0 })[0]).toBe('X');
  });

  it('genre (scene_context 5) counts under the default; a zero-weight dim does not', () => {
    // scene_context now carries default weight 5 ("genre"), so the genre-strong track pulls
    // ahead with NO explicit weights map.
    const genreStrong = rec({ artist: 'S', title: 'Genre', dimensions: dims(0.7, { scene_context: 1 }) });
    const plain = rec({ artist: 'P', title: 'Plain', dimensions: dims(0.7, { scene_context: 0 }) });
    const def = rank([genreStrong, plain], seed, {
      includeSameArtist: false,
      liveChannels: LIVE_ALL,
    }).results;
    expect(def[0]?.track.artist).toBe('S');
    expect(def[0]!.finalScore).toBeGreaterThan(def[1]!.finalScore);

    // vocal_delivery carries default weight 0, so a track strong only there earns no edge and
    // the deterministic tiebreak decides — the two finalScores are equal.
    const vocalStrong = rec({ artist: 'V', title: 'Vocal', dimensions: dims(0.7, { vocal_delivery: 1 }) });
    const plain2 = rec({ artist: 'P', title: 'Plain', dimensions: dims(0.7, { vocal_delivery: 0 }) });
    const def2 = rank([vocalStrong, plain2], seed, {
      includeSameArtist: false,
      liveChannels: LIVE_ALL,
    }).results;
    expect(def2[0]?.finalScore).toBe(def2[1]?.finalScore);
  });
});

/* ------------------------------------------------------------------------------------ *
 * finalScore — the bonuses (rule 3, second half)
 * ------------------------------------------------------------------------------------ */

describe('finalScore: +0.12 per extra channel, +0.05 for live enthusiasm, cap 1', () => {
  const forumHigh: Evidence = {
    channel: 'B',
    kind: 'forum',
    enthusiasm: 'high',
    url: 'https://example.test/thread',
  };

  it('one channel earns no bonus', () => {
    expect(finalScore(rec({ artist: 'A', dimensions: dims(0.6) }), { liveChannels: LIVE_ALL }))
      .toBe(0.6);
  });

  it('two channels: 0.60 + 0.12 = 0.72; three: 0.84', () => {
    expect(CHANNEL_BONUS).toBe(0.12);
    expect(
      finalScore(rec({ artist: 'A', dimensions: dims(0.6), channels: ['A', 'B'] }), {
        liveChannels: LIVE_ALL,
      }),
    ).toBe(0.72);
    expect(
      finalScore(rec({ artist: 'A', dimensions: dims(0.6), channels: ['A', 'B', 'C'] }), {
        liveChannels: LIVE_ALL,
      }),
    ).toBe(0.84);
  });

  it('a high-enthusiasm forum mention from a LIVE channel adds 0.05', () => {
    expect(ENTHUSIASM_BONUS).toBe(0.05);
    const r = rec({ artist: 'A', dimensions: dims(0.6), channels: ['A', 'B'], evidence: [forumHigh] });
    expect(finalScore(r, { liveChannels: ['A', 'B'] })).toBe(0.77);
  });

  it('the same mention from a channel that did NOT run live earns nothing', () => {
    const r = rec({ artist: 'A', dimensions: dims(0.6), channels: ['A', 'B'], evidence: [forumHigh] });
    expect(finalScore(r, { liveChannels: ['A'] })).toBe(0.72);
  });

  it('medium enthusiasm earns nothing', () => {
    const r = rec({
      artist: 'A',
      dimensions: dims(0.6),
      evidence: [{ ...forumHigh, enthusiasm: 'medium' }],
    });
    expect(finalScore(r, { liveChannels: LIVE_ALL })).toBe(0.6);
  });

  it('caps at 1', () => {
    const r = rec({
      artist: 'A',
      dimensions: dims(1),
      channels: ['A', 'B', 'C'],
      evidence: [forumHigh],
    });
    expect(finalScore(r, { liveChannels: LIVE_ALL })).toBe(1);
  });

  it('duplicate channel entries do not double-count', () => {
    const r = rec({ artist: 'A', dimensions: dims(0.6), channels: ['A', 'A'] });
    expect(finalScore(r, { liveChannels: LIVE_ALL })).toBe(0.6);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Rule 4 — the genre-only cut
 * ------------------------------------------------------------------------------------ */

describe('isGenreOnly (rule 4)', () => {
  it('the blocklist contains the words the architecture names', () => {
    for (const word of ['vibe', 'mood', 'style', 'energy', 'feel', 'sound', 'similar', 'era', 'genre']) {
      expect(GENRE_ONLY_TERMS).toContain(word);
    }
    for (const word of ['80s', '1980s', 'indie', 'alternative', 'rock', 'pop', 'jazz', 'punk', 'swing']) {
      expect(GENRE_ONLY_TERMS).toContain(word);
    }
  });

  it('"similar mood and style" is genre-only', () => {
    expect(isGenreOnlyTrait('similar mood and style')).toBe(true);
  });

  it('other empty phrasings are genre-only', () => {
    for (const trait of ['same vibes', '80s alternative rock', 'a similar energy', 'indie pop', '']) {
      expect(isGenreOnlyTrait(trait)).toBe(true);
    }
  });

  it('a concrete musical trait is not genre-only', () => {
    for (const trait of [
      'walking upright bass in quarters',
      'vocal slides into nonsense syllables',
      'brushed drum kit',
      'swing revival horn section',
      'chromatic descending bassline',
    ]) {
      expect(isGenreOnlyTrait(trait)).toBe(false);
    }
  });

  it('a candidate whose why is "similar mood and style" is cut', () => {
    const r = rec({
      artist: 'Some Band',
      why: 'similar mood and style',
      sharedTraits: ['similar mood', 'style'],
      dimensions: dims(0.9),
    });
    expect(isGenreOnly(r)).toBe(true);
  });

  it('zero shared traits is a cut even with strong dimensions', () => {
    expect(isGenreOnly(rec({ artist: 'B', sharedTraits: [], dimensions: dims(1) }))).toBe(true);
  });

  it('fewer than two dimensions at 0.6+ is a cut even with concrete traits', () => {
    const weak = dims(0.4, { rhythmic_character: 0.95 });
    expect(isGenreOnly(rec({ artist: 'B', dimensions: weak }))).toBe(true);
    const strong = dims(0.4, { rhythmic_character: 0.95, vocal_delivery: 0.6 });
    expect(isGenreOnly(rec({ artist: 'B', dimensions: strong }))).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Rule 1 — same artist
 * ------------------------------------------------------------------------------------ */

describe('same-artist detection (rule 1)', () => {
  it('"The Cure" === "Cure" === "The Cure feat. X"', () => {
    expect(isSameArtist('The Cure', 'Cure')).toBe(true);
    expect(isSameArtist('The Cure feat. Bananarama', 'The Cure')).toBe(true);
    expect(isSameArtist('Cure', 'The Cure feat. Bananarama')).toBe(true);
  });

  it('a different act is not the same artist', () => {
    expect(isSameArtist('The Cure', 'The Curve')).toBe(false);
    expect(isSameArtist('The Cure', 'Siouxsie and the Banshees')).toBe(false);
  });

  it('rule 1: same-artist tracks are excluded by default', () => {
    const { results, cut } = rank(
      [
        rec({ artist: 'The Cure', title: 'Close To Me', key: 'k-close' }),
        rec({ artist: 'Cure', title: 'Boys Dont Cry', key: 'k-boys' }),
        rec({ artist: 'The Cure feat. Bananarama', title: 'Whatever', key: 'k-feat' }),
        rec({ artist: 'Louis Prima', title: 'Jump Jive an Wail', key: 'k-prima' }),
      ],
      seed,
      { includeSameArtist: false, liveChannels: LIVE_ALL },
    );
    expect(results.map((r) => r.track.key)).toEqual(['k-prima']);
    expect(cut.filter((c) => c.reason === 'same-artist').map((c) => c.rec.track.key).sort())
      .toEqual(['k-boys', 'k-close', 'k-feat']);
  });

  it('rule 1: with includeSameArtist a same-artist track needs modelScore >= 0.85', () => {
    expect(SAME_ARTIST_MIN_SCORE).toBe(0.85);
    const { results, cut } = rank(
      [
        rec({ artist: 'The Cure', title: 'Close To Me', key: 'k-low', dimensions: dims(0.8) }),
        rec({ artist: 'Cure', title: 'Boys Dont Cry', key: 'k-high', dimensions: dims(0.9) }),
      ],
      seed,
      { includeSameArtist: true, liveChannels: LIVE_ALL },
    );
    expect(results.map((r) => r.track.key)).toEqual(['k-high']);
    expect(results[0].flags).toContain('same-artist-high-bar');
    expect(results[0].sameArtist).toBe(true);
    expect(cut).toEqual([
      expect.objectContaining({ reason: 'same-artist-below-bar' }),
    ]);
    expect(cut[0].rec.track.key).toBe('k-low');
  });

  it('rule 1: a same-artist track over the bar is still cut if its why is genre-only', () => {
    const { results, cut } = rank(
      [rec({ artist: 'The Cure', key: 'k', dimensions: dims(0.95), sharedTraits: ['same vibe'] })],
      seed,
      { includeSameArtist: true, liveChannels: LIVE_ALL },
    );
    expect(results).toHaveLength(0);
    expect(cut[0].reason).toBe('same-artist-below-bar');
  });
});

/* ------------------------------------------------------------------------------------ *
 * Rule 2 — one track per artist
 * ------------------------------------------------------------------------------------ */

describe('rule 2: one track per artist', () => {
  it('uses the same relation as rule 1, so a collaboration does not smuggle in a second track', () => {
    // Observed live: #3 "Waldeck — Slowly" and #9 "The Avener & Waldeck — Quando Quando"
    // both survived, because rule 2 keyed on exact normArtist while rule 1 used
    // artistOverlap. Two rules, two answers about who is the same act.
    const { results, cut } = rank(
      [
        rec({ artist: 'Waldeck', title: 'Slowly', key: 'k-waldeck', dimensions: dims(0.8) }),
        rec({
          artist: 'The Avener & Waldeck',
          title: 'Quando Quando',
          key: 'k-avener',
          dimensions: dims(0.7),
        }),
        rec({ artist: 'Cherry Poppin Daddies', title: 'Zoot Suit Riot', key: 'k-zoot' }),
      ],
      seed,
      { includeSameArtist: false, liveChannels: LIVE_ALL },
    );
    expect(results.map((r) => r.track.key)).toEqual(['k-waldeck', 'k-zoot']);
    expect(cut).toEqual([
      expect.objectContaining({ reason: 'duplicate-artist' }),
    ]);
    expect(cut[0].rec.track.key).toBe('k-avener');
  });

  it('keeps genuinely different acts whose names merely overlap as text', () => {
    // The other half of the same fix: "Prince" and "Prince Buster" are two artists.
    const { results, cut } = rank(
      [
        rec({ artist: 'Prince', title: 'Kiss', key: 'k-prince', dimensions: dims(0.8) }),
        rec({ artist: 'Prince Buster', title: 'Al Capone', key: 'k-buster', dimensions: dims(0.7) }),
      ],
      seed,
      { includeSameArtist: false, liveChannels: LIVE_ALL },
    );
    expect(results.map((r) => r.track.key)).toEqual(['k-prince', 'k-buster']);
    expect(cut).toEqual([]);
  });

  it('keeps the highest finalScore and cuts the rest as duplicate-artist', () => {
    const { results, cut } = rank(
      [
        rec({ artist: 'Squirrel Nut Zippers', title: 'Hell', key: 'k-hell', dimensions: dims(0.7) }),
        rec({
          artist: 'The Squirrel Nut Zippers',
          title: 'Put a Lid On It',
          key: 'k-lid',
          dimensions: dims(0.7),
          channels: ['A', 'B'],
        }),
        rec({ artist: 'Cherry Poppin Daddies', title: 'Zoot Suit Riot', key: 'k-zoot' }),
      ],
      seed,
      { includeSameArtist: false, liveChannels: LIVE_ALL },
    );
    expect(results.map((r) => r.track.key)).toEqual(['k-lid', 'k-zoot']);
    expect(cut).toEqual([expect.objectContaining({ reason: 'duplicate-artist' })]);
    expect(cut[0].rec.track.key).toBe('k-hell');
    // the survivor kept its multi-channel bonus: 0.70 + 0.12
    expect(results[0].finalScore).toBe(0.82);
    expect(results[0].flags).toContain('multi-channel');
  });
});

/* ------------------------------------------------------------------------------------ *
 * Rule 4 through rank()
 * ------------------------------------------------------------------------------------ */

describe('rule 4 through rank()', () => {
  it('cuts a genre-only candidate and flags it', () => {
    const { results, cut } = rank(
      [
        rec({ artist: 'Good Band', key: 'k-good' }),
        rec({ artist: 'Lazy Band', key: 'k-lazy', why: 'similar mood and style', sharedTraits: ['similar mood and style'] }),
      ],
      seed,
      { includeSameArtist: false, liveChannels: LIVE_ALL },
    );
    expect(results.map((r) => r.track.key)).toEqual(['k-good']);
    expect(cut).toEqual([expect.objectContaining({ reason: 'genre-only' })]);
    expect(cut[0].rec.flags).toContain('genre-only-cut');
  });

  it('enforceGenreOnly:false (the placeholder engine) keeps everything', () => {
    const { results, cut } = rank(
      [
        rec({ artist: 'Placeholder One', key: 'k1', sharedTraits: [], dimensions: dims(0.5) }),
        rec({ artist: 'Placeholder Two', key: 'k2', sharedTraits: [], dimensions: dims(0.5) }),
      ],
      seed,
      { includeSameArtist: false, liveChannels: ['C'], enforceGenreOnly: false },
    );
    expect(results).toHaveLength(2);
    expect(cut).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Rule 5 — spread
 * ------------------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------------------ *
 * Rule 0 — the seed's own song, and rule 4b — a `why` the scorer could not fix
 * ------------------------------------------------------------------------------------ */

describe('rule 0: a cover, remix or live take of the seed', () => {
  const cover = (): Recommendation => ({
    ...rec({ artist: 'Tricky', title: 'The Lovecats', key: 'cat:cover' }),
    flags: [FLAG_COVER_OR_SAME_SONG],
  });

  it('cuts it however good its score and its traits are', () => {
    const input = [cover(), rec({ artist: 'Louis Prima' })];
    const { results, cut } = rank(input, seed, { includeSameArtist: false, liveChannels: LIVE_ALL });

    expect(results.map((r) => r.track.artist)).toEqual(['Louis Prima']);
    expect(cut.find((c) => c.rec.track.key === 'cat:cover')?.reason).toBe('same-song');
  });

  it('cuts it even when the same-artist toggle is on — it is not an artist rule', () => {
    const { results } = rank([cover()], seed, { includeSameArtist: true, liveChannels: LIVE_ALL });
    expect(results).toEqual([]);
  });

  it('rule 6 never brings it back', () => {
    const input = [
      cover(),
      ...Array.from({ length: 9 }, (_, i) =>
        rec({ artist: `Act ${i}`, key: `k${i}`, dimensions: dims(0.2), sharedTraits: ['brushed kit, no crashes'] }),
      ),
    ];
    const { results } = rank(input, seed, { includeSameArtist: false, liveChannels: LIVE_ALL });
    expect(results.some((r) => r.track.key === 'cat:cover')).toBe(false);
  });
});

describe('rule 4b: a `why` the scorer flagged as generic twice', () => {
  const generic = (key: string): Recommendation => ({
    // Concrete traits and strong dimensions: rule 4 has nothing to cut on. The only thing
    // wrong with this candidate is the sentence, which is the thing the spec forbids.
    ...rec({
      artist: `Act ${key}`,
      key,
      why: 'Both records share a similar mood and style throughout.',
      sharedTraits: ['walking upright bass in quarters', 'vocal slides into nonsense syllables'],
    }),
    flags: [FLAG_GENERIC_WHY],
  });

  it('is cut with its own reason', () => {
    const { results, cut } = rank([generic('g1'), rec({ artist: 'Louis Prima' })], seed, {
      includeSameArtist: false,
      liveChannels: LIVE_ALL,
    });
    expect(results.map((r) => r.track.artist)).toEqual(['Louis Prima']);
    expect(cut.find((c) => c.rec.track.key === 'g1')?.reason).toBe('generic-why');
  });

  it('the floor of 8 does not re-admit it', () => {
    const input = [
      ...Array.from({ length: 9 }, (_, i) => generic(`g${i}`)),
      ...Array.from({ length: 3 }, (_, i) => rec({ artist: `Good ${i}`, key: `ok${i}` })),
    ];
    const { results } = rank(input, seed, { includeSameArtist: false, liveChannels: LIVE_ALL });
    expect(results).toHaveLength(3);
    for (const r of results) expect(r.flags).not.toContain(FLAG_GENERIC_WHY);
  });
});

describe('rule 5: spread', () => {
  it('decadeOf and primaryGenre read only sourced data', () => {
    expect(decadeOf(track({ artist: 'a', title: 'b', year: YEAR(1983) }))).toBe(1980);
    expect(decadeOf(track({ artist: 'a', title: 'b' }))).toBeNull();
    expect(
      primaryGenre(
        track({
          artist: 'a',
          title: 'b',
          features: { source: { source: 'acousticbrainz' }, genreLabels: ['Jazz', 'Swing'] },
        }),
      ),
    ).toBe('jazz');
    expect(
      primaryGenre(
        track({
          artist: 'a',
          title: 'b',
          tags: { value: [{ name: 'Post-Punk', count: 90 }], source: { source: 'lastfm' } },
        }),
      ),
    ).toBe('post-punk');
    expect(primaryGenre(track({ artist: 'a', title: 'b' }))).toBeNull();
  });

  it('demotes the items that would push one decade past 40% of the target', () => {
    // target 20 -> cap 8; target 10 -> cap 4. Six 1980s tracks all score above six 1990s.
    const eighties = [0, 1, 2, 3, 4, 5].map((i) =>
      rec({
        artist: `Eighties ${i}`,
        key: `e${i}`,
        year: 1983,
        dimensions: dims(0.9 - i * 0.01),
      }),
    );
    const nineties = [0, 1, 2, 3, 4, 5].map((i) =>
      rec({
        artist: `Nineties ${i}`,
        key: `n${i}`,
        year: 1994,
        dimensions: dims(0.7 - i * 0.01),
      }),
    );

    // Roomy list: demotion is not deletion — the over-cap items are appended below the
    // diverse set rather than dropped.
    const roomy = rank([...eighties, ...nineties], seed, {
      includeSameArtist: false,
      liveChannels: LIVE_ALL,
      targetLength: 10,
      minResults: 0,
    });
    expect(roomy.results.slice(0, 8).map((r) => r.track.key)).toEqual([
      'e0', 'e1', 'e2', 'e3', 'n0', 'n1', 'n2', 'n3',
    ]);
    expect(roomy.results.filter((r) => decadeOf(r.track) === 1980).slice(0, 4)).toHaveLength(4);
    // e4 and e5 were demoted but still made the list, flagged as such
    expect(roomy.results.slice(8).map((r) => r.track.key)).toEqual(['e4', 'e5']);
    expect(roomy.results.at(-1)?.flags).toContain('spread-demoted');
    // the two that fell off the end are recorded with the reason
    expect(roomy.cut.map((c) => [c.rec.track.key, c.reason])).toEqual([
      ['n4', 'spread-demoted'],
      ['n5', 'spread-demoted'],
    ]);
  });

  it('demotes on the primary genre label too', () => {
    const same = [0, 1, 2, 3, 4].map((i) =>
      rec({
        artist: `Swing ${i}`,
        key: `s${i}`,
        year: 1930 + i * 10,
        genreLabels: ['swing'],
        dimensions: dims(0.9 - i * 0.01),
      }),
    );
    const other = rec({
      artist: 'Other',
      key: 'o0',
      year: 2001,
      genreLabels: ['electronic'],
      dimensions: dims(0.8),
    });
    const { results } = rank([...same, other], seed, {
      includeSameArtist: false,
      liveChannels: LIVE_ALL,
      targetLength: 10,
      minResults: 0,
    });
    // The cap is 40% of the list actually emitted (6 survivors), not of the target: 2
    // swing tracks, so the rest are demoted below the electronic one.
    expect(results.map((r) => r.track.key)).toEqual(['s0', 's1', 'o0', 's2', 's3', 's4']);
    expect(results.filter((r) => r.flags.includes('spread-demoted')).map((r) => r.track.key))
      .toEqual(['s2', 's3', 's4']);
  });

  it('sizes the cap to the list it will emit, not to TARGET_LENGTH', () => {
    // Ten candidates, all 1983: sizing the cap to TARGET_LENGTH (20) gave a cap of 8 and
    // no spread pass at all, which is how "generic 1980s rock sharing nothing but the
    // decade" — the spec's named failure — reached the top of a short list undemoted.
    const eighties = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
      rec({
        artist: `Band ${i}`,
        key: `d${i}`,
        year: 1983,
        genreLabels: ['post punk'],
        dimensions: dims(0.9 - i * 0.01),
      }),
    );
    const { results } = rank(eighties, seed, {
      includeSameArtist: false,
      liveChannels: LIVE_ALL,
      minResults: 0,
    });
    // 40% of 10 = 4 keep their place; the other six are demoted below them (rule 5 demotes,
    // it never deletes, so the ratio itself cannot be enforced on a short list).
    expect(results.filter((r) => !r.flags.includes('spread-demoted'))).toHaveLength(4);
    expect(results.filter((r) => r.flags.includes('spread-demoted'))).toHaveLength(6);
    expect(results.map((r) => r.track.key)).toEqual([
      'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9',
    ]);
  });

  it('an unknown year or genre never constrains spread', () => {
    const many = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
      rec({ artist: `No Year ${i}`, key: `y${i}`, dimensions: dims(0.9 - i * 0.01) }),
    );
    const { results, cut } = rank(many, seed, {
      includeSameArtist: false,
      liveChannels: LIVE_ALL,
      targetLength: 10,
    });
    expect(results).toHaveLength(10);
    expect(cut).toHaveLength(0);
  });

  it('cuts to the target length and records the overflow', () => {
    const many = Array.from({ length: 24 }, (_, i) =>
      rec({ artist: `Band ${i}`, key: `b${i}`, dimensions: dims(0.9 - i * 0.01) }),
    );
    const { results, cut } = rank(many, seed, { includeSameArtist: false, liveChannels: LIVE_ALL });
    expect(results).toHaveLength(20);
    expect(cut).toHaveLength(4);
    expect(cut.every((c) => c.reason === 'over-length')).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Rule 6 — the floor of 8
 * ------------------------------------------------------------------------------------ */

describe('rule 6: never fewer than 8 when 8 survived rules 1-2', () => {
  it('relaxes rule 4s dimension bar until 8 results exist', () => {
    const weak = Array.from({ length: 10 }, (_, i) =>
      rec({
        artist: `Weak ${i}`,
        key: `w${i}`,
        dimensions: dims(0.5 - i * 0.001),
        sharedTraits: ['brushed drum kit'],
      }),
    );
    const strict = rank(weak, seed, { includeSameArtist: false, liveChannels: LIVE_ALL, minResults: 0 });
    expect(strict.results).toHaveLength(0);

    const { results, cut } = rank(weak, seed, { includeSameArtist: false, liveChannels: LIVE_ALL });
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.flags.includes('threshold-relaxed'))).toBe(true);
    expect(results.every((r) => !r.flags.includes('genre-only-cut'))).toBe(true);
    // the two weakest stay cut
    expect(cut).toHaveLength(2);
    expect(cut.every((c) => c.reason === 'genre-only')).toBe(true);
  });

  it('never relaxes the traits arm: an all-genre-label list stays empty', () => {
    const empty = Array.from({ length: 10 }, (_, i) =>
      rec({
        artist: `Lazy ${i}`,
        key: `l${i}`,
        dimensions: dims(0.9),
        sharedTraits: ['similar mood and style'],
      }),
    );
    const { results, cut } = rank(empty, seed, { includeSameArtist: false, liveChannels: LIVE_ALL });
    expect(results).toHaveLength(0);
    expect(cut).toHaveLength(10);
    expect(cut.every((c) => c.reason === 'genre-only')).toBe(true);
  });

  it('never relaxes rules 1 or 2 to reach the floor', () => {
    const sameActs = Array.from({ length: 10 }, (_, i) =>
      rec({ artist: 'The Cure', key: `c${i}`, title: `Track ${i}` }),
    );
    const { results, cut } = rank(sameActs, seed, {
      includeSameArtist: false,
      liveChannels: LIVE_ALL,
    });
    expect(results).toHaveLength(0);
    expect(cut).toHaveLength(10);
    expect(cut.every((c) => c.reason === 'same-artist')).toBe(true);
  });

  it('fewer than 8 candidates in means fewer than 8 out, honestly', () => {
    const three = [0, 1, 2].map((i) => rec({ artist: `Band ${i}`, key: `t${i}` }));
    const { results } = rank(three, seed, { includeSameArtist: false, liveChannels: LIVE_ALL });
    expect(results).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------------------------ *
 * rank() housekeeping
 * ------------------------------------------------------------------------------------ */

describe('rank() housekeeping', () => {
  it('does not mutate its input', () => {
    const input = [rec({ artist: 'Band', key: 'k', channels: ['A', 'B'] })];
    const before = JSON.parse(JSON.stringify(input));
    rank(input, seed, { includeSameArtist: false, liveChannels: LIVE_ALL });
    expect(input).toEqual(before);
  });

  it('recomputes modelScore and finalScore rather than trusting the caller', () => {
    const lying = {
      ...rec({ artist: 'Band', key: 'k', dimensions: dims(0.6), channels: ['A', 'B'] }),
      modelScore: 0.99,
      finalScore: 0.99,
    };
    const { results } = rank([lying], seed, { includeSameArtist: false, liveChannels: LIVE_ALL });
    expect(results[0].modelScore).toBe(0.6);
    expect(results[0].finalScore).toBe(0.72);
  });

  it('orders by finalScore descending', () => {
    const { results } = rank(
      [
        rec({ artist: 'Low', key: 'low', dimensions: dims(0.7) }),
        rec({ artist: 'High', key: 'high', dimensions: dims(0.9) }),
        rec({ artist: 'Mid', key: 'mid', dimensions: dims(0.8) }),
      ],
      seed,
      { includeSameArtist: false, liveChannels: LIVE_ALL },
    );
    expect(results.map((r) => r.track.key)).toEqual(['high', 'mid', 'low']);
  });

  it('an empty input produces an empty result', () => {
    expect(rank([], seed, { includeSameArtist: false, liveChannels: [] })).toEqual({
      results: [],
      cut: [],
    });
  });
});
