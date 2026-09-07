/**
 * The user-token client, through the one seam (`setFetchImpl`) — no network, ever.
 *
 * The refresh path is the part with no user in front of it: it runs on the first push
 * after an hour, it runs on the server, and if it is wrong the symptom is a 401 the person
 * clicking cannot explain. So every branch of it is pinned here — the token that is still
 * good and costs no request, the refresh that returns a new refresh token, the refresh that
 * does NOT (Spotify's documented behaviour, "continue using the existing token"), and the
 * refusal that has to log the account out rather than keep claiming a connection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    spotifyClientId: 'fake-client-id' as string | undefined,
    spotifyClientSecret: undefined as string | undefined,
    spotifyRedirectUri: 'http://127.0.0.1:3151/api/spotify/callback',
  },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env, keys: {} }));

const spotify = await import('@/lib/spotify/client');
const authRepo = await import('@/lib/db/repos/spotifyAuth');
const { getDb } = await import('@/lib/db');
const { installFetch, resetHarness } = await import('@/lib/sources/__tests__/harness');

const HOUR = 3_600_000;

/** A stored login that expires `inMs` from now. */
function storeLogin(inMs: number, extra: Partial<Parameters<typeof authRepo.save>[0]> = {}) {
  return authRepo.save({
    accessToken: 'stored-access',
    refreshToken: 'stored-refresh',
    expiresAt: Date.now() + inMs,
    scope: 'playlist-modify-private',
    displayName: 'Test User',
    ...extra,
  });
}

/** The form body of the first recorded call, parsed. */
function formOf(body: string | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body ?? ''));
}

beforeEach(() => {
  mocks.env.spotifyClientId = 'fake-client-id';
  resetHarness();
  getDb().exec('DELETE FROM spotify_auth');
});

afterEach(() => {
  resetHarness();
  getDb().exec('DELETE FROM spotify_auth');
});

describe('configured', () => {
  it('needs only a client id — PKCE has no client secret', () => {
    expect(spotify.configured()).toBe(true);
    mocks.env.spotifyClientId = undefined;
    expect(spotify.configured()).toBe(false);
  });
});

describe('chunk', () => {
  it('splits 250 items into 100 / 100 / 50 — the documented Add Items maximum', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const chunks = spotify.chunk(items, spotify.MAX_ITEMS_PER_REQUEST);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(items);
    expect(spotify.MAX_ITEMS_PER_REQUEST).toBe(100);
  });

  it('handles the edges: empty, shorter than a chunk, and exactly one chunk', () => {
    expect(spotify.chunk([], 100)).toEqual([]);
    expect(spotify.chunk([1, 2], 100)).toEqual([[1, 2]]);
    expect(spotify.chunk(Array.from({ length: 100 }, (_, i) => i), 100)).toHaveLength(1);
    expect(() => spotify.chunk([1], 0)).toThrow(RangeError);
  });
});

