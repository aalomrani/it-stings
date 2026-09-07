/**
 * Channel B — keyless MusicBrainz tag-cohort discovery.
 *
 * No network, no model. MusicBrainz is stubbed at `fetchExternal` (the source harness) with
 * inline bodies in its real shape, so the assertions are on the channel's cohort building,
 * the mandatory tag quoting, the score filter, the dedupe-by-artist and the seed-drop.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_CANDIDATES,
  MIN_USABLE_TAGS,
  channelB,
  seedCohortTags,
} from '@/lib/engine/channels/b';
import type { ChannelContext } from '@/lib/engine/channels/types';
import { installFetch, resetHarness, type Route } from '@/lib/sources/__tests__/harness';
import { POLICIES } from '@/lib/http/rateLimit';
import { createUsageCounter } from '@/lib/engine/model';
import type { Fingerprint, TrackRecord } from '@/lib/types';

// The real MusicBrainz limiter is serial at ≥1100 ms; against a stubbed fetch that would
// make this file sleep for no reason. `resetHarness()` rebuilds the limiters each test.
POLICIES['musicbrainz.org'] = { limit: 10_000, windowMs: 1, minGapMs: 0, serial: false };

/* ------------------------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------------------------ */

function seedWith(tags: { name: string; count: number }[]): TrackRecord {
  return {
    key: 'isrc:GBALB8300001',
    isrc: 'GBALB8300001',
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
    ids: {},
    tags: tags.length > 0 ? { value: tags, source: { source: 'lastfm' } } : null,
    features: null,
    resolvedAt: 1_700_000_000_000,
    degraded: [],
  };
}

const SEED = seedWith([
  { name: 'swing', count: 100 },
  { name: 'electro swing', count: 80 },
  { name: 'jazz', count: 60 },
]);

const FINGERPRINT = { genre_labels: [] } as unknown as Fingerprint;

function recording(id: string, artist: string, title: string, score: number, tags: string[] = []) {
  return {
    id,
    title,
    score,
    'artist-credit': [{ name: artist, artist: { id: `mbid-${artist}`, name: artist } }],
    tags: tags.map((name) => ({ name, count: 1 })),
  };
}

function recordings(...recs: ReturnType<typeof recording>[]) {
  return { count: recs.length, recordings: recs };
}

function ctxFor(signal?: AbortSignal): ChannelContext & { lines: string[] } {
  const lines: string[] = [];
  return { seedKey: SEED.key, usage: createUsageCounter(), signal, log: (l) => lines.push(l), lines };
}

const recordingRoute = (body: unknown): Route => ({ when: '/recording', body });

afterEach(() => resetHarness());

/* ------------------------------------------------------------------------------------ *
 * The cohort query
 * ------------------------------------------------------------------------------------ */

