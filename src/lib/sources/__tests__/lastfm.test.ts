import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixture, installFetch, resetHarness } from './harness';

/** A mutable fake environment: these tests need both "no key" and "key present". */
const mocks = vi.hoisted(() => ({
  env: { lastfmApiKey: undefined as string | undefined },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env, keys: {} }));

const lastfm = await import('@/lib/sources/lastfm');

beforeEach(() => {
  resetHarness();
  mocks.env.lastfmApiKey = 'testkey';
});
afterEach(() => resetHarness());

describe('without a key', () => {
  it('returns no_api_key WITHOUT calling upstream (error 6 would be ambiguous)', async () => {
    mocks.env.lastfmApiKey = undefined;
    const h = installFetch([]);

    expect(await lastfm.getTopTags('The Cure', 'The Lovecats')).toEqual({
      ok: false,
      reason: 'no_api_key',
      detail: 'LASTFM_API_KEY is not set',
    });
    expect(await lastfm.getSimilar('The Cure', 'The Lovecats')).toMatchObject({ reason: 'no_api_key' });
    expect(await lastfm.getTagTopTracks('swing revival')).toMatchObject({ reason: 'no_api_key' });
    expect(h.calls).toHaveLength(0);
  });

  it('reports the recorded error-6 body as not_found once the key is present', async () => {
    // Same body, HTTP 400 — but now the key IS set and our params ARE valid, so the only
    // remaining meaning of code 6 is "no such track".
    installFetch([{ when: 'audioscrobbler', status: 400, body: fixture('lastfm-error-6') }]);
    expect(await lastfm.getTopTags('The Cure', 'Purple Marmalade Sunrise')).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('error 10', () => {
  it('is surfaced as invalid_api_key', async () => {
    installFetch([{ when: 'audioscrobbler', status: 403, body: fixture('lastfm-error-10') }]);
    expect(await lastfm.getSimilar('The Cure', 'The Lovecats')).toMatchObject({
      ok: false,
      reason: 'invalid_api_key',
    });
  });
});

describe('parsing the documented shapes', () => {
  it('getTopTags: string counts become numbers and tags sort by count', async () => {
    installFetch([
      {
        when: 'method=track.getTopTags',
        body: {
          toptags: {
            tag: [
              { name: 'post-punk', count: '100', url: 'https://www.last.fm/tag/post-punk' },
              { name: 'jazz', count: '42' },
            ],
            '@attr': { artist: 'The Cure', track: 'The Lovecats' },
          },
        },
      },
    ]);
    const res = await lastfm.getTopTags('The Cure', 'The Lovecats');
    expect(res.ok && res.value).toEqual([
      { name: 'post-punk', count: 100, url: 'https://www.last.fm/tag/post-punk' },
      { name: 'jazz', count: 42, url: null },
    ]);
  });

  it('getSimilar: reads similartracks.track[] with a nested artist object', async () => {
    installFetch([
      {
        when: 'method=track.getSimilar',
        body: {
          similartracks: {
            track: [
              {
                name: 'Zoot Suit Riot',
                match: '0.42',
                mbid: 'abc',
                url: 'https://www.last.fm/x',
                artist: { name: "Cherry Poppin' Daddies" },
              },
            ],
          },
        },
      },
    ]);
    const res = await lastfm.getSimilar('The Cure', 'The Lovecats', { limit: 10 });
    expect(res.ok && res.value[0]).toEqual({
      artist: "Cherry Poppin' Daddies",
      title: 'Zoot Suit Riot',
      match: 0.42,
      mbid: 'abc',
      url: 'https://www.last.fm/x',
    });
  });

  it('collapses a single repeated node back into an array', async () => {
    installFetch([
      {
        when: 'method=track.getSimilar',
        body: { similartracks: { track: { name: 'Hell', artist: 'Squirrel Nut Zippers', match: '1' } } },
      },
    ]);
    const res = await lastfm.getSimilar('The Cure', 'The Lovecats');
    expect(res.ok && res.value).toHaveLength(1);
  });

  it('getTagTopTracks: accepts the `tracks` container and the @attr rank', async () => {
    installFetch([
      {
        when: 'method=tag.getTopTracks',
        body: {
          tracks: {
            track: [{ name: 'Hell', artist: { name: 'Squirrel Nut Zippers' }, '@attr': { rank: '1' } }],
          },
        },
      },
    ]);
    const res = await lastfm.getTagTopTracks('swing revival', { limit: 5 });
    expect(res.ok && res.value[0]).toMatchObject({ title: 'Hell', rank: 1 });
  });

  it('getTrackInfo: coerces duration and reads the catalogue url', async () => {
    installFetch([
      {
        when: 'method=track.getInfo',
        body: {
          track: {
            name: 'The Lovecats',
            artist: { name: 'The Cure' },
            duration: '220000',
            listeners: '943363',
            url: 'https://www.last.fm/music/The+Cure/_/The+Lovecats',
            album: { title: 'Japanese Whispers' },
          },
        },
      },
    ]);
    const res = await lastfm.getTrackInfo('The Cure', 'The Lovecats');
    expect(res.ok && res.value).toMatchObject({
      durationMs: 220000,
      listeners: 943363,
      album: 'Japanese Whispers',
    });
  });
});

describe('request shape', () => {
  it('always sends autocorrect=1 and keeps the key out of the cached URL', async () => {
    const h = installFetch([{ when: 'audioscrobbler', body: { toptags: { tag: [] } } }]);
    await lastfm.getTopTags('The Cure', 'The Lovecats');

    expect(h.urls()[0]).toContain('autocorrect=1');
    expect(h.urls()[0]).toContain('api_key=testkey');

    const { getDb } = await import('@/lib/db');
    const row = getDb().prepare('SELECT url FROM http_cache LIMIT 1').get() as { url: string };
    expect(row.url).not.toContain('testkey');
    expect(row.url).toContain('method=track.getTopTags');
  });

  it('validates our own params locally', async () => {
    const h = installFetch([]);
    expect(await lastfm.getTopTags('', 'The Lovecats')).toMatchObject({
      ok: false,
      reason: 'invalid_request',
    });
    expect(h.calls).toHaveLength(0);
  });
});

describe('catalogueUrl', () => {
  it('builds the ToS-mandated catalogue link', () => {
    expect(lastfm.catalogueUrl('The Cure', 'The Lovecats')).toBe(
      'https://www.last.fm/music/The+Cure/_/The+Lovecats',
    );
  });
});