describe('accessToken — the refresh path', () => {
  it('returns nothing and makes no request when SPOTIFY_CLIENT_ID is unset', async () => {
    mocks.env.spotifyClientId = undefined;
    const h = installFetch([]);
    const res = await spotify.accessToken();
    expect(res).toEqual({ ok: false, reason: 'not_configured', detail: expect.any(String) });
    expect(h.calls).toHaveLength(0);
  });

  it('returns not_logged_in with no request when nobody has connected', async () => {
    const h = installFetch([]);
    const res = await spotify.accessToken();
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ reason: 'not_logged_in' });
    expect(h.calls).toHaveLength(0);
  });

  it('uses a still-valid stored token without talking to Spotify at all', async () => {
    storeLogin(HOUR);
    const h = installFetch([]);
    const res = await spotify.accessToken();
    expect(res).toMatchObject({ ok: true, value: 'stored-access' });
    expect(h.calls).toHaveLength(0);
  });

  it('refreshes with client_id and NO client secret when the token is about to expire', async () => {
    storeLogin(30_000); // inside REFRESH_SKEW_MS
    const h = installFetch([
      {
        when: 'accounts.spotify.com/api/token',
        body: { access_token: 'fresh-access', expires_in: 3600, scope: 'playlist-modify-private' },
      },
    ]);

    const res = await spotify.accessToken();
    expect(res).toMatchObject({ ok: true, value: 'fresh-access' });

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].method).toBe('POST');
    const form = formOf(h.calls[0].body);
    expect(form).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'stored-refresh',
      client_id: 'fake-client-id',
    });
    expect(form.client_secret).toBeUndefined();
    expect(h.calls[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('KEEPS the stored refresh token when the refresh response omits one', async () => {
    storeLogin(0);
    installFetch([
      { when: '/api/token', body: { access_token: 'fresh-access', expires_in: 3600 } },
    ]);

    await spotify.accessToken();
    const row = authRepo.get();
    expect(row?.accessToken).toBe('fresh-access');
    expect(row?.refreshToken).toBe('stored-refresh');
    expect(row?.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    // The display name survives a refresh: it is not part of the token exchange.
    expect(row?.displayName).toBe('Test User');
  });

  it('stores a rotated refresh token when Spotify sends one', async () => {
    storeLogin(0);
    installFetch([
      {
        when: '/api/token',
        body: { access_token: 'fresh-access', refresh_token: 'rotated', expires_in: 3600 },
      },
    ]);

    await spotify.accessToken();
    expect(authRepo.get()?.refreshToken).toBe('rotated');
  });

  it('logs the account out when the refresh is refused, instead of claiming a connection', async () => {
    storeLogin(0);
    installFetch([
      {
        when: '/api/token',
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Refresh token revoked' },
      },
    ]);

    const res = await spotify.accessToken();
    expect(res).toMatchObject({ ok: false, reason: 'auth_expired' });
    expect(authRepo.get()).toBeNull();
  });

  it('keeps the login when the refresh merely could not be reached', async () => {
    storeLogin(0);
    installFetch([{ when: '/api/token', status: 503, body: '' }]);

    const res = await spotify.accessToken();
    expect(res).toMatchObject({ ok: false, reason: 'upstream_error' });
    // A flaky network is not a revoked grant: the row survives.
    expect(authRepo.get()?.refreshToken).toBe('stored-refresh');
  }, 20_000);

  it('never writes a token into http_cache', async () => {
    storeLogin(0);
    installFetch([{ when: '/api/token', body: { access_token: 'fresh-access', expires_in: 3600 } }]);
    await spotify.accessToken();
    const rows = getDb().prepare('SELECT COUNT(*) AS n FROM http_cache').get() as { n: number };
    expect(rows.n).toBe(0);
  });
});

describe('exchangeCode', () => {
  it('posts the PKCE authorization_code form, verifier included and no secret', async () => {
    const h = installFetch([
      {
        when: '/api/token',
        body: {
          access_token: 'a',
          refresh_token: 'r',
          expires_in: 3600,
          scope: 'playlist-modify-private',
        },
      },
    ]);

    const res = await spotify.exchangeCode({ code: 'the-code', verifier: 'the-verifier' });
    expect(res).toMatchObject({
      ok: true,
      value: { accessToken: 'a', refreshToken: 'r', scope: 'playlist-modify-private' },
    });

    const form = formOf(h.calls[0].body);
    expect(form).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://127.0.0.1:3151/api/spotify/callback',
      client_id: 'fake-client-id',
      code_verifier: 'the-verifier',
    });
  });

  it('reads a rejected exchange as auth_expired rather than a crash', async () => {
    installFetch([
      { when: '/api/token', status: 400, body: { error: 'invalid_grant' } },
    ]);
    const res = await spotify.exchangeCode({ code: 'x', verifier: 'y' });
    expect(res).toMatchObject({ ok: false, reason: 'auth_expired' });
  });
});

