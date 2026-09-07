/**
 * ADVERSARIAL — the keyless engine against hostile SOURCES (not a hostile model).
 *
 * The old adversarial suite drove a hostile *model* through Stage 2 and Stage 5. Those
 * stages are now deterministic and make no model call, so the hostile surface moved: it is
 * the SOURCE JSON (Deezer / MusicBrainz) that is now untrusted, and the honesty guards that
 * used to be an LLM re-score are now pure functions. This suite proves:
 *
 *   1. malformed / error source bodies degrade the channels, never throw;
 *   2. the two documented open findings of the LLM era are CLOSED on the deterministic
 *      path: a cover of the seed is flagged (`isCoverOrSameSong` → rank rule 0), and a
 *      pair whose only agreement is a genre tag raises `FLAG_WEAK_WHY_UNFIXED` (rank rule
 *      4b), so neither ships.
 *
 * Nothing here reaches the network or the model.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { channelB } from '@/lib/engine/channels/b';
import { channelC } from '@/lib/engine/channels/c';
import type { ChannelContext } from '@/lib/engine/channels/types';
import { buildFeatureProfile } from '@/lib/engine/featureProfile';
import { scorePair } from '@/lib/engine/similarity';
import { FLAG_WEAK_WHY_UNFIXED } from '@/lib/engine/score';
import { createUsageCounter } from '@/lib/engine/model';
import { installFetch, resetHarness } from '@/lib/sources/__tests__/harness';
import { POLICIES } from '@/lib/http/rateLimit';
import type { Fingerprint, TrackRecord } from '@/lib/types';

POLICIES['musicbrainz.org'] = { limit: 10_000, windowMs: 1, minGapMs: 0, serial: false };

/* ------------------------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------------------------ */

function track(over: Partial<TrackRecord> = {}): TrackRecord {
  return {
    key: 'isrc:GBAAM8300010',
    isrc: null,
    title: 'The Lovecats',
    artist: 'The Cure',
    album: null,
    year: null,
    durationMs: null,
    artwork: null,
    preview: null,
    tempoBpm: null,
    keySignature: null,
    links: {},
    ids: { deezer: 999 },
    tags: null,
    features: null,
    resolvedAt: 1_700_000_000_000,
    degraded: [],
    ...over,
  };
}

const FINGERPRINT = { genre_labels: [] } as unknown as Fingerprint;

function ctxFor(): ChannelContext {
  return { seedKey: 'isrc:GBAAM8300010', usage: createUsageCounter(), log: () => {} };
}

afterEach(() => resetHarness());

/* ------------------------------------------------------------------------------------ *
 * Hostile sources never crash the channels
 * ------------------------------------------------------------------------------------ */

describe('hostile Deezer bodies degrade Channel C, never throw', () => {
  it('a Deezer error body on the track lookup is an error result', async () => {
    installFetch([{ when: '/track/999', body: { error: { type: 'DataException', code: 800 } } }]);
    const res = await channelC(track(), FINGERPRINT, ctxFor());
    expect(res.status).toBe('error');
    expect(res.candidates).toEqual([]);
  });

  it('a garbage related payload is an error result, not a throw', async () => {
    installFetch([
      { when: '/track/999', body: { id: 999, title: 'x', artist: { id: 1, name: 'The Cure' } } },
      { when: '/related', body: { data: 'not-an-array' } },
    ]);
    const res = await channelC(track(), FINGERPRINT, ctxFor());
    expect(res.status).toBe('error');
    expect(res.candidates).toEqual([]);
  });
});

describe('hostile MusicBrainz bodies degrade Channel B, never throw', () => {
  it('an HTTP failure on the cohort search is an error result', async () => {
    installFetch([{ when: '/recording', body: 'not valid json' }]);
    const seed = track({ tags: { value: [{ name: 'swing', count: 10 }, { name: 'electro swing', count: 8 }], source: { source: 'lastfm' } } });
    const res = await channelB(seed, FINGERPRINT, ctxFor());
    expect(res.status).toBe('error');
    expect(res.candidates).toEqual([]);
  });

  it('a body with no recordings is an empty done, not a throw', async () => {
    installFetch([{ when: '/recording', body: { count: 0 } }]);
    const seed = track({ tags: { value: [{ name: 'swing', count: 10 }, { name: 'electro swing', count: 8 }], source: { source: 'lastfm' } } });
    const res = await channelB(seed, FINGERPRINT, ctxFor());
    expect(res.status).toBe('done');
    expect(res.candidates).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------ *
 * The two old open findings are closed on the deterministic path
 * ------------------------------------------------------------------------------------ */

describe('the deterministic scorer closes the LLM-era findings', () => {
  it('flags a cover of the seed (same title, different artist) so rank rule 0 cuts it', () => {
    const seed = buildFeatureProfile(track({ artist: 'The Cure', title: 'The Lovecats' }));
    const cover = buildFeatureProfile(
      track({ key: 'deezer:2', artist: 'Nouvelle Vague', title: 'The Lovecats' }),
    );
    const pair = scorePair(seed, cover);
    expect(pair.isCoverOrSameSong).toBe(true);
  });

  it('does not flag a genuinely different track as a cover', () => {
    const seed = buildFeatureProfile(track({ artist: 'The Cure', title: 'The Lovecats' }));
    const other = buildFeatureProfile(
      track({ key: 'deezer:3', artist: 'Squeeze', title: 'Cool for Cats' }),
    );
    expect(scorePair(seed, other).isCoverOrSameSong).toBe(false);
  });

  it('raises FLAG_WEAK_WHY_UNFIXED when the only agreement is a genre tag', () => {
    const tags = { value: [{ name: 'post-punk', count: 10 }], source: { source: 'lastfm' as const } };
    const seed = buildFeatureProfile(track({ artist: 'The Cure', title: 'A', tags }));
    const cand = buildFeatureProfile(track({ key: 'deezer:4', artist: 'Bauhaus', title: 'B', tags }));
    const pair = scorePair(seed, cand);
    expect(pair.flags).toContain(FLAG_WEAK_WHY_UNFIXED);
    // The concrete-trait guard means no BPM/key/mood phrase was available to lead with.
    expect(pair.sharedTraits.every((t) => !/\bbpm\b|\bkey\b/i.test(t))).toBe(true);
  });
});
