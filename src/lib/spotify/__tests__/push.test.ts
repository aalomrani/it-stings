/**
 * `POST /api/playlists/[id]/push`, through the real handler and a fake transport.
 *
 * The two behaviours worth a test are the two that only show up at scale or on a bad day:
 * chunking (Spotify takes at most 100 items per request, so a 250-track playlist must be
 * three requests to `/items` and not one 400), and the skip report (a track this app cannot
 * match STRICTLY must come back named, with a reason, rather than being pushed as a guess
 * or silently dropped).
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

const push = await import('@/app/api/playlists/[id]/push/route');
const authRepo = await import('@/lib/db/repos/spotifyAuth');
const playlistsRepo = await import('@/lib/db/repos/playlists');
const tracksRepo = await import('@/lib/db/repos/tracks');
const { getDb } = await import('@/lib/db');
const { installFetch, resetHarness } = await import('@/lib/sources/__tests__/harness');

type TrackRecord = import('@/lib/types').TrackRecord;

const SPOTIFY_ID = 'aaaaaaaaaaaaaaaaaaaaaa';

function track(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    key: 'isrc:GBAAM8300010',
    isrc: 'GBAAM8300010',
    title: 'The Lovecats',
    artist: 'The Cure',
    album: 'Japanese Whispers',
    year: null,
    durationMs: { value: 217000, source: { source: 'itunes', field: 'trackTimeMillis' } },
    artwork: null,
    preview: null,
    tempoBpm: null,
    keySignature: null,
    links: {},
    ids: {},
    tags: null,
    features: null,
    resolvedAt: 1_757_000_000_000,
    degraded: [],
    ...overrides,
  };
}

/** A playlist holding `tracks`, in order. Returns its id. */
function playlistOf(name: string, records: TrackRecord[]): string {
  const playlist = playlistsRepo.create(name);
  for (const record of records) {
    tracksRepo.upsert(record);
    playlistsRepo.addItem(playlist.id, { trackKey: record.key });
  }
  return playlist.id;
}

const call = (id: string) =>
  push.POST(new Request(`http://127.0.0.1:3151/api/playlists/${id}/push`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });

function connect() {
  authRepo.save({
    accessToken: 'user-access',
    refreshToken: 'user-refresh',
    expiresAt: Date.now() + 3_600_000,
    scope: 'playlist-modify-private',
    displayName: 'Alice',
  });
}

const CREATE_ROUTE = {
  when: '/v1/me/playlists',
  status: 201,
  body: {
    id: 'new-playlist',
    external_urls: { spotify: 'https://open.spotify.com/playlist/new-playlist' },
  },
};
const ADD_ROUTE = { when: '/items', status: 201, body: { snapshot_id: 'snap' } };

/**
 * `playlist_items.track_key` has a real foreign key into `tracks`, and `resetHarness`
 * empties `tracks` — so the playlist rows have to go FIRST or the cleanup itself trips the
 * constraint.
 */
function wipe(): void {
  getDb().exec('DELETE FROM playlist_items; DELETE FROM playlists; DELETE FROM spotify_auth;');
  resetHarness();
}

beforeEach(() => {
  mocks.env.spotifyClientId = 'fake-client-id';
  wipe();
});

afterEach(wipe);

describe('POST /api/playlists/[id]/push — the gates', () => {
  it('404s for a playlist that does not exist', async () => {
    const res = await call('pl_nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'playlist not found' });
  });

  it('refuses with an instruction, and no request, when SPOTIFY_CLIENT_ID is unset', async () => {
    mocks.env.spotifyClientId = undefined;
    const id = playlistOf('stung', [track({ ids: { spotify: SPOTIFY_ID } })]);
    const h = installFetch([]);

    const res = await call(id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('SPOTIFY_CLIENT_ID'),
      configured: false,
    });
    expect(h.calls).toHaveLength(0);
  });

  it('401s with a readable sentence when nobody is connected', async () => {
    const id = playlistOf('stung', [track({ ids: { spotify: SPOTIFY_ID } })]);
    const h = installFetch([]);

    const res = await call(id);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: 'no Spotify account is connected — connect one first.',
      loggedIn: false,
    });
    expect(h.calls).toHaveLength(0);
  });
});

