/**
 * Channel A — the Last.fm channel, now with a DETERMINISTIC tag pivot (no model).
 *
 * One seam is stubbed and nothing else: `fetchExternal` (the source harness, with bodies in
 * the exact XML-shaped JSON Last.fm documents — string numbers, `@attr` ranks, a plain
 * string artist on `track.search`). No network, no model, and the channel is skipped
 * entirely without the free Last.fm key.
 *
 * The assertions that matter to the spec, not just to the code:
 *   - without a key the channel makes NO request (upstream error 6 is ambiguous);
 *   - the generic tags never become a pivot, the seed's own artist name included;
 *   - the pivot is the heaviest surviving crowd tags, chosen by count with no model;
 *   - the seed never comes back as its own candidate, including under Last.fm's other
 *     spelling of the same recording;
 *   - every evidence row carries the measured number and the Last.fm URL it came from.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixture, installFetch, resetHarness } from '@/lib/sources/__tests__/harness';

const mocks = vi.hoisted(() => ({
  env: {
    lastfmApiKey: undefined as string | undefined,
    anthropicApiKey: undefined as string | undefined,
    model: 'claude-opus-5',
    fallbacks: true,
  },
}));
// `keys` is the presence-only accessor Channel A reads (never the secret's value); the
// getter keeps it live so a test that sets `mocks.env.lastfmApiKey` still flips it.
vi.mock('@/lib/env', () => ({
  env: mocks.env,
  keys: {
    get lastfm() {
      return Boolean(mocks.env.lastfmApiKey);
    },
    get anthropic() {
      return Boolean(mocks.env.anthropicApiKey);
    },
    websearch: null,
    spotify: false,
    getsongbpm: false,
  },
}));

import type { Fingerprint, TrackRecord } from '@/lib/types';

const { channelA, isGenericTag, pickPivotTags, MAX_PIVOT_TAGS, MAX_CANDIDATES, NO_KEY_REASON } =
  await import('@/lib/engine/channels/a');
const { createUsageCounter } = await import('@/lib/engine/model');

/* ------------------------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------------------------ */

const seedTrack = (over: Partial<TrackRecord> = {}): TrackRecord => ({
  key: 'isrc:GBALB8300001',
  isrc: 'GBALB8300001',
  title: 'The Lovecats',
  artist: 'The Cure',
  album: 'Japanese Whispers',
  year: { value: 1983, source: { source: 'itunes' } },
  durationMs: null,
  artwork: null,
  preview: null,
  tempoBpm: { value: 128, source: { source: 'deezer' } },
  keySignature: null,
  links: {},
  ids: {},
  tags: null,
  features: null,
  resolvedAt: 0,
  degraded: [],
  ...over,
});

const fingerprint = (): Fingerprint => ({
  tempo_bpm: 128,
  tempo_feel: 'bouncing',
  rhythmic_character: 'swung shuffle, upright bass walking in quarters',
  instrumentation: ['upright bass', 'brushed kit'],
  vocal_delivery: 'playful, affected, breaks into scat and animal noises',
  harmonic_language: 'minor-key jazz voicings',
  emotional_register: 'arch, flirtatious, faintly sinister',
  production_texture: 'roomy 1983 analogue',
  era: 1983,
  scene_context: 'post-punk band deliberately playing lounge jazz',
  signature_hook: 'the meowing',
  genre_labels: ['post-punk', 'jazz pop'],
  confidence: {
    tempo_feel: 'high',
    rhythmic_character: 'high',
    instrumentation: 'medium',
    vocal_delivery: 'high',
    harmonic_language: 'medium',
    emotional_register: 'high',
    production_texture: 'medium',
    scene_context: 'high',
    signature_hook: 'high',
  },
  grounded_on: ['Deezer bpm 128'],
  model: 'deterministic-v1',
});

