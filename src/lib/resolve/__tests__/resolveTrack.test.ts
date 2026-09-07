import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixture, installFetch, resetHarness } from '@/lib/sources/__tests__/harness';

/** No keys at all — the environment this app has to work in by default. */
const mocks = vi.hoisted(() => ({
  env: {
    lastfmApiKey: undefined as string | undefined,
    tavilyApiKey: undefined,
    braveApiKey: undefined,
    spotifyClientId: undefined as string | undefined,
    spotifyClientSecret: undefined as string | undefined,
    getsongbpmApiKey: undefined as string | undefined,
    keys: { websearch: null },
  },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env, keys: mocks.env.keys }));

const { resolveTrack } = await import('@/lib/resolve/resolveTrack');
const tracksRepo = await import('@/lib/db/repos/tracks');

const LOVECATS_ROUTES = [
  { when: 'itunes.apple.com/lookup', body: fixture('itunes-lookup-1288102536') },
  { when: 'itunes.apple.com/search', body: fixture('itunes-search-lovecats') },
  { when: 'api.deezer.com/search', body: fixture('deezer-search-lovecats-advanced') },
  { when: 'api.deezer.com/track/', body: fixture('deezer-track-1143631') },
  { when: 'musicbrainz.org/ws/2/isrc/', body: fixture('mb-isrc-GBALB8300001') },
  { when: 'acousticbrainz.org', body: fixture('ab-low-level-1c19fbb9'), status: 200 },
];

/** AcousticBrainz is two endpoints; route them apart. */
const AB_ROUTES = [
  { when: '/low-level', body: fixture('ab-low-level-1c19fbb9') },
  { when: '/high-level', body: fixture('ab-high-level-1c19fbb9') },
];

const lovecats = () => [...LOVECATS_ROUTES.slice(0, 5), ...AB_ROUTES];

beforeEach(() => {
  resetHarness();
  mocks.env.lastfmApiKey = undefined;
  mocks.env.spotifyClientId = undefined;
  mocks.env.spotifyClientSecret = undefined;
  mocks.env.getsongbpmApiKey = undefined;
});
afterEach(() => resetHarness());