describe('channelB — MusicBrainz tag cohort', () => {
  it('quotes each tag and ANDs the seed\'s strongest tags into one query', async () => {
    const h = installFetch([
      recordingRoute(recordings(recording('r1', 'Caravan Palace', 'Lone Digger', 100))),
    ]);
    await channelB(SEED, FINGERPRINT, ctxFor());
    const url = h.urls().find((u) => u.includes('/recording'));
    expect(url).toBeDefined();
    // `tag:"swing"` etc., URL-encoded. Quoting is mandatory — an unquoted multi-word tag
    // explodes to ~1M junk.
    expect(url).toContain('tag%3A%22swing%22');
    expect(url).toContain('tag%3A%22electro%20swing%22');
    expect(url).toContain('AND');
  });

  it('turns each surviving recording into a Channel B candidate with an inline-tag hint', async () => {
    installFetch([
      recordingRoute(
        recordings(
          recording('r1', 'Caravan Palace', 'Lone Digger', 100, ['electro swing', 'nu jazz']),
          recording('r2', 'Parov Stelar', 'Booty Swing', 95, ['electro swing']),
        ),
      ),
    ]);
    const res = await channelB(SEED, FINGERPRINT, ctxFor());
    expect(res.status).toBe('done');
    expect(res.candidates.map((c) => c.artist).sort()).toEqual(['Caravan Palace', 'Parov Stelar']);
    for (const c of res.candidates) {
      expect(c.channels).toEqual(['B']);
      const hint = c.hints[0];
      expect(hint?.sourceUrl).toMatch(/musicbrainz\.org\/recording\//);
      expect(hint?.sentence).toMatch(/tag cohort/i);
    }
  });

  it('drops the seed artist and dedupes by normalised artist', async () => {
    installFetch([
      recordingRoute(
        recordings(
          recording('r1', 'Caravan Palace', 'Lone Digger', 100),
          // Same artist, different track: only the first survives.
          recording('r2', 'caravan palace', 'Wonderland', 98),
          // The seed artist: dropped.
          recording('r3', 'The Cure', 'Close to Me', 99),
        ),
      ),
    ]);
    const res = await channelB(SEED, FINGERPRINT, ctxFor());
    expect(res.candidates.map((c) => c.artist)).toEqual(['Caravan Palace']);
    expect(res.candidates.some((c) => /the cure/i.test(c.artist))).toBe(false);
  });

  it('keeps only recordings MusicBrainz scores at or above 85 (the source enforces it)', async () => {
    installFetch([
      recordingRoute(
        recordings(
          recording('r1', 'Caravan Palace', 'Lone Digger', 100),
          recording('r2', 'Weak Match', 'Barely Related', 80),
        ),
      ),
    ]);
    const res = await channelB(SEED, FINGERPRINT, ctxFor());
    expect(res.candidates.map((c) => c.artist)).toEqual(['Caravan Palace']);
  });

  it('caps the candidate list', async () => {
    const many = Array.from({ length: MAX_CANDIDATES + 10 }, (_, i) =>
      recording(`r${i}`, `Artist ${i}`, `Title ${i}`, 90),
    );
    installFetch([recordingRoute(recordings(...many))]);
    const res = await channelB(SEED, FINGERPRINT, ctxFor());
    expect(res.candidates).toHaveLength(MAX_CANDIDATES);
  });

  it('widens to the top two tags when the three-tag cohort is empty', async () => {
    const h = installFetch([
      // The 3-tag query (contains `jazz`) returns nothing.
      { when: (u) => u.includes('/recording') && u.includes('jazz'), body: recordings() },
      // The 2-tag retry returns a cohort.
      recordingRoute(recordings(recording('r1', 'Caravan Palace', 'Lone Digger', 100))),
    ]);
    const res = await channelB(SEED, FINGERPRINT, ctxFor());
    expect(res.candidates.map((c) => c.artist)).toEqual(['Caravan Palace']);
    // Two MusicBrainz calls: the tight cohort and the widened retry.
    expect(h.urls().filter((u) => u.includes('/recording'))).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Degrade paths
 * ------------------------------------------------------------------------------------ */

describe('channelB — degrade paths', () => {
  it('is skipped honestly when the seed has fewer than two usable tags', async () => {
    const h = installFetch([]);
    const thin = seedWith([{ name: 'swing', count: 100 }]);
    const res = await channelB(thin, FINGERPRINT, ctxFor());
    expect(res).toMatchObject({ channel: 'B', status: 'skipped', candidates: [] });
    expect(res.reason).toMatch(new RegExp(`${MIN_USABLE_TAGS} usable tags`));
    // No request made when there is no cohort to search.
    expect(h.urls()).toHaveLength(0);
  });

  it('errors (not throws) when the MusicBrainz search fails', async () => {
    installFetch([{ when: '/recording', body: 'not valid json' }]);
    const res = await channelB(SEED, FINGERPRINT, ctxFor());
    expect(res.status).toBe('error');
    expect(res.reason).toMatch(/musicbrainz cohort/i);
    expect(res.candidates).toEqual([]);
  });

  it('returns before any request on an already-aborted signal', async () => {
    const h = installFetch([]);
    const controller = new AbortController();
    controller.abort();
    const res = await channelB(SEED, FINGERPRINT, ctxFor(controller.signal));
    expect(res).toMatchObject({ status: 'error', reason: 'aborted' });
    expect(h.urls()).toHaveLength(0);
  });

  it('never emits an ANTHROPIC_API_KEY degrade', async () => {
    const h = installFetch([]);
    const res = await channelB(seedWith([]), FINGERPRINT, ctxFor());
    expect(JSON.stringify(res)).not.toMatch(/ANTHROPIC/i);
    expect(h.urls()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------------------ *
 * seedCohortTags
 * ------------------------------------------------------------------------------------ */

describe('seedCohortTags', () => {
  it('folds Last.fm tags and AcousticBrainz genre labels, strongest first', () => {
    const seed = seedWith([{ name: 'swing', count: 100 }]);
    seed.features = { source: { source: 'acousticbrainz' }, genreLabels: ['electro swing', 'lounge'] };
    const tags = seedCohortTags(seed).map((t) => t.name);
    expect(tags[0]).toBe('swing');
    expect(tags).toContain('electro swing');
    expect(tags).toContain('lounge');
  });

  it('drops nationality/decade junk so it never reaches the cohort', () => {
    const seed = seedWith([
      { name: 'british', count: 100 },
      { name: '80s', count: 90 },
      { name: 'swing', count: 50 },
    ]);
    const tags = seedCohortTags(seed).map((t) => t.name);
    expect(tags).not.toContain('british');
    expect(tags).not.toContain('80s');
    expect(tags).toContain('swing');
  });
});
