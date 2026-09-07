import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixture, installFetch, resetHarness } from '@/lib/sources/__tests__/harness';

const mocks = vi.hoisted(() => ({
  env: {
    lastfmApiKey: undefined,
    tavilyApiKey: undefined,
    braveApiKey: undefined,
    spotifyClientId: undefined,
    spotifyClientSecret: undefined,
    getsongbpmApiKey: undefined,
    keys: { websearch: null },
  },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env, keys: mocks.env.keys }));

const { verifyCandidate, verifyMany } = await import('@/lib/resolve/verifyCandidate');
const verificationsRepo = await import('@/lib/db/repos/verifications');
const tracksRepo = await import('@/lib/db/repos/tracks');

/** Everything the Lovecats resolve needs, keyless. */
const lovecatsRoutes = () => [
  { when: 'api.deezer.com/search', body: fixture('deezer-search-lovecats-advanced') },
  { when: 'api.deezer.com/track/', body: fixture('deezer-track-1143631') },
  { when: 'itunes.apple.com', body: fixture('itunes-search-lovecats') },
  { when: 'musicbrainz.org/ws/2/isrc/', body: fixture('mb-isrc-GBALB8300001') },
  { when: '/low-level', body: fixture('ab-low-level-1c19fbb9') },
  { when: '/high-level', body: fixture('ab-high-level-1c19fbb9') },
];

/** Deezer and iTunes both answer, but with nothing that matches. */
const missRoutes = () => [
  { when: 'api.deezer.com/search', body: { data: [], total: 0 } },
  { when: 'itunes.apple.com', body: { resultCount: 0, results: [] } },
];

beforeEach(() => resetHarness());
afterEach(() => resetHarness());