describe('resolveTrack — the full keyless join', () => {
  it('assembles a TrackRecord with provenance on every number', async () => {
    installFetch(lovecats());

    const res = await resolveTrack({
      itunesId: 1288102536,
      artist: 'The Cure',
      title: 'The Lovecats',
      durationMs: 220093,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = res.track;

    expect(t.key).toBe('isrc:GBALB8300001');
    expect(t.isrc).toBe('GBALB8300001');
    expect(t.title).toBe('The Lovecats');
    expect(t.artist).toBe('The Cure');
    expect(t.album).toBe('Greatest Hits');

    // Tempo: Deezer first, and the source says so.
    expect(t.tempoBpm).toEqual({
      value: 91.9,
      source: { source: 'deezer', id: '1143631', field: 'bpm' },
    });

    // Year: MusicBrainz first-release-date, not the iTunes compilation date.
    expect(t.year).toEqual({
      value: 1983,
      source: {
        source: 'musicbrainz',
        id: '1c19fbb9-edce-49e1-a934-de6071dd7964',
        field: 'first-release-date',
      },
    });

    expect(t.keySignature).toEqual({
      value: 'F major',
      source: {
        source: 'acousticbrainz',
        id: '1c19fbb9-edce-49e1-a934-de6071dd7964',
        field: 'tonal.key_key+key_scale',
      },
    });

    expect(t.durationMs).toEqual({
      value: 220093,
      source: { source: 'itunes', id: '1288102536', field: 'trackTimeMillis' },
    });

    expect(t.ids).toEqual({
      itunes: 1288102536,
      deezer: 1143631,
      mbid: '1c19fbb9-edce-49e1-a934-de6071dd7964',
    });
    expect(t.links.musicbrainz).toContain('1c19fbb9');
    expect(t.links.lastfm).toBe('https://www.last.fm/music/The+Cure/_/The+Lovecats');
    // No credentials: the Spotify link is the keyless search deep link.
    expect(t.links.spotify).toBe('https://open.spotify.com/search/The%20Cure%20The%20Lovecats');

    expect(t.artwork?.small).toContain('200x200bb');
    expect(t.artwork?.large).toContain('600x600bb');
    expect(t.features?.source.source).toBe('acousticbrainz');
    expect(t.features?.genreLabels).toContain('jazz');

    // Without a Last.fm key the crowd tags come from MusicBrainz, and say so.
    expect(t.tags?.source.source).toBe('musicbrainz');
    expect(t.tags?.value.map((x) => x.name)).toContain('new wave');

    // The preview is a freshly minted Deezer URL with an expiry.
    expect(t.preview?.source.source).toBe('deezer');
    expect(t.preview?.url).toContain('dzcdn.net');
    expect(t.preview?.expiresAt).toBeGreaterThan(Date.now());

    // Steps 4-7 run concurrently, so the order of `degraded` follows completion order.
    expect([...t.degraded].sort()).toEqual([
      'Last.fm skipped: no LASTFM_API_KEY (the fingerprint loses crowd tags)',
      'Spotify skipped: no client credentials — linking to a search deep link',
    ]);
  });

  it('NEVER persists the Deezer preview URL', async () => {
    installFetch(lovecats());
    await resolveTrack({ itunesId: 1288102536, artist: 'The Cure', title: 'The Lovecats' });

    const stored = tracksRepo.get('isrc:GBALB8300001');
    expect(stored).not.toBeNull();
    // iTunes previews are unsigned and stable, so THAT one is persisted.
    expect(stored?.preview?.source.source).toBe('itunes');
    expect(JSON.stringify(stored)).not.toContain('dzcdn.net');
  });

  it('records MusicBrainz and AcousticBrainz failures in degraded and carries on', async () => {
    installFetch([
      { when: 'itunes.apple.com/lookup', body: fixture('itunes-lookup-1288102536') },
      { when: 'api.deezer.com/search', body: fixture('deezer-search-lovecats-advanced') },
      { when: 'api.deezer.com/track/', body: fixture('deezer-track-1143631') },
      { when: 'musicbrainz.org/ws/2/isrc/', status: 404, body: fixture('mb-isrc-not-found') },
      { when: 'musicbrainz.org/ws/2/recording', body: { recordings: [] } },
    ]);

    const res = await resolveTrack({
      itunesId: 1288102536,
      artist: 'The Cure',
      title: 'The Lovecats',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.track.ids.mbid).toBeUndefined();
    expect(res.track.features).toBeNull();
    // Tempo survives — it came from Deezer.
    expect(res.track.tempoBpm?.value).toBe(91.9);
    // Year falls back to the iTunes EDITION date, stamped as one (architecture.md step 7:
    // "with `source.field` saying `edition date — may be a reissue` in that last case").
    expect(res.track.year).toEqual({
      value: 1983,
      source: { source: 'itunes', id: '1288102536', field: 'edition date — may be a reissue' },
    });
    expect(res.track.degraded.some((d) => d.startsWith('MusicBrainz: ISRC'))).toBe(true);
    expect(res.track.degraded.some((d) => d.startsWith('MusicBrainz: no recording'))).toBe(true);
  });

  it('leaves the tempo unknown rather than inventing one (vampire, 2023)', async () => {
    installFetch([
      { when: 'itunes.apple.com', body: fixture('itunes-search-vampire') },
      { when: 'api.deezer.com/search', body: fixture('deezer-search-vampire-plain') },
      { when: 'api.deezer.com/track/', body: fixture('deezer-track-2440763155') },
      { when: 'musicbrainz.org/ws/2/isrc/', status: 404, body: fixture('mb-isrc-not-found') },
      { when: 'musicbrainz.org/ws/2/recording', body: { recordings: [] } },
    ]);

    const res = await resolveTrack({ artist: 'Olivia Rodrigo', title: 'vampire' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.track.key).toBe('isrc:USUG12304091');
    expect(res.track.tempoBpm).toBeNull();
    expect(res.track.keySignature).toBeNull();
    expect(res.track.degraded).toContain(
      'tempo unknown: Deezer reports 0 and no fallback source had it',
    );
  });

  it('serves a fresh cache hit without touching MusicBrainz again', async () => {
    const h = installFetch(lovecats());
    await resolveTrack({ itunesId: 1288102536, artist: 'The Cure', title: 'The Lovecats' });
    const mbCalls = h.urls().filter((u) => u.includes('musicbrainz')).length;
    expect(mbCalls).toBe(1);

    const again = await resolveTrack({
      itunesId: 1288102536,
      artist: 'The Cure',
      title: 'The Lovecats',
    });
    expect(again.ok && again.cached).toBe(true);
    expect(h.urls().filter((u) => u.includes('musicbrainz')).length).toBe(1);
  });

  it('fails cleanly when neither source knows the song', async () => {
    installFetch([
      { when: 'itunes.apple.com', body: { resultCount: 0, results: [] } },
      { when: 'api.deezer.com/search', body: { data: [], total: 0 } },
    ]);
    const res = await resolveTrack({ artist: 'The Cure', title: 'Purple Marmalade Sunrise' });
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });
});

describe('resolveTrack — with keys', () => {
  it('prefers Last.fm tags and a real Spotify id when both are configured', async () => {
    mocks.env.lastfmApiKey = 'lfm';
    mocks.env.spotifyClientId = 'id';
    mocks.env.spotifyClientSecret = 'secret';

    installFetch([
      ...lovecats(),
      {
        when: 'audioscrobbler',
        body: { toptags: { tag: [{ name: 'post-punk', count: '100' }] } },
      },
      { when: 'accounts.spotify.com', body: { access_token: 'tok', expires_in: 3600 } },
      {
        when: 'api.spotify.com',
        body: {
          tracks: {
            items: [
              {
                id: '6q2T5xXao6mTS6LLE88L84',
                name: 'The Lovecats',
                artists: [{ name: 'The Cure' }],
                external_urls: { spotify: 'https://open.spotify.com/track/6q2T5xXao6mTS6LLE88L84' },
              },
            ],
          },
        },
      },
    ]);

    const res = await resolveTrack({
      itunesId: 1288102536,
      artist: 'The Cure',
      title: 'The Lovecats',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.track.tags).toEqual({
      value: [{ name: 'post-punk', count: 100 }],
      source: { source: 'lastfm', field: 'track.getTopTags' },
    });
    expect(res.track.ids.spotify).toBe('6q2T5xXao6mTS6LLE88L84');
    expect(res.track.links.spotify).toBe('https://open.spotify.com/track/6q2T5xXao6mTS6LLE88L84');
    expect(res.track.degraded).toEqual([]);
  });

  it('uses GetSongBPM when Deezer reports bpm 0', async () => {
    mocks.env.getsongbpmApiKey = 'gsb';
    installFetch([
      { when: 'itunes.apple.com', body: fixture('itunes-search-vampire') },
      { when: 'api.deezer.com/search', body: fixture('deezer-search-vampire-plain') },
      { when: 'api.deezer.com/track/', body: fixture('deezer-track-2440763155') },
      { when: 'musicbrainz.org', status: 404, body: fixture('mb-isrc-not-found') },
      {
        when: 'api.getsong.co',
        body: {
          search: [
            { id: 'x', title: 'vampire', tempo: '138', key_of: 'F', time_sig: '4/4', uri: 'https://getsongbpm.com/song/vampire/x', artist: { name: 'Olivia Rodrigo' } },
          ],
        },
      },
    ]);

    const res = await resolveTrack({ artist: 'Olivia Rodrigo', title: 'vampire' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.track.tempoBpm).toEqual({
      value: 138,
      source: { source: 'getsongbpm', field: 'tempo', url: 'https://getsongbpm.com/song/vampire/x' },
    });
  });
});