/** Last.fm's documented JSON: string numbers, artist as a nested object. */
const similarBody = (tracks: Array<{ artist: string; title: string; match: number }>) => ({
  similartracks: {
    track: tracks.map((t) => ({
      name: t.title,
      mbid: '',
      match: String(t.match),
      url: `https://www.last.fm/music/${encodeURIComponent(t.artist)}/_/${encodeURIComponent(t.title)}`,
      artist: { name: t.artist, mbid: '', url: `https://www.last.fm/music/${t.artist}` },
    })),
    '@attr': { artist: 'The Cure', track: 'The Lovecats' },
  },
});

const tagsBody = (tags: Array<[string, number]>) => ({
  toptags: {
    tag: tags.map(([name, count]) => ({
      name,
      count: String(count),
      url: `https://www.last.fm/tag/${encodeURIComponent(name)}`,
    })),
  },
});

const tagTracksBody = (tracks: Array<{ artist: string; title: string }>) => ({
  tracks: {
    track: tracks.map((t, i) => ({
      name: t.title,
      mbid: '',
      url: `https://www.last.fm/music/${encodeURIComponent(t.artist)}/_/${encodeURIComponent(t.title)}`,
      artist: { name: t.artist },
      '@attr': { rank: String(i + 1) },
    })),
  },
});

/** `track.search`: artist is a PLAIN STRING here, unlike every other method. */
const searchBody = (tracks: Array<{ artist: string; title: string; listeners: number }>) => ({
  results: {
    trackmatches: {
      track: tracks.map((t) => ({
        name: t.title,
        artist: t.artist,
        listeners: String(t.listeners),
        url: `https://www.last.fm/music/${encodeURIComponent(t.artist)}/_/${encodeURIComponent(t.title)}`,
      })),
    },
  },
});

/* ------------------------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------------------------ */

let logs: string[] = [];

function ctx(signal?: AbortSignal) {
  return {
    seedKey: 'isrc:GBALB8300001',
    usage: createUsageCounter(),
    signal,
    log: (line: string) => logs.push(line),
  };
}

beforeEach(() => {
  resetHarness();
  logs = [];
  mocks.env.lastfmApiKey = 'testkey';
});

afterEach(() => {
  resetHarness();
});

/* ------------------------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------------------------ */

describe('without LASTFM_API_KEY', () => {
  it('skips without touching the network', async () => {
    mocks.env.lastfmApiKey = undefined;
    const h = installFetch([]);

    const res = await channelA(seedTrack(), fingerprint(), ctx());

    expect(res).toEqual({
      channel: 'A',
      status: 'skipped',
      reason: NO_KEY_REASON,
      candidates: [],
      live: false,
      evidence: {},
    });
    expect(h.calls).toHaveLength(0);
  });
});

describe('the deterministic tag picker', () => {
  it('keeps the heaviest surviving tags, by count, up to the ceiling', () => {
    const picked = pickPivotTags([
      { name: 'swing revival', count: 100, url: null },
      { name: 'lounge', count: 40, url: null },
      { name: 'jump blues', count: 70, url: null },
      { name: 'psychobilly', count: 10, url: null },
      { name: 'sophisti-pop', count: 5, url: null },
    ]);
    expect(picked.map((p) => p.tag)).toEqual(['swing revival', 'jump blues', 'lounge', 'psychobilly']);
    expect(picked).toHaveLength(MAX_PIVOT_TAGS);
    // Every pick carries the concrete number, so the evidence trail says why it fired.
    expect(picked[0].reason).toMatch(/100/);
  });

  it('is stable: equal counts break by name, and it makes no model call', () => {
    const picked = pickPivotTags([
      { name: 'zydeco', count: 20, url: null },
      { name: 'ska', count: 20, url: null },
    ]);
    expect(picked.map((p) => p.tag)).toEqual(['ska', 'zydeco']);
  });
});