describe('POST /api/playlists/[id]/push — matching', () => {
  it('uses a resolved ids.spotify without spending a search', async () => {
    connect();
    const id = playlistOf('stung in 1983', [track({ ids: { spotify: SPOTIFY_ID } })]);
    const h = installFetch([CREATE_ROUTE, ADD_ROUTE]);

    const res = await call(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      url: 'https://open.spotify.com/playlist/new-playlist',
      added: 1,
      skipped: [],
    });

    expect(h.urls().some((u) => u.includes('/v1/search'))).toBe(false);
    expect(JSON.parse(h.calls[1].body ?? '{}')).toEqual({ uris: [`spotify:track:${SPOTIFY_ID}`] });
  });

  it('searches for a track with no id, at limit 10, and adds a strict match', async () => {
    connect();
    const id = playlistOf('stung', [track()]);
    const h = installFetch([
      {
        when: '/v1/search',
        body: {
          tracks: {
            items: [
              {
                id: SPOTIFY_ID,
                uri: `spotify:track:${SPOTIFY_ID}`,
                name: 'The Lovecats',
                duration_ms: 217_000,
                artists: [{ name: 'The Cure' }],
              },
            ],
          },
        },
      },
      CREATE_ROUTE,
      ADD_ROUTE,
    ]);

    expect(await (await call(id)).json()).toMatchObject({ added: 1, skipped: [] });
    expect(h.urls()[0]).toContain('limit=10');
  });

  it('skips and REPORTS a track it cannot match strictly', async () => {
    connect();
    const id = playlistOf('stung', [
      track({ ids: { spotify: SPOTIFY_ID } }),
      track({
        key: 'isrc:XXNOMATCH001',
        isrc: 'XXNOMATCH001',
        artist: 'Squirrel Nut Zippers',
        title: 'Hell',
        durationMs: null,
      }),
    ]);
    installFetch([
      // A plausible answer by the wrong artist: exactly the case that must NOT be pushed.
      {
        when: '/v1/search',
        body: {
          tracks: {
            items: [
              { id: 'bbbbbbbbbbbbbbbbbbbbbb', name: 'Hell', artists: [{ name: 'Disclosure' }] },
            ],
          },
        },
      },
      CREATE_ROUTE,
      ADD_ROUTE,
    ]);

    const body = (await (await call(id)).json()) as {
      added: number;
      skipped: { artist: string; title: string; reason: string }[];
    };
    expect(body.added).toBe(1);
    expect(body.skipped).toEqual([
      {
        artist: 'Squirrel Nut Zippers',
        title: 'Hell',
        reason: 'no strict artist + title match on Spotify',
      },
    ]);
  });

  it('creates NO playlist when nothing could be matched', async () => {
    connect();
    const id = playlistOf('stung', [track({ durationMs: null })]);
    const h = installFetch([{ when: '/v1/search', body: { tracks: { items: [] } } }]);

    const body = (await (await call(id)).json()) as { url: null; added: number; message: string };
    expect(body).toMatchObject({ url: null, added: 0 });
    expect(body.message).toMatch(/no playlist was created/);
    expect(h.urls().some((u) => u.includes('/me/playlists'))).toBe(false);
  });

  it('says so, rather than creating an empty playlist, when the playlist is empty', async () => {
    connect();
    const id = playlistOf('nothing in here yet', []);
    const h = installFetch([]);

    const body = (await (await call(id)).json()) as { url: null; added: number; message: string };
    expect(body).toMatchObject({ url: null, added: 0, skipped: [] });
    expect(body.message).toMatch(/nothing to push/);
    expect(h.calls).toHaveLength(0);
  });
});

