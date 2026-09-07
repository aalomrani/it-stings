import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { artworkAt, findTrack, lookupById, pickBestHit, searchSongs } from '@/lib/sources/itunes';
import { fixture, installFetch, itunesBody, resetHarness } from './harness';

beforeEach(() => resetHarness());
afterEach(() => resetHarness());

describe('searchSongs', () => {
  it('parses the recorded body — including the three leading newlines', async () => {
    const h = installFetch([{ when: 'itunes.apple.com/search', body: itunesBody('itunes-search-lovecats') }]);

    const res = await searchSongs('The Cure   The Lovecats');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [first] = res.value;
    expect(first).toMatchObject({
      itunesId: 1288102536,
      title: 'The Lovecats',
      artist: 'The Cure',
      album: 'Greatest Hits',
      durationMs: 220093,
      releaseYear: 1983,
      country: 'US',
    });
    expect(first.artworkSmall).toContain('200x200bb.jpg');
    expect(first.artworkLarge).toContain('600x600bb.jpg');
    expect(first.previewUrl).toContain('audio-ssl.itunes.apple.com');

    // Query normalised (collapsed + lowercased) and params sorted, for Akamai's edge cache.
    expect(h.urls()[0]).toBe(
      'https://itunes.apple.com/search?country=US&entity=song&limit=8&media=music&term=the%20cure%20the%20lovecats',
    );
  });

  it('serves the second identical call from the SQLite cache', async () => {
    const h = installFetch([{ when: 'itunes.apple.com', body: fixture('itunes-search-lovecats') }]);
    await searchSongs('the cure the lovecats');
    const second = await searchSongs('the cure the lovecats');
    expect(second.ok && second.fromCache).toBe(true);
    expect(h.calls).toHaveLength(1);
  });

  it('rejects an empty term without a request', async () => {
    const h = installFetch([]);
    const res = await searchSongs('   ');
    expect(res).toEqual({ ok: false, reason: 'invalid_request', detail: 'empty term' });
    expect(h.calls).toHaveLength(0);
  });

  it('turns an upstream failure into a typed reason, never a throw', async () => {
    installFetch([{ when: 'itunes.apple.com', status: 500, body: 'boom' }]);
    const res = await searchSongs('the cure the lovecats');
    expect(res).toMatchObject({ ok: false, reason: 'upstream_error' });
  });

  it('reports a body that is not JSON as bad_response', async () => {
    installFetch([{ when: 'itunes.apple.com', body: '<html>nope</html>' }]);
    const res = await searchSongs('the cure the lovecats');
    expect(res).toMatchObject({ ok: false, reason: 'bad_response' });
  });
});

describe('lookupById', () => {
  it('returns the canonical record for an id', async () => {
    installFetch([{ when: '/lookup', body: fixture('itunes-lookup-1288102536') }]);
    const res = await lookupById(1288102536);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.title).toBe('The Lovecats');
    expect(res.value.album).toBe('Greatest Hits');
    expect(res.value.releaseYear).toBe(1983);
  });

  it('treats an empty result set as not_found (a wrong storefront answers 200/0)', async () => {
    installFetch([{ when: '/lookup', body: { resultCount: 0, results: [] } }]);
    const res = await lookupById(1288102536);
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });
});

describe('pickBestHit', () => {
  const hits = () => {
    const raw = fixture<{ results: Record<string, unknown>[] }>('itunes-search-lovecats');
    return raw.results.map((t) => ({
      itunesId: t.trackId as number,
      title: t.trackName as string,
      artist: t.artistName as string,
      album: (t.collectionName as string) ?? null,
      artworkSmall: null,
      artworkLarge: null,
      previewUrl: (t.previewUrl as string) ?? null,
      durationMs: (t.trackTimeMillis as number) ?? null,
      releaseYear: null,
      releaseDate: null,
      url: null,
      country: 'US',
    }));
  };

  it('prefers the studio original over the live and remastered editions', () => {
    const best = pickBestHit(hits(), { artist: 'The Cure', title: 'The Lovecats' });
    expect(best?.itunesId).toBe(1288102536);
  });

  it('never returns another artist covering the same song', () => {
    const covers = hits().filter((h) => h.artist !== 'The Cure');
    expect(covers.length).toBeGreaterThan(0);
    expect(pickBestHit(covers, { artist: 'The Cure', title: 'The Lovecats' })).toBeNull();
  });

  it('uses duration to choose between two takes of the same title', () => {
    const best = pickBestHit(hits(), {
      artist: 'The Cure',
      title: 'The Lovecats',
      durationMs: 228800, // the acoustic version's length
    });
    expect(best?.itunesId).toBe(1753357316);
  });

  it('keeps the live take out even when its duration matches exactly', () => {
    const best = pickBestHit(hits(), {
      artist: 'The Cure',
      title: 'The Lovecats',
      durationMs: 230055, // the Bestival live length
    });
    expect(best?.itunesId).not.toBe(1452098210);
  });

  it('returns the live take when the query asks for it by name and length', () => {
    // Normalisation erases "(Bestival Live 2011)", so the live penalty lifting is what
    // lets the duration decide — without it the studio take wins on the exact-title bonus.
    const best = pickBestHit(hits(), {
      artist: 'The Cure',
      title: 'The Lovecats (Bestival Live 2011)',
      durationMs: 230055,
    });
    expect(best?.itunesId).toBe(1452098210);
  });
});

describe('findTrack', () => {
  it('searches and applies the artist+title match rule', async () => {
    installFetch([{ when: 'itunes.apple.com', body: fixture('itunes-search-lovecats') }]);
    const res = await findTrack('The Cure', 'The Lovecats');
    expect(res.ok && res.value.itunesId).toBe(1288102536);
  });

  it('misses when nothing matches the artist', async () => {
    installFetch([{ when: 'itunes.apple.com', body: fixture('itunes-search-lovecats') }]);
    const res = await findTrack('The Cure', 'Purple Marmalade Sunrise');
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });
});

describe('artworkAt', () => {
  it('rewrites the size segment and leaves other URLs alone', () => {
    expect(artworkAt('https://x/abc/100x100bb.jpg', 600)).toBe('https://x/abc/600x600bb.jpg');
    expect(artworkAt('https://x/abc/60x60bb.png', 200)).toBe('https://x/abc/200x200bb.png');
    expect(artworkAt(undefined, 600)).toBeNull();
  });
});