describe('similar tracks + the tag pivot', () => {
  const routes = () => [
    {
      when: 'method=track.getSimilar',
      body: similarBody([
        { artist: 'The Cure', title: 'Close to Me', match: 0.91 },
        // Last.fm's OTHER entry for the same recording — the seed, spelled differently.
        { artist: 'The Cure', title: 'The Love Cats', match: 0.88 },
        { artist: 'Combustible Edison', title: 'Bluebeard', match: 0.42 },
      ]),
    },
    {
      when: 'method=track.getTopTags',
      body: tagsBody([
        // The heaviest two SURVIVORS of the blocklist are the pivot; the rest are generic.
        ['swing revival', 100],
        ['rock', 90],
        ['80s', 96],
        ['lounge', 40],
        ['the cure', 74],
        ['seen live', 33],
        ['female vocalists', 4],
      ]),
    },
    {
      when: 'tag=swing%20revival',
      body: tagTracksBody([
        { artist: "Cherry Poppin' Daddies", title: 'Zoot Suit Riot' },
        { artist: 'Royal Crown Revue', title: 'Hey Pachuco!' },
      ]),
    },
    {
      when: 'tag=lounge',
      body: tagTracksBody([
        { artist: 'Combustible Edison', title: 'Bluebeard' },
        { artist: 'Esquivel', title: 'Mini Skirt' },
      ]),
    },
  ];

  it('merges both halves, drops the seed, orders similar first, and makes no model call', async () => {
    installFetch(routes());

    const c = ctx();
    const res = await channelA(seedTrack(), fingerprint(), c);

    expect(res.status).toBe('done');
    expect(res.live).toBe(true);
    // Deterministic: nothing here costs a model call.
    expect(c.usage.calls).toBe(0);

    // The seed itself is gone under BOTH of Last.fm's spellings; "Close to Me" is not the
    // seed, so it survives this stage (rule 1 in rank.ts is what cuts it later).
    const names = res.candidates.map((x) => `${x.artist} — ${x.title}`);
    expect(names).not.toContain('The Cure — The Love Cats');
    expect(names).toContain('The Cure — Close to Me');

    // Similar-first, then the tag tracks round-robin across the two chosen tags.
    expect(names).toEqual([
      'The Cure — Close to Me',
      'Combustible Edison — Bluebeard',
      "Cherry Poppin' Daddies — Zoot Suit Riot",
      'Esquivel — Mini Skirt',
      'Royal Crown Revue — Hey Pachuco!',
    ]);

    // Found by getSimilar AND by the "lounge" pivot: one candidate, both hints.
    const bluebeard = res.candidates.find((x) => x.artist === 'Combustible Edison');
    expect(bluebeard?.channels).toEqual(['A']);
    expect(bluebeard?.hints).toEqual([{ lastfmMatch: 0.42 }, { tag: 'lounge' }]);

    // The generic tags never became a pivot: no request was ever made for one, and the
    // harness throws on an unrouted request, so a clean run is the proof.
    expect(logs.some((l) => l.includes('pivot tags "swing revival", "lounge"'))).toBe(true);
  });

  it('records an evidence row per half, with the measured number and the Last.fm URL', async () => {
    installFetch(routes());

    const before = Date.now();
    const res = await channelA(seedTrack(), fingerprint(), ctx());

    const rows = res.evidence['combustible edison|bluebeard'];
    expect(rows).toMatchObject([
      {
        channel: 'A',
        kind: 'lastfm_similar',
        url: 'https://www.last.fm/music/Combustible%20Edison/_/Bluebeard',
        title: 'Combustible Edison — Bluebeard',
        detail: 'Last.fm match 0.42 · rank 3 of 3',
        live: true,
      },
      {
        channel: 'A',
        kind: 'lastfm_tag',
        url: 'https://www.last.fm/music/Combustible%20Edison/_/Bluebeard',
        title: 'Combustible Edison — Bluebeard',
        detail: 'tag: lounge',
        live: true,
      },
    ]);
    for (const row of rows) {
      expect(row.fetchedAt).toBeGreaterThanOrEqual(before);
      expect(row.fetchedAt).toBeLessThanOrEqual(Date.now());
    }
    // No row survives for a candidate that is not in the list.
    expect(res.evidence['the cure|the love cats']).toBeUndefined();
  });
});