describe('POST /api/playlists/[id]/push — chunking', () => {
  /** 250 tracks, each with a resolved Spotify id, so nothing is searched. */
  function bigPlaylist(n: number): string {
    const records = Array.from({ length: n }, (_, i) =>
      track({
        key: `isrc:GB${String(i).padStart(10, '0')}`,
        isrc: `GB${String(i).padStart(10, '0')}`,
        title: `Track ${i}`,
        ids: { spotify: `t${String(i).padStart(21, '0')}` },
      }),
    );
    return playlistOf('a very long one', records);
  }

  it('adds 250 items as 100 + 100 + 50, in order, to /items', async () => {
    connect();
    const id = bigPlaylist(250);
    const h = installFetch([CREATE_ROUTE, ADD_ROUTE]);

    expect(await (await call(id)).json()).toMatchObject({ added: 250, skipped: [] });

    const addCalls = h.calls.filter((c) => c.url.endsWith('/items'));
    expect(addCalls).toHaveLength(3);
    const batches = addCalls.map((c) => (JSON.parse(c.body ?? '{}') as { uris: string[] }).uris);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(batches.flat()[0]).toBe('spotify:track:t000000000000000000000');
    expect(batches.flat()).toHaveLength(250);
    // The playlist is created exactly once, before any add.
    expect(h.urls().filter((u) => u.endsWith('/me/playlists'))).toHaveLength(1);
    expect(h.urls()[0]).toContain('/me/playlists');
  });

  it('reports the tracks in a failed chunk as skipped, and keeps the ones already added', async () => {
    connect();
    const id = bigPlaylist(150);
    const h = installFetch([
      CREATE_ROUTE,
      { when: '/items', status: 201, body: { snapshot_id: 'snap' }, once: true },
      { when: '/items', status: 403, body: { error: { status: 403 } } },
    ]);

    const body = (await (await call(id)).json()) as {
      added: number;
      skipped: { title: string; reason: string }[];
    };
    // The first 100 really are in the playlist; the rest are named, not silently lost.
    expect(body.added).toBe(100);
    expect(body.skipped).toHaveLength(50);
    expect(body.skipped[0].title).toBe('Track 100');
    expect(body.skipped[0].reason).toMatch(/could not be added: .*Development Mode/);
    // It stops after the first failure instead of hammering a 403.
    expect(h.calls.filter((c) => c.url.endsWith('/items'))).toHaveLength(2);
  });
});

describe('POST /api/playlists/[id]/push — the write itself', () => {
  it('creates a PRIVATE playlist named after ours, described "from It Stings"', async () => {
    connect();
    const id = playlistOf('stung in 1983', [track({ ids: { spotify: SPOTIFY_ID } })]);
    const h = installFetch([CREATE_ROUTE, ADD_ROUTE]);

    await call(id);
    expect(JSON.parse(h.calls[0].body ?? '{}')).toEqual({
      name: 'stung in 1983',
      public: false,
      description: 'from It Stings',
    });
    expect(h.calls[0].headers.Authorization).toBe('Bearer user-access');
  });

  it('refreshes an expired token before writing anything', async () => {
    authRepo.save({
      accessToken: 'stale-access',
      refreshToken: 'user-refresh',
      expiresAt: Date.now() - 1000,
      scope: 'playlist-modify-private',
    });
    const id = playlistOf('stung', [track({ ids: { spotify: SPOTIFY_ID } })]);
    const h = installFetch([
      { when: '/api/token', body: { access_token: 'renewed', expires_in: 3600 } },
      CREATE_ROUTE,
      ADD_ROUTE,
    ]);

    expect(await (await call(id)).json()).toMatchObject({ added: 1 });
    expect(h.urls()[0]).toContain('accounts.spotify.com/api/token');
    expect(h.calls[1].headers.Authorization).toBe('Bearer renewed');
    expect(authRepo.get()?.refreshToken).toBe('user-refresh');
  });

  it('502s with a sentence when the playlist could not be created', async () => {
    connect();
    const id = playlistOf('stung', [track({ ids: { spotify: SPOTIFY_ID } })]);
    installFetch([{ when: '/v1/me/playlists', status: 403, body: { error: { status: 403 } } }]);

    const res = await call(id);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Development Mode') });
  });

  it('names an item whose track row has gone from the cache instead of dropping it', async () => {
    connect();
    const record = track({ ids: { spotify: SPOTIFY_ID } });
    const id = playlistOf('stung', [record]);
    // The state `itemsWithTracks` already guards against: an item pointing at a `tracks`
    // row that is gone. The foreign key is off for exactly one statement to stage it.
    const db = getDb();
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM tracks WHERE key = ?').run(record.key);
    db.pragma('foreign_keys = ON');
    installFetch([]);

    const body = (await (await call(id)).json()) as {
      added: number;
      skipped: { reason: string }[];
    };
    expect(body.added).toBe(0);
    expect(body.skipped[0].reason).toMatch(/no longer in the local cache/);
  });

  it('writes nothing to http_cache — a cached POST would be a duplicate write', async () => {
    connect();
    const id = playlistOf('stung', [track({ ids: { spotify: SPOTIFY_ID } })]);
    installFetch([CREATE_ROUTE, ADD_ROUTE]);
    await call(id);
    expect(
      (getDb().prepare('SELECT COUNT(*) AS n FROM http_cache').get() as { n: number }).n,
    ).toBe(0);
  });
});
