/**
 * The three routes this task owns, exercised through their real handlers.
 *
 * (They live here rather than under `src/app/` because `src/lib/resolve/__tests__` is
 * this task's own directory and vitest collects `src/**\/__tests__\/**\/*.test.ts`.)
 */

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

const search = await import('@/app/api/search/route');
const resolve = await import('@/app/api/resolve/route');
const preview = await import('@/app/api/preview/route');
const tracksRepo = await import('@/lib/db/repos/tracks');

const lovecatsRoutes = () => [
  { when: 'itunes.apple.com/lookup', body: fixture('itunes-lookup-1288102536') },
  { when: 'itunes.apple.com/search', body: fixture('itunes-search-lovecats') },
  { when: 'api.deezer.com/search', body: fixture('deezer-search-lovecats-advanced') },
  { when: 'api.deezer.com/track/', body: fixture('deezer-track-1143631') },
  { when: 'musicbrainz.org/ws/2/isrc/', body: fixture('mb-isrc-GBALB8300001') },
  { when: '/low-level', body: fixture('ab-low-level-1c19fbb9') },
  { when: '/high-level', body: fixture('ab-high-level-1c19fbb9') },
];

const get = (url: string) => new Request(url);
const post = (body: unknown) =>
  new Request('http://localhost/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => resetHarness());
afterEach(() => resetHarness());

describe('GET /api/search', () => {
  it('returns at most 8 hits with no-store', async () => {
    installFetch([{ when: 'itunes.apple.com', body: fixture('itunes-search-lovecats') }]);
    const res = await search.GET(get('http://localhost/api/search?q=the%20cure%20lovecats'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const body = (await res.json()) as { hits: { itunesId: number }[] };
    expect(body.hits.length).toBeLessThanOrEqual(8);
    expect(body.hits[0].itunesId).toBe(1288102536);
  });

  it('short-circuits a one-character query WITHOUT calling iTunes', async () => {
    const h = installFetch([]);
    for (const q of ['', 'a', '   ']) {
      const res = await search.GET(get(`http://localhost/api/search?q=${encodeURIComponent(q)}`));
      expect(await res.json()).toEqual({ hits: [] });
    }
    const res = await search.GET(get('http://localhost/api/search'));
    expect(await res.json()).toEqual({ hits: [] });
    expect(h.calls).toHaveLength(0);
  });

  it('rejects an oversized term at the edge, spending no iTunes budget', async () => {
    // Measured: a 5 000-character q was forwarded AND retried — three of the twenty
    // requests per minute, and 4.5 s, to answer 502.
    const h = installFetch([]);
    const res = await search.GET(get(`http://localhost/api/search?q=${'a'.repeat(5000)}`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ hits: [], error: 'invalid_request' });
    expect(h.calls).toHaveLength(0);
  });

  it('answers JSON, not an HTML error page, when iTunes fails', async () => {
    installFetch([{ when: 'itunes.apple.com', status: 500, body: 'boom' }]);
    const res = await search.GET(get('http://localhost/api/search?q=lovecats'));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ hits: [], error: 'upstream_error' });
  }, 10_000);
});

describe('POST /api/resolve', () => {
  it('returns the TrackRecord', async () => {
    installFetch(lovecatsRoutes());
    const res = await resolve.POST(
      post({ itunesId: 1288102536, artist: 'The Cure', title: 'The Lovecats', durationMs: 220093 }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const body = (await res.json()) as { track: { key: string; preview: { url: string } } };
    expect(body.track.key).toBe('isrc:GBALB8300001');
    expect(body.track.preview.url).toContain('dzcdn.net');
  });

  it('strips unknown keys instead of rejecting the UI\'s typeahead hit', async () => {
    installFetch(lovecatsRoutes());
    const res = await resolve.POST(
      post({
        itunesId: 1288102536,
        artist: 'The Cure',
        title: 'The Lovecats',
        artworkLarge: 'https://example.com/x.jpg',
        country: 'US',
      }),
    );
    expect(res.status).toBe(200);
  });

  it('rejects a bad body and a non-JSON body with 400 JSON', async () => {
    installFetch([]);
    const bad = await resolve.POST(post({ artist: '' }));
    expect(bad.status).toBe(400);
    expect((await bad.json()) as { error: string }).toMatchObject({ error: 'invalid body' });

    const notJson = await resolve.POST(post('<html>'));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: 'body must be JSON' });
  });

  it('answers 404 when the song does not exist', async () => {
    installFetch([
      { when: 'itunes.apple.com', body: { resultCount: 0, results: [] } },
      { when: 'api.deezer.com/search', body: { data: [], total: 0 } },
    ]);
    const res = await resolve.POST(post({ artist: 'The Cure', title: 'Purple Marmalade Sunrise' }));
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'not_found' });
  });
});

describe('GET /api/preview', () => {
  it('re-mints a Deezer preview for a stored key', async () => {
    installFetch(lovecatsRoutes());
    await resolve.POST(post({ itunesId: 1288102536, artist: 'The Cure', title: 'The Lovecats' }));

    const res = await preview.GET(get('http://localhost/api/preview?key=isrc:GBALB8300001'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { url: string; expiresAt: number };
    expect(body.url).toContain('dzcdn.net');
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('answers { url: null } for a track with no audio anywhere', async () => {
    installFetch([{ when: 'api.deezer.com/track/', body: fixture('deezer-track-not-found') }]);
    tracksRepo.upsert({
      key: 'deezer:1',
      isrc: null,
      title: 'Silent',
      artist: 'Nobody',
      album: null,
      year: null,
      durationMs: null,
      artwork: null,
      preview: null,
      tempoBpm: null,
      keySignature: null,
      links: {},
      ids: { deezer: 1 },
      tags: null,
      features: null,
      resolvedAt: Date.now(),
      degraded: [],
    });

    const res = await preview.GET(get('http://localhost/api/preview?key=deezer:1'));
    expect(await res.json()).toEqual({ url: null });
  });

  it('404s an unknown key and 400s a missing one', async () => {
    installFetch([]);
    expect((await preview.GET(get('http://localhost/api/preview?key=isrc:NOPE'))).status).toBe(404);
    expect((await preview.GET(get('http://localhost/api/preview'))).status).toBe(400);
  });
});