describe('the generic-tag blocklist', () => {
  it('cuts decades, umbrella genres, listener metadata and the seed s own name', () => {
    const seed = { artist: 'The Cure', title: 'The Lovecats' };
    for (const generic of [
      '80s', '1980s', "'80s", '1983', 'rock', 'pop', 'alternative', 'indie', 'seen live',
      'favorites', 'female vocalists', 'male vocalists', 'british', 'japanese', 'oldies',
      'The Cure', 'the cure', 'lovecats',
    ]) {
      expect(isGenericTag(generic, seed), generic).toBe(true);
    }
    for (const specific of [
      'swing revival', 'electro swing', 'lounge', 'psychobilly', 'sophisti-pop',
      'post-punk', 'jump blues', 'shoegaze',
    ]) {
      expect(isGenericTag(specific, seed), specific).toBe(false);
    }
  });
});

describe('the title-variant retry', () => {
  it('asks track.search for the spelling Last.fm ranks first and retries once', async () => {
    // Every tag on this seed is generic, so the pivot is skipped and the test is only
    // about the retry. Stored tags also mean track.getTopTags is never called — a route
    // for it would have to exist, and the harness throws on an unrouted request.
    const seed = seedTrack({
      tags: {
        value: [
          { name: '80s', count: 100 },
          { name: 'rock', count: 90 },
        ],
        source: { source: 'lastfm' },
      },
    });

    const h = installFetch([
      {
        when: (u) => u.includes('method=track.getSimilar') && u.includes('track=The%20Lovecats'),
        body: similarBody([]),
      },
      {
        when: 'method=track.search',
        body: searchBody([{ artist: 'The Cure', title: 'The Love Cats', listeners: 116_006 }]),
      },
      {
        when: (u) => u.includes('method=track.getSimilar') && u.includes('track=The%20Love%20Cats'),
        body: similarBody([
          { artist: 'Louis Prima', title: "Jump, Jive an' Wail", match: 0.5 },
          { artist: 'The Cure', title: 'The Lovecats', match: 1 },
        ]),
      },
    ]);

    const res = await channelA(seed, fingerprint(), ctx());

    expect(h.urls()).toEqual([
      expect.stringContaining('method=track.getSimilar'),
      expect.stringContaining('method=track.search'),
      expect.stringContaining('track=The%20Love%20Cats'),
    ]);
    expect(res.status).toBe('done');
    expect(res.candidates.map((c) => c.artist)).toEqual(['Louis Prima']);
    // The variant IS the seed; it must not come back as its own recommendation.
    expect(res.candidates.some((c) => c.artist === 'The Cure')).toBe(false);
    expect(res.reason).toContain('title variant "The Love Cats"');
    expect(res.reason).toContain('tag pivot skipped: every tag was generic');
  });

  it('does not retry when search returns the same title back', async () => {
    const seed = seedTrack({
      tags: { value: [{ name: '80s', count: 100 }], source: { source: 'lastfm' } },
    });
    const h = installFetch([
      { when: 'method=track.getSimilar', body: similarBody([]) },
      {
        when: 'method=track.search',
        body: searchBody([{ artist: 'The Cure', title: 'The Lovecats', listeners: 943_363 }]),
      },
    ]);

    const res = await channelA(seed, fingerprint(), ctx());

    expect(h.calls).toHaveLength(2);
    expect(res.status).toBe('done');
    expect(res.candidates).toEqual([]);
  });
});

