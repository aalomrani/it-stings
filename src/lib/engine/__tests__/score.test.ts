/**
 * Stage 5's judgement half — now DETERMINISTIC. No model, no transport, no key.
 *
 * `scoreBatch` runs the pure `similarity.scorePair` over the shared `FeatureProfile` of the
 * seed and each verified candidate. These tests protect:
 *   - the contract with `rank.ts` (the nine dimensions, in order),
 *   - that a concrete agreement (BPM, key, mood) produces a concrete `why` and no weak flag,
 *   - that a genre-only agreement raises `FLAG_WEAK_WHY_UNFIXED` (rule 4b cuts it),
 *   - cover/same-song detection,
 *   - dedupe-by-key with merged channel evidence,
 *   - that nothing throws, and an aborted run reports its keys in `failed`.
 */

import { describe, expect, it } from 'vitest';

import { createUsageCounter, type ModelUsage } from '@/lib/engine/model';
import { SCORED_DIMENSIONS } from '@/lib/engine/rank';
import {
  FLAG_WEAK_WHY_UNFIXED,
  SCORE_DIMENSIONS,
  SCORE_PROMPT_VERSION,
  bannedPhraseIn,
  scoreBatch,
  type VerifiedCandidate,
} from '@/lib/engine/score';
import type { ChannelContext } from '@/lib/engine/channels/types';
import type { Candidate, Fingerprint, TrackRecord } from '@/lib/types';

/* ------------------------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------------------------ */