describe('searchTrack', () => {
  const hit = (name: string, artist: string, id = 'abcdefghijklmnopqrstuv') => ({
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: [{ name: artist }],
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  });

  it('asks for limit 10 — the Development Mode ceiling — and type=track', async () => {
    const h = installFetch([
      { when: 'api.spotify.com/v1/search', body: { tracks: { items: [hit('The Lovecats', 'The Cure')] } } },
    ]);

    const res = await spotify.searchTrack('token', 'The Cure', 'The Lovecats');
    expect(res).toMatchObject({ ok: true, value: { id: 'abcdefghijklmnopqrstuv' } });

    const url = h.urls()[0];
    expect(url).toContain('limit=10');
    expect(url).toContain('type=track');
    expect(url).toContain(encodeURIComponent('track:The Lovecats artist:The Cure'));
    expect(h.calls[0].headers.Authorization).toBe('Bearer token');
    expect(spotify.SEARCH_LIMIT).toBe(10);
  });

  it('skips a plausible-looking wrong answer rather than pushing it', async () => {
    installFetch([
      {
        when: '/v1/search',
        body: { tracks: { items: [hit('The Lovecats', 'A Tribute Band'), hit('Lovesong', 'The Cure')] } },
      },
    ]);
    const res = await spotify.searchTrack('token', 'The Cure', 'The Lovecats');
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('rejects a match whose duration is more than 8 s away', async () => {
    installFetch([
      {
        when: '/v1/search',
        body: {
          tracks: { items: [{ ...hit('The Lovecats', 'The Cure'), duration_ms: 400_000 }] },
        },
      },
    ]);
    const res = await spotify.searchTrack('token', 'The Cure', 'The Lovecats', {
      durationMs: 220_093,
    });
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('refuses an empty artist or title without spending a request', async () => {
    const h = installFetch([]);
    expect(await spotify.searchTrack('token', '  ', 'x')).toMatchObject({
      ok: false,
      reason: 'invalid_request',
    });
    expect(h.calls).toHaveLength(0);
  });
});

describe('createPlaylist', () => {
  it('posts a PRIVATE playlist to /v1/me/playlists with the It Stings description', async () => {
    const h = installFetch([
      {
        when: '/v1/me/playlists',
        status: 201,
        body: {
          id: 'new-playlist',
          external_urls: { spotify: 'https://open.spotify.com/playlist/new-playlist' },
        },
      },
    ]);

    const res = await spotify.createPlaylist('token', { name: 'stung in 1983' });
    expect(res).toMatchObject({
      ok: true,
      value: { id: 'new-playlist', url: 'https://open.spotify.com/playlist/new-playlist' },
    });

    expect(h.urls()[0]).toBe('https://api.spotify.com/v1/me/playlists');
    expect(JSON.parse(h.calls[0].body ?? '{}')).toEqual({
      name: 'stung in 1983',
      public: false,
      description: 'from It Stings',
    });
  });

  it('reads a 403 as the Development Mode allowlist refusal it usually is', async () => {
    installFetch([{ when: '/v1/me/playlists', status: 403, body: { error: { status: 403 } } }]);
    const res = await spotify.createPlaylist('token', { name: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'forbidden' });
    if (!res.ok) expect(spotify.explain(res.reason)).toMatch(/Development Mode/);
  });
});

describe('addItems', () => {
  it('posts URIs in the BODY of /v1/playlists/{id}/items — never /tracks', async () => {
    const h = installFetch([
      { when: '/items', status: 201, body: { snapshot_id: 'snap' } },
    ]);

    const res = await spotify.addItems('token', 'pl1', ['spotify:track:a', 'spotify:track:b']);
    expect(res).toMatchObject({ ok: true, value: { snapshotId: 'snap' } });

    expect(h.urls()[0]).toBe('https://api.spotify.com/v1/playlists/pl1/items');
    expect(h.urls()[0]).not.toContain('/tracks');
    expect(h.urls()[0]).not.toContain('uris=');
    expect(JSON.parse(h.calls[0].body ?? '{}')).toEqual({
      uris: ['spotify:track:a', 'spotify:track:b'],
    });
  });

  it('refuses more than 100 in one request, and refuses none', async () => {
    const h = installFetch([]);
    const many = Array.from({ length: 101 }, (_, i) => `spotify:track:${i}`);
    expect(await spotify.addItems('token', 'pl1', many)).toMatchObject({
      ok: false,
      reason: 'invalid_request',
    });
    expect(await spotify.addItems('token', 'pl1', [])).toMatchObject({
      ok: false,
      reason: 'invalid_request',
    });
    expect(h.calls).toHaveLength(0);
  });
});

describe('explain', () => {
  it('gives every failure a sentence, and none of them mentions a token value', () => {
    const reasons = [
      'not_configured',
      'not_logged_in',
      'auth_expired',
      'invalid_request',
      'not_found',
      'forbidden',
      'rate_limited',
      'upstream_error',
      'bad_response',
    ] as const;
    for (const reason of reasons) {
      const sentence = spotify.explain(reason);
      expect(sentence.length).toBeGreaterThan(10);
      expect(sentence).not.toMatch(/Bearer|access_token|refresh/i);
    }
  });
});

describe('hasPushScope', () => {
  it('accepts the granted scope, an omitted scope, and rejects a narrower grant', () => {
    expect(spotify.hasPushScope('playlist-modify-private')).toBe(true);
    expect(spotify.hasPushScope('user-read-private playlist-modify-private')).toBe(true);
    expect(spotify.hasPushScope(null)).toBe(true);
    expect(spotify.hasPushScope('user-read-private')).toBe(false);
  });
});
