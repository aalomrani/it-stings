import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixture, installFetch, resetHarness } from './harness';

const mocks = vi.hoisted(() => ({
  env: {
    spotifyClientId: undefined as string | undefined,
    spotifyClientSecret: undefined as string | undefined,
  },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env, keys: {} }));

const spotify = await import('@/lib/sources/spotify');

beforeEach(() => {
  resetHarness();
  spotify.resetToken();
  mocks.env.spotifyClientId = undefined;
  mocks.env.spotifyClientSecret = undefined;
});
afterEach(() => resetHarness());

describe('without credentials', () => {
  it('never calls api.spotify.com', async () => {
    const h = installFetch([]);
    expect(await spotify.searchTrack('The Cure', 'The Lovecats')).toEqual({
      ok: false,
      reason: 'no_api_key',
      detail: 'Spotify credentials not set',
    });
    expect(h.calls).toHaveLength(0);
    expect(spotify.describe()).toEqual({ name: 'spotify', needsKey: true, configured: false });
  });

  it('still produces the keyless deep link and embed URL', () => {
    expect(spotify.searchDeepLink('The Cure', 'The Lovecats')).toBe(
      'https://open.spotify.com/search/The%20Cure%20The%20Lovecats',
    );
    expect(spotify.embedUrl('6q2T5xXao6mTS6LLE88L84')).toBe(
      'https://open.spotify.com/embed/track/6q2T5xXao6mTS6LLE88L84',
    );
  });
});

describe('with credentials', () => {
  beforeEach(() => {
    mocks.env.spotifyClientId = 'id';
    mocks.env.spotifyClientSecret = 'secret';
  });

  it('mints a token once and reuses it for the search', async () => {
    const h = installFetch([
      { when: 'accounts.spotify.com', body: { access_token: 'tok', expires_in: 3600 } },
      {
        when: 'api.spotify.com',
        body: {
          tracks: {
            items: [
              {
                id: '6q2T5xXao6mTS6LLE88L84',
                name: 'The Lovecats',
                duration_ms: 220093,
                artists: [{ name: 'The Cure' }],
                external_urls: { spotify: 'https://open.spotify.com/track/6q2T5xXao6mTS6LLE88L84' },
              },
            ],
          },
        },
      },
    ]);

    const res = await spotify.searchTrack('The Cure', 'The Lovecats', { durationMs: 220093 });
    expect(res.ok && res.value).toEqual({
      id: '6q2T5xXao6mTS6LLE88L84',
      url: 'https://open.spotify.com/track/6q2T5xXao6mTS6LLE88L84',
    });

    const search = h.calls.find((c) => c.url.includes('api.spotify.com'));
    expect(search?.headers.Authorization).toBe('Bearer tok');
    // Development mode caps `limit` at 10.
    expect(search?.url).toContain('limit=10');

    await spotify.searchTrack('The Cure', 'The Lovecats', { durationMs: 220093 });
    expect(h.calls.filter((c) => c.url.includes('accounts.spotify.com'))).toHaveLength(1);
  });

  it('rejects a hit by a different artist', async () => {
    installFetch([
      { when: 'accounts.spotify.com', body: { access_token: 'tok', expires_in: 3600 } },
      {
        when: 'api.spotify.com',
        body: { tracks: { items: [{ id: 'x', name: 'The Lovecats', artists: [{ name: 'Twinkle Twinkle Little Rock Star' }] }] } },
      },
    ]);
    expect(await spotify.searchTrack('The Cure', 'The Lovecats')).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('maps the recorded invalid_client body to invalid_api_key', async () => {
    installFetch([{ when: 'accounts.spotify.com', status: 400, body: fixture('spotify-token-400') }]);
    expect(await spotify.searchTrack('The Cure', 'The Lovecats')).toMatchObject({
      ok: false,
      reason: 'invalid_api_key',
    });
  });
});

describe('oembed', () => {
  it('parses the recorded body', async () => {
    installFetch([{ when: 'open.spotify.com/oembed', body: fixture('spotify-oembed-lovecats') }]);
    const res = await spotify.oembed('https://open.spotify.com/track/6q2T5xXao6mTS6LLE88L84');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.title).toBe('The Lovecats');
    expect(res.value.iframeUrl).toContain('/embed/track/6q2T5xXao6mTS6LLE88L84');
  });

  it('treats a 404 as an invalid id (the embed page would answer 200)', async () => {
    installFetch([{ when: 'oembed', status: 404, body: '' }]);
    // A well-formed id that Spotify does not know: only oEmbed can tell us that.
    expect(await spotify.oembed('https://open.spotify.com/track/0000000000000000000000')).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('rejects a malformed id locally, spending no request (oEmbed answers 504 to those)', async () => {
    const h = installFetch([]);
    expect(await spotify.oembed('https://open.spotify.com/track/nope')).toMatchObject({
      ok: false,
      reason: 'invalid_request',
    });
    expect(h.calls).toHaveLength(0);
    expect(spotify.isValidId('6q2T5xXao6mTS6LLE88L84')).toBe(true);
    expect(spotify.isValidId('nope')).toBe(false);
    expect(spotify.embedUrl('nope')).toBeNull();
    expect(spotify.embedUrl('6q2T5xXao6mTS6LLE88L84')).toBe(
      'https://open.spotify.com/embed/track/6q2T5xXao6mTS6LLE88L84',
    );
  });

  it('refuses a non-Spotify URL without a request', async () => {
    const h = installFetch([]);
    expect(await spotify.oembed('https://example.com/x')).toMatchObject({
      ok: false,
      reason: 'invalid_request',
    });
    expect(h.calls).toHaveLength(0);
  });
});