function track(over: Partial<TrackRecord> & { artist: string; title: string }): TrackRecord {
  const base: TrackRecord = {
    key: `deezer:${over.artist}-${over.title}`.replace(/\s+/g, '_'),
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
  return { ...base, ...over };
}

const SEED: TrackRecord = track({
  key: 'isrc:GBAHT8300123',
  artist: 'The Cure',
  title: 'The Lovecats',
  year: { value: 1983, source: { source: 'musicbrainz', field: 'first-release-date' } },
  tempoBpm: { value: 132, source: { source: 'deezer', field: 'bpm' } },
  keySignature: { value: 'F# minor', source: { source: 'acousticbrainz' } },
  tags: {
    value: [{ name: 'swing', count: 100 }, { name: 'jazz', count: 42 }],
    source: { source: 'lastfm', field: 'toptags' },
  },
  features: {
    source: { source: 'acousticbrainz', field: 'high-level' },
    danceability: 0.7,
    moodRelaxed: 0.8,
    moodAggressive: 0.1,
  },
});

/** The `fingerprint` arg is accepted but no longer read; a minimal one suffices. */
const FINGERPRINT: Fingerprint = {
  tempo_bpm: 132,
  tempo_feel: 'driving',
  rhythmic_character: 'a driving groove around 132 BPM',
  instrumentation: ['swing'],
  vocal_delivery: 'vocal delivery not interpreted (keyless)',
  harmonic_language: 'F# minor tonality',
  emotional_register: 'classified relaxed',
  production_texture: 'production texture not interpreted (keyless)',
  era: 1983,
  scene_context: 'filed under swing',
  signature_hook: 'signature hook not interpreted (keyless)',
  genre_labels: ['swing', 'jazz'],
  confidence: {
    tempo_feel: 'high',
    rhythmic_character: 'high',
    instrumentation: 'low',
    vocal_delivery: 'low',
    harmonic_language: 'medium',
    emotional_register: 'medium',
    production_texture: 'low',
    scene_context: 'low',
    signature_hook: 'low',
  },
  grounded_on: [],
  model: 'deterministic-v1',
};

function candidate(over: Partial<Candidate> & { artist: string; title: string }): Candidate {
  return { channels: ['C'], hints: [], ...over };
}

function verified(
  artist: string,
  title: string,
  over: { candidate?: Partial<Candidate>; track?: Partial<TrackRecord> } = {},
): VerifiedCandidate {
  return {
    candidate: candidate({ artist, title, ...over.candidate }),
    track: track({ artist, title, ...over.track }),
  };
}

function ctxFor(signal?: AbortSignal): ChannelContext & { logs: string[]; usage: ModelUsage } {
  const logs: string[] = [];
  return {
    seedKey: SEED.key,
    usage: createUsageCounter(),
    signal,
    log: (line) => logs.push(line),
    logs,
  };
}

/** A candidate close to the seed on every measured axis. */
const CLOSE = verified('Royal Crown Revue', 'Hey Pachuco', {
  track: {
    key: 'deezer:hey-pachuco',
    tempoBpm: { value: 130, source: { source: 'deezer', field: 'bpm' } },
    keySignature: { value: 'F# minor', source: { source: 'acousticbrainz' } },
    tags: {
      value: [{ name: 'swing', count: 90 }, { name: 'jazz', count: 30 }],
      source: { source: 'musicbrainz', field: 'tags+genres' },
    },
    features: {
      source: { source: 'acousticbrainz', field: 'high-level' },
      danceability: 0.68,
      moodRelaxed: 0.75,
      moodAggressive: 0.12,
    },
  },
});

/* ------------------------------------------------------------------------------------ *
 * Contract with rank.ts
 * ------------------------------------------------------------------------------------ */

describe('the nine dimensions', () => {
  it('are exactly the ones rank.ts weighs, in the same order', () => {
    expect([...SCORE_DIMENSIONS]).toEqual(SCORED_DIMENSIONS);
  });

  it('are all present, in order, on every scored candidate', async () => {
    const { scored } = await scoreBatch(SEED, FINGERPRINT, [CLOSE, verified('X', 'Y')], ctxFor());
    for (const s of scored) {
      expect(s.dimensions.map((d) => d.dimension)).toEqual(SCORED_DIMENSIONS);
    }
  });

  it('has a frozen prompt version for the run cache key', () => {
    expect(SCORE_PROMPT_VERSION).toBe('score-det-1');
  });
});

/* ------------------------------------------------------------------------------------ *
 * A concrete match
 * ------------------------------------------------------------------------------------ */

describe('a candidate that shares concrete measured traits', () => {
  it('scores rhythmic_character high and names the BPM agreement in why', async () => {
    const { scored, failed } = await scoreBatch(SEED, FINGERPRINT, [CLOSE], ctxFor());
    expect(failed).toEqual([]);
    expect(scored).toHaveLength(1);
    const s = scored[0];
    const rhythmic = s.dimensions.find((d) => d.dimension === 'rhythmic_character');
    expect(rhythmic?.score).toBeGreaterThan(0.6);
    expect(s.why).toContain('BPM');
    expect(s.sharedTraits.some((t) => /BPM/.test(t))).toBe(true);
    // A concrete trait leads, so the weak-why flag is NOT raised.
    expect(s.flags).not.toContain(FLAG_WEAK_WHY_UNFIXED);
    expect(s.isCoverOrSameSong).toBe(false);
  });

  it('names the shared key when both are in the same key', async () => {
    const { scored } = await scoreBatch(SEED, FINGERPRINT, [CLOSE], ctxFor());
    const harmonic = scored[0].dimensions.find((d) => d.dimension === 'harmonic_language');
    expect(harmonic?.score).toBeGreaterThan(0.6);
    expect(scored[0].sharedTraits.join(' ')).toMatch(/F#|minor/);
  });
});

/* ------------------------------------------------------------------------------------ *
 * The genre-only honesty guard
 * ------------------------------------------------------------------------------------ */

describe('a candidate whose only agreement is a genre tag', () => {
  const seedTagsOnly = track({
    key: 'seed:tags-only',
    artist: 'Seed Act',
    title: 'Seed Song',
    tags: { value: [{ name: 'rock', count: 100 }], source: { source: 'lastfm', field: 'toptags' } },
  });
  const candTagsOnly = verified('Other Act', 'Other Song', {
    track: {
      key: 'cand:tags-only',
      tags: { value: [{ name: 'rock', count: 100 }], source: { source: 'lastfm', field: 'toptags' } },
    },
  });

  it('raises FLAG_WEAK_WHY_UNFIXED so rank.ts rule 4b can cut it', async () => {
    const { scored } = await scoreBatch(seedTagsOnly, FINGERPRINT, [candTagsOnly], ctxFor());
    expect(scored[0].flags).toContain(FLAG_WEAK_WHY_UNFIXED);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Cover / same-song detection
 * ------------------------------------------------------------------------------------ */

describe('cover / same-song detection', () => {
  it('flags a same-title, different-artist candidate as a cover', async () => {
    const cover = verified('Tricky', 'The Lovecats', { track: { key: 'deezer:tricky-lovecats' } });
    const { scored } = await scoreBatch(SEED, FINGERPRINT, [cover], ctxFor());
    expect(scored[0].isCoverOrSameSong).toBe(true);
  });

  it('does not flag a genuinely different song', async () => {
    const { scored } = await scoreBatch(SEED, FINGERPRINT, [CLOSE], ctxFor());
    expect(scored[0].isCoverOrSameSong).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Dedupe + evidence plumbing
 * ------------------------------------------------------------------------------------ */

describe('dedupe and evidence', () => {
  it('scores a track found by two channels once and keeps the Channel C note', async () => {
    const a = verified('Cherry Poppin Daddies', 'Zoot Suit Riot', {
      track: { key: 'deezer:zoot' },
      candidate: { channels: ['A'], hints: [{ lastfmMatch: 0.31 }] },
    });
    const c = verified('Cherry Poppin Daddies', 'Zoot Suit Riot', {
      track: { key: 'deezer:zoot' },
      candidate: { channels: ['C'], hints: [{ modelNote: 'jump-blues horn shout' }] },
    });
    const { scored } = await scoreBatch(SEED, FINGERPRINT, [a, c], ctxFor());
    expect(scored).toHaveLength(1);
    expect(scored[0].modelNote).toBe('jump-blues horn shout');
    // The caller's own objects are not mutated.
    expect(a.candidate.channels).toEqual(['A']);
    expect(a.candidate.hints).toHaveLength(1);
  });

  it('leaves whyDiscriminates empty — the deterministic engine has no counter-example', async () => {
    const { scored } = await scoreBatch(SEED, FINGERPRINT, [CLOSE], ctxFor());
    expect(scored[0].whyDiscriminates).toBe('');
  });
});

/* ------------------------------------------------------------------------------------ *
 * Degrading, never throwing
 * ------------------------------------------------------------------------------------ */

describe('failure handling', () => {
  it('makes an empty result for an empty candidate list', async () => {
    await expect(scoreBatch(SEED, FINGERPRINT, [], ctxFor())).resolves.toEqual({
      scored: [],
      failed: [],
    });
  });

  it('never returns a no_api_key reason', async () => {
    const { scored, failed, reason } = await scoreBatch(SEED, FINGERPRINT, [CLOSE], ctxFor());
    expect(scored).toHaveLength(1);
    expect(failed).toEqual([]);
    expect(reason).toBeUndefined();
  });

  it('fails every candidate without work when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { scored, failed } = await scoreBatch(
      SEED,
      FINGERPRINT,
      [CLOSE, verified('X', 'Y', { track: { key: 'k2' } })],
      ctxFor(controller.signal),
    );
    expect(scored).toEqual([]);
    expect(failed).toEqual(['deezer:hey-pachuco', 'k2']);
  });
});

/* ------------------------------------------------------------------------------------ *
 * bannedPhraseIn — still the honesty gate, still exported
 * ------------------------------------------------------------------------------------ */

describe('bannedPhraseIn', () => {
  it('rejects a category-only sentence and returns the phrase', () => {
    expect(bannedPhraseIn('Both share a similar playful mood and a retro jazz style.'))
      .toBe('similar playful mood');
  });

  it('accepts a concrete sentence', () => {
    expect(bannedPhraseIn('Both around 131 BPM; both in F# minor.')).toBeNull();
  });

  it('treats an empty reason as unbanned', () => {
    expect(bannedPhraseIn('')).toBeNull();
  });
});