describe('degrading', () => {
  it('keeps the similar tracks when every chosen tag pull fails', async () => {
    installFetch([
      {
        when: 'method=track.getSimilar',
        body: similarBody([{ artist: 'Combustible Edison', title: 'Bluebeard', match: 0.42 }]),
      },
      { when: 'method=track.getTopTags', body: tagsBody([['swing revival', 40]]) },
      // The one chosen tag's top-tracks lookup fails.
      { when: 'tag=swing%20revival', status: 500, body: { error: 8, message: 'operation failed' } },
    ]);

    const c = ctx();
    const res = await channelA(seedTrack(), fingerprint(), c);

    expect(res.status).toBe('done');
    expect(res.candidates.map((x) => x.artist)).toEqual(['Combustible Edison']);
    expect(res.reason).toBe('tag pivot skipped: tag.getTopTracks failed for every chosen tag');
    // No model call anywhere on this path.
    expect(c.usage.calls).toBe(0);
  });

  it('is an error only when BOTH halves fail', async () => {
    installFetch([{ when: 'audioscrobbler', status: 403, body: fixture('lastfm-error-10') }]);

    const res = await channelA(seedTrack(), fingerprint(), ctx());

    expect(res.status).toBe('error');
    expect(res.reason).toContain('track.getSimilar invalid_api_key');
    expect(res.reason).toContain('track.getTopTags invalid_api_key');
    expect(res.candidates).toEqual([]);
  });

  it('never throws: anything unexpected becomes status error', async () => {
    installFetch([
      {
        when: 'method=track.getSimilar',
        body: similarBody([{ artist: 'Combustible Edison', title: 'Bluebeard', match: 0.42 }]),
      },
      { when: 'method=track.getTopTags', body: tagsBody([['swing revival', 40]]) },
    ]);

    // The channel's own logger blowing up is the cheapest way to prove that a throw from
    // ANY collaborator lands as a degraded result rather than as an exception in the run.
    const res = await channelA(seedTrack(), fingerprint(), {
      seedKey: 'isrc:GBALB8300001',
      usage: createUsageCounter(),
      log: () => {
        throw new Error('kaboom');
      },
    });

    expect(res).toMatchObject({ status: 'error', reason: 'kaboom', candidates: [] });
  });

  it('returns immediately on an aborted signal', async () => {
    const h = installFetch([]);
    const res = await channelA(seedTrack(), fingerprint(), ctx(AbortSignal.abort()));

    expect(res).toMatchObject({ status: 'error', reason: 'aborted' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('the cap', () => {
  it('keeps 80, similar first, then the tags round-robin', async () => {
    const many = (artistPrefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        artist: `${artistPrefix} ${i}`,
        title: `Track ${i}`,
      }));

    installFetch([
      {
        when: 'method=track.getSimilar',
        body: similarBody(many('Similar', 60).map((t, i) => ({ ...t, match: 1 - i / 100 }))),
      },
      {
        when: 'method=track.getTopTags',
        body: tagsBody([
          ['swing revival', 40],
          ['jump blues', 30],
          ['lounge', 20],
        ]),
      },
      { when: 'tag=swing%20revival', body: tagTracksBody(many('Swing', 50)) },
      { when: 'tag=jump%20blues', body: tagTracksBody(many('Jump', 50)) },
      { when: 'tag=lounge', body: tagTracksBody(many('Lounge', 50)) },
    ]);

    const res = await channelA(seedTrack(), fingerprint(), ctx());

    expect(res.candidates).toHaveLength(MAX_CANDIDATES);
    expect(res.candidates.slice(0, 60).every((c) => c.artist.startsWith('Similar'))).toBe(true);
    expect(res.candidates.slice(60, 66).map((c) => c.artist)).toEqual([
      'Swing 0', 'Jump 0', 'Lounge 0', 'Swing 1', 'Jump 1', 'Lounge 1',
    ]);
    // Evidence is pruned to what actually shipped.
    expect(Object.keys(res.evidence)).toHaveLength(MAX_CANDIDATES);
  });
});