describe('verifyCandidate', () => {
  it('verifies a real track via Deezer and caches the hit', async () => {
    const h = installFetch(lovecatsRoutes());

    const res = await verifyCandidate({ artist: 'The Cure', title: 'The Lovecats' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.track.key).toBe('isrc:GBALB8300001');

    expect(verificationsRepo.get('The Cure', 'The Lovecats')).toMatchObject({
      normArtist: 'cure',
      normTitle: 'the lovecats',
      trackKey: 'isrc:GBALB8300001',
    });

    const before = h.calls.length;
    const again = await verifyCandidate({ artist: 'the cure', title: 'The Lovecats (Remastered)' });
    expect(again.ok && again.cached).toBe(true);
    expect(again.ok && again.track.preview?.url).toContain('dzcdn.net');
    // Zero requests: the verification row, the track row and even the preview mint (13
    // minutes) are all cached. A repeated candidate is free.
    expect(h.calls.length - before).toBe(0);
  });

  it('caches a MISS so a hallucinated title is only ever looked up once', async () => {
    const h = installFetch(missRoutes());

    const first = await verifyCandidate({ artist: 'The Cure', title: 'Purple Marmalade Sunrise' });
    expect(first).toEqual({ ok: false, reason: 'not_found' });

    const row = verificationsRepo.get('The Cure', 'Purple Marmalade Sunrise');
    expect(row?.trackKey).toBeNull();

    const calls = h.calls.length;
    const second = await verifyCandidate({ artist: 'The Cure', title: 'Purple Marmalade Sunrise' });
    expect(second).toEqual({ ok: false, reason: 'not_found' });
    expect(h.calls.length).toBe(calls); // no second lookup
  });

  it('rejects a wrong-song match: a real hit whose title is a different track', async () => {
    // Deezer answers with "Close to Me" for a "The Lovecats" candidate.
    const plain = fixture<{ data: Record<string, unknown>[] }>('deezer-search-lovecats-plain');
    const closeToMe = { data: plain.data.filter((t) => t.id === 909884) };
    const h = installFetch([
      { when: 'api.deezer.com/search', body: closeToMe },
      { when: 'itunes.apple.com', body: { resultCount: 0, results: [] } },
    ]);

    const res = await verifyCandidate({ artist: 'The Cure', title: 'The Lovecats' });
    expect(res).toEqual({ ok: false, reason: 'not_found' });
    expect(h.urls().some((u) => u.includes('/track/'))).toBe(false); // never resolved it
  });

  it('rejects a cover by a different artist', async () => {
    const search = fixture<{ results: Record<string, unknown>[] }>('itunes-search-lovecats');
    const coversOnly = {
      resultCount: 2,
      results: search.results.filter((r) => r.artistName !== 'The Cure'),
    };
    installFetch([
      { when: 'api.deezer.com/search', body: { data: [], total: 0 } },
      { when: 'itunes.apple.com', body: coversOnly },
    ]);

    expect(await verifyCandidate({ artist: 'The Cure', title: 'The Lovecats' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('falls back to iTunes when Deezer has nothing', async () => {
    installFetch([
      { when: 'api.deezer.com/search', body: { data: [], total: 0 } },
      { when: 'itunes.apple.com/search', body: fixture('itunes-search-lovecats') },
      { when: 'itunes.apple.com/lookup', body: fixture('itunes-lookup-1288102536') },
      { when: 'musicbrainz.org', status: 404, body: fixture('mb-isrc-not-found') },
    ]);

    const res = await verifyCandidate({ artist: 'The Cure', title: 'The Lovecats' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.track.key).toBe('itunes:1288102536');
  });

  it('short-circuits on an already-resolved track', async () => {
    installFetch(lovecatsRoutes());
    await verifyCandidate({ artist: 'The Cure', title: 'The Lovecats' });
    // Drop the verification row but keep the track: `tracks.findByNorm` must still hit.
    const db = (await import('@/lib/db')).getDb();
    db.exec('DELETE FROM verifications');
    expect(tracksRepo.findByNorm('The Cure', 'The Lovecats')).not.toBeNull();

    const res = await verifyCandidate({ artist: 'The Cure', title: 'The Lovecats' });
    expect(res.ok && res.cached).toBe(true);
    expect(verificationsRepo.get('The Cure', 'The Lovecats')?.trackKey).toBe('isrc:GBALB8300001');
  });

  it('refuses an empty candidate', async () => {
    const h = installFetch([]);
    expect(await verifyCandidate({ artist: '', title: '' })).toEqual({ ok: false, reason: 'not_found' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('verifyMany', () => {
  it('dedupes by normalised key before fanning out', async () => {
    const h = installFetch([...lovecatsRoutes()]);

    const results = await verifyMany(
      [
        { artist: 'The Cure', title: 'The Lovecats' },
        { artist: 'the cure', title: 'The Lovecats (2006 Remaster)' },
        { artist: 'The Cure', title: 'The Lovecats' },
      ],
      { concurrency: 6 },
    );

    expect(results.size).toBe(1);
    expect([...results.keys()]).toEqual(['cure|the lovecats']);
    expect(results.get('cure|the lovecats')?.ok).toBe(true);
    // Candidates take the FAST path (resolveTrack `candidate: true`): they skip the strictly
    // serial MusicBrainz queue AND AcousticBrainz entirely, so the deduped candidate makes
    // ZERO MusicBrainz calls (it scores on Deezer tempo + Deezer album genre instead). This
    // is the speedup: MusicBrainz and AcousticBrainz are the slow, often-degraded sources.
    expect(h.urls().filter((u) => u.includes('musicbrainz')).length).toBe(0);
  });

  it('keeps hits and misses apart in one pass', async () => {
    installFetch([
      { when: 'artist%3A%22The%20Cure%22%20track%3A%22The%20Lovecats%22', body: fixture('deezer-search-lovecats-advanced') },
      { when: 'api.deezer.com/track/', body: fixture('deezer-track-1143631') },
      { when: 'api.deezer.com/search', body: { data: [], total: 0 } },
      { when: 'itunes.apple.com/search', body: { resultCount: 0, results: [] } },
      { when: 'musicbrainz.org/ws/2/isrc/', body: fixture('mb-isrc-GBALB8300001') },
      { when: '/low-level', body: fixture('ab-low-level-1c19fbb9') },
      { when: '/high-level', body: fixture('ab-high-level-1c19fbb9') },
    ]);

    const results = await verifyMany([
      { artist: 'The Cure', title: 'The Lovecats' },
      { artist: 'The Cure', title: 'Purple Marmalade Sunrise' },
      { artist: 'Nonexistent Band', title: 'Imaginary Song' },
    ]);

    expect(results.get('cure|the lovecats')?.ok).toBe(true);
    expect(results.get('cure|purple marmalade sunrise')).toEqual({ ok: false, reason: 'not_found' });
    expect(results.get('nonexistent band|imaginary song')).toEqual({ ok: false, reason: 'not_found' });
  }, 15_000);

  it('reports each candidate through onVerified as it settles, not at the end', async () => {
    installFetch([...lovecatsRoutes(), { when: 'itunes.apple.com/search', body: { resultCount: 0, results: [] } }]);

    const seen: string[] = [];
    const results = await verifyMany(
      [
        { artist: 'The Cure', title: 'The Lovecats' },
        { artist: 'Nonexistent Band', title: 'Imaginary Song' },
      ],
      { concurrency: 1, onVerified: (key) => seen.push(key) },
    );

    expect(seen.sort()).toEqual([...results.keys()].sort());
  }, 15_000);

  it('stops pulling work once the signal aborts', async () => {
    installFetch([...lovecatsRoutes()]);
    const controller = new AbortController();
    controller.abort();

    const h = installFetch([...lovecatsRoutes()]);
    const results = await verifyMany(
      [
        { artist: 'The Cure', title: 'The Lovecats' },
        { artist: 'Talking Heads', title: 'Psycho Killer' },
      ],
      { concurrency: 1, signal: controller.signal },
    );

    // Nobody is listening: not one upstream request was made, and nothing was answered.
    expect(results.size).toBe(0);
    expect(h.calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Stage 4 must not certify a different artist or a different performance
 * ------------------------------------------------------------------------------------ */

describe('the Stage-4 gate', () => {
  const hit = (over: Record<string, unknown>) => ({
    id: 1,
    title: 'Titanium',
    title_short: 'Titanium',
    artist: { id: 9, name: 'Sia' },
    album: { id: 3, title: 'A', cover_medium: 'c', cover_xl: 'cxl' },
    duration: 245,
    rank: 500_000,
    preview: 'https://cdnt-preview.dzcdn.net/x',
    link: 'https://deezer.com/track/1',
    ...over,
  });

  it('rejects a hit whose artist merely CONTAINS the candidate name', async () => {
    // The live failure: verify "Sia / Titanium" hit Deezer 1287048182, "Sia Momo —
    // Titanium (2T21 Edit)", and cached the impersonation for 30 days.
    installFetch([
      {
        when: 'api.deezer.com/search',
        body: { data: [hit({ artist: { id: 7, name: 'Sia Momo' }, title: 'Titanium (2T21 Edit)', title_short: 'Titanium' })], total: 1 },
      },
      { when: 'itunes.apple.com', body: { resultCount: 0, results: [] } },
    ]);

    expect(await verifyCandidate({ artist: 'Sia', title: 'Titanium' }))
      .toEqual({ ok: false, reason: 'not_found' });
    expect(verificationsRepo.get('Sia', 'Titanium')?.trackKey).toBeNull();
  });

  it('rejects a LIVE take when the candidate asked for no variant', async () => {
    installFetch([
      {
        when: 'api.deezer.com/search',
        body: {
          data: [hit({
            artist: { id: 4, name: 'Haley Reinhart, Wheeling High School Jazz Combo & Brian Logan' },
            title: 'Creep (Live)',
            title_short: 'Creep',
          })],
          total: 1,
        },
      },
      { when: 'itunes.apple.com', body: { resultCount: 0, results: [] } },
    ]);

    expect(await verifyCandidate({ artist: 'Haley Reinhart', title: 'Creep' }))
      .toEqual({ ok: false, reason: 'not_found' });
  });

  it('accepts a credit that names the candidate as a FEATURED artist', async () => {
    installFetch([
      {
        when: 'api.deezer.com/search',
        body: {
          data: [hit({
            id: 42,
            artist: { id: 5, name: "Scott Bradlee's Postmodern Jukebox" },
            title: 'Creep (feat. Haley Reinhart)',
            title_short: 'Creep',
            isrc: 'GBDMT1500097',
          })],
          total: 1,
        },
      },
      { when: 'api.deezer.com/track/', body: hit({ id: 42, artist: { id: 5, name: "Scott Bradlee's Postmodern Jukebox" }, title: 'Creep (feat. Haley Reinhart)', title_short: 'Creep', isrc: 'GBDMT1500097', bpm: 0 }) },
      { when: 'itunes.apple.com', body: { resultCount: 0, results: [] } },
      { when: 'musicbrainz.org', status: 404, body: { error: 'Not Found' } },
    ]);

    const res = await verifyCandidate({ artist: 'Haley Reinhart', title: 'Creep' });
    expect(res.ok).toBe(true);
    // And the row is labelled with the credit a SOURCE gave, not the caller's query.
    if (res.ok) expect(res.track.artist).toBe("Scott Bradlee's Postmodern Jukebox");
  }, 15_000);
});
