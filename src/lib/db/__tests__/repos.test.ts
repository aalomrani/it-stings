import { beforeEach, describe, expect, it } from 'vitest';

import { getDb } from '@/lib/db';
import * as evidence from '@/lib/db/repos/evidence';
import * as fingerprints from '@/lib/db/repos/fingerprints';
import * as httpCache from '@/lib/db/repos/httpCache';
import * as mentions from '@/lib/db/repos/mentions';
import * as playlists from '@/lib/db/repos/playlists';
import * as runs from '@/lib/db/repos/runs';
import * as tracks from '@/lib/db/repos/tracks';
import * as verifications from '@/lib/db/repos/verifications';
import type { Fingerprint, Recommendation, RunRecord, TrackRecord } from '@/lib/types';
import { newRunId } from '@/lib/util/ids';

function track(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    key: 'isrc:GBAAM8300010',
    isrc: 'GBAAM8300010',
    title: 'The Lovecats',
    artist: 'The Cure',
    album: 'Japanese Whispers',
    year: { value: 1983, source: { source: 'musicbrainz', field: 'first-release-date' } },
    durationMs: { value: 217000, source: { source: 'itunes', field: 'trackTimeMillis' } },
    artwork: {
      small: 'https://example.test/200x200bb.jpg',
      large: 'https://example.test/600x600bb.jpg',
      source: { source: 'itunes' },
    },
    preview: null,
    tempoBpm: { value: 132, source: { source: 'deezer', id: '3135556', field: 'bpm' } },
    keySignature: { value: 'F# minor', source: { source: 'acousticbrainz' } },
    links: { deezer: 'https://www.deezer.com/track/3135556' },
    ids: { deezer: 3135556, itunes: 1234567 },
    tags: {
      value: [{ name: 'post-punk', count: 100 }],
      source: { source: 'lastfm', field: 'toptags' },
    },
    features: { source: { source: 'acousticbrainz' }, danceability: 0.7, genreLabels: ['jazz'] },
    resolvedAt: 1_757_000_000_000,
    degraded: [],
    ...overrides,
  };
}

function fingerprint(): Fingerprint {
  return {
    tempo_bpm: 132,
    tempo_feel: 'bouncing',
    rhythmic_character: 'swung shuffle, upright bass walking in quarters',
    instrumentation: ['upright bass', 'brushed kit'],
    vocal_delivery: 'playful, affected, breaks into scat',
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
    grounded_on: ['Deezer bpm 132', 'Last.fm tags: post-punk'],
    model: 'claude-opus-5',
  };
}

function recommendation(): Recommendation {
  return {
    track: track({ key: 'deezer:1', title: 'Zoot Suit Riot', artist: 'Cherry Poppin’ Daddies' }),
    channels: ['A', 'C'],
    evidence: [{ channel: 'A', kind: 'lastfm_similar', detail: 'Last.fm match 0.42' }],
    dimensions: [{ dimension: 'rhythmic_character', score: 0.9, note: 'same swung shuffle' }],
    modelScore: 0.8,
    finalScore: 0.92,
    why: 'the same swung upright-bass walk under a deliberately hammy vocal',
    sharedTraits: ['walking upright bass in quarters', 'hammy affected vocal'],
    sameArtist: false,
    flags: ['multi-channel'],
  };
}

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: newRunId(),
    seed: track(),
    options: { includeSameArtist: false },
    fingerprint: fingerprint(),
    results: [recommendation()],
    scoredPool: [recommendation()],
    degraded: ['Channel B skipped: no TAVILY_API_KEY'],
    stats: {
      perChannel: {
        A: { found: 50, verified: 40, dropped: 10 },
        B: { found: 0, verified: 0, dropped: 0, skipped: 'no key' },
        C: { found: 30, verified: 25, dropped: 5 },
      },
      durationMs: 12_345,
      modelCalls: 4,
    },
    engineVersion: 'test-1',
    createdAt: 1_757_000_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    `DELETE FROM playlist_items; DELETE FROM playlists; DELETE FROM runs;
     DELETE FROM verifications; DELETE FROM mentions; DELETE FROM evidence;
     DELETE FROM fingerprints; DELETE FROM http_cache; DELETE FROM tracks;`,
  );
});

describe('tracks repo', () => {
  it('round-trips a TrackRecord', () => {
    const t = track();
    tracks.upsert(t);
    expect(tracks.get(t.key)).toEqual(t);
    expect(tracks.count()).toBe(1);
  });

  it('upsert replaces rather than duplicates', () => {
    tracks.upsert(track());
    tracks.upsert(track({ title: 'The Lovecats (2006 Remaster)' }));
    expect(tracks.count()).toBe(1);
    expect(tracks.get('isrc:GBAAM8300010')?.title).toBe('The Lovecats (2006 Remaster)');
  });

  it('finds by normalised artist/title and by ISRC', () => {
    tracks.upsert(track());
    expect(tracks.findByNorm('the cure', 'the lovecats')?.key).toBe('isrc:GBAAM8300010');
    expect(tracks.findByNorm('Cure', 'The Lovecats - 2006 Remaster')?.key).toBe(
      'isrc:GBAAM8300010',
    );
    expect(tracks.findByNorm('The Cure', 'The Love Cats')).toBeNull();
    expect(tracks.findByIsrc('GBAAM8300010')?.title).toBe('The Lovecats');
  });

  it('getMany returns only the keys it knows', () => {
    tracks.upsert(track());
    tracks.upsert(track({ key: 'deezer:9', isrc: null }));
    expect(tracks.getMany(['deezer:9', 'isrc:GBAAM8300010', 'nope']).map((t) => t.key).sort()).toEqual(
      ['deezer:9', 'isrc:GBAAM8300010'],
    );
    expect(tracks.getMany([])).toEqual([]);
  });

  it('treats a row that no longer matches the schema as a miss', () => {
    tracks.upsert(track());
    getDb().prepare('UPDATE tracks SET json = ? WHERE key = ?').run('{"nope":1}', 'isrc:GBAAM8300010');
    expect(tracks.get('isrc:GBAAM8300010')).toBeNull();
  });
});

describe('httpCache repo', () => {
  const entry = {
    cacheKey: 'abc',
    url: 'https://api.deezer.com/track/1',
    status: 200,
    body: '{"id":1}',
    fetchedAt: 1000,
    expiresAt: 2000,
  };

  it('misses on an unknown key', () => {
    expect(httpCache.get('nothing-here')).toBeNull();
  });

  it('hits while fresh and misses once expired', () => {
    httpCache.set(entry);
    expect(httpCache.get('abc', 1500)).toEqual(entry);
    expect(httpCache.get('abc', 2000)).toBeNull();
    expect(httpCache.get('abc', 9999)).toBeNull();
  });

  it('set overwrites the same key', () => {
    httpCache.set(entry);
    httpCache.set({ ...entry, body: 'updated', expiresAt: 5000 });
    expect(httpCache.get('abc', 1500)?.body).toBe('updated');
    expect(httpCache.count()).toBe(1);
  });

  it('purgeExpired deletes only stale rows', () => {
    httpCache.set(entry);
    httpCache.set({ ...entry, cacheKey: 'fresh', expiresAt: 10_000 });
    expect(httpCache.purgeExpired(3000)).toBe(1);
    expect(httpCache.count()).toBe(1);
    expect(httpCache.get('fresh', 3000)).not.toBeNull();
  });
});

describe('fingerprints repo', () => {
  const key = { trackKey: 'isrc:GBAAM8300010', model: 'claude-opus-5', promptVersion: 'fp-v1' };

  it('round-trips a fingerprint', () => {
    fingerprints.set(key, fingerprint());
    expect(fingerprints.get(key)).toEqual(fingerprint());
  });

  it('is keyed by model and prompt version', () => {
    fingerprints.set(key, fingerprint());
    expect(fingerprints.get({ ...key, promptVersion: 'fp-v2' })).toBeNull();
    expect(fingerprints.get({ ...key, model: 'claude-sonnet-5' })).toBeNull();
  });

  it('set overwrites the same triple', () => {
    fingerprints.set(key, fingerprint());
    fingerprints.set(key, { ...fingerprint(), signature_hook: 'the whistle' });
    expect(fingerprints.get(key)?.signature_hook).toBe('the whistle');
  });
});

describe('evidence + mentions repos', () => {
  it('round-trips evidence rows by provider and query', () => {
    const id = evidence.insert({
      provider: 'tavily',
      query: 'songs like the lovecats',
      url: 'https://reddit.com/r/music/x',
      title: 'Songs like The Lovecats?',
      snippet: 'try Squirrel Nut Zippers',
      content: 'long body',
      fetchedAt: 1234,
    });
    expect(id).toBeGreaterThan(0);
    const found = evidence.find('tavily', 'songs like the lovecats');
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      id,
      provider: 'tavily',
      query: 'songs like the lovecats',
      url: 'https://reddit.com/r/music/x',
      title: 'Songs like The Lovecats?',
      snippet: 'try Squirrel Nut Zippers',
      content: 'long body',
      fetchedAt: 1234,
    });
    expect(evidence.find('tavily', 'another query')).toEqual([]);
    expect(evidence.get(id)?.url).toBe('https://reddit.com/r/music/x');
  });

  it('round-trips mentions attached to an evidence row', () => {
    const evidenceId = evidence.insert({
      provider: 'tavily',
      query: 'q',
      url: 'https://example.test/thread',
    });
    const written = mentions.insertMany([
      {
        evidenceId,
        seedKey: 'isrc:GBAAM8300010',
        artist: 'Squirrel Nut Zippers',
        title: 'Hell',
        url: 'https://example.test/thread',
        pageTitle: 'songs like the lovecats?',
        sentence: 'Hell by the Squirrel Nut Zippers scratches the same itch',
        enthusiasm: 'high',
        model: 'claude-opus-5',
        createdAt: 42,
      },
      {
        evidenceId,
        seedKey: 'isrc:GBAAM8300010',
        artist: 'Louis Prima',
        title: "Jump, Jive an' Wail",
        model: 'claude-opus-5',
        createdAt: 43,
      },
    ]);
    expect(written).toBe(2);
    const rows = mentions.findBySeed('isrc:GBAAM8300010');
    expect(rows.map((r) => r.artist)).toEqual(['Squirrel Nut Zippers', 'Louis Prima']);
    expect(rows[0].enthusiasm).toBe('high');
    expect(rows[1].enthusiasm).toBeNull();
    expect(rows[1].sentence).toBeNull();
    expect(rows[0].url).toBe('https://example.test/thread');
    expect(rows[0].pageTitle).toBe('songs like the lovecats?');
    expect(rows[1].url).toBeNull();
    expect(mentions.findBySeed('other')).toEqual([]);
    expect(mentions.insertMany([])).toBe(0);
  });

  /**
   * Migration 004: a provider whose terms forbid caching its results (Brave) writes no
   * `evidence` row at all, so the mention has to stand on its own URL. Before 004
   * `evidence_id` was NOT NULL and this insert was impossible.
   */
  it('round-trips a mention with no evidence row behind it', () => {
    mentions.insertMany([
      {
        evidenceId: null,
        seedKey: 'isrc:GBAAM8300011',
        artist: 'Cherry Poppin’ Daddies',
        title: 'Zoot Suit Riot',
        url: 'https://www.reddit.com/r/ifyoulikeblank/comments/aaa/lovecats',
        sentence: 'this one, same horn stabs',
        enthusiasm: 'medium',
        model: 'claude-opus-5',
      },
    ]);
    const [row] = mentions.findBySeed('isrc:GBAAM8300011');
    expect(row.evidenceId).toBeNull();
    expect(row.url).toBe('https://www.reddit.com/r/ifyoulikeblank/comments/aaa/lovecats');
    // Nothing the provider authored: no title, only our own sentence and the bare URL.
    expect(row.pageTitle).toBeNull();
    expect(row.sentence).toBe('this one, same horn stabs');
  });
});

describe('verifications repo', () => {
  it('round-trips a hit and a verified miss, normalising the key', () => {
    verifications.set('The Cure', 'The Lovecats', 'isrc:GBAAM8300010', 100);
    verifications.set('The Cure', 'Purple Marmalade Sunrise', null, 200);

    const hit = verifications.get('the cure', 'the lovecats (2006 remaster)');
    expect(hit).toEqual({
      normArtist: 'cure',
      normTitle: 'the lovecats',
      trackKey: 'isrc:GBAAM8300010',
      checkedAt: 100,
    });

    const miss = verifications.get('Cure', 'Purple Marmalade Sunrise');
    expect(miss?.trackKey).toBeNull();
    expect(miss?.checkedAt).toBe(200);

    expect(verifications.get('The Cure', 'Never Looked This Up')).toBeNull();
  });

  it('set overwrites an earlier verdict', () => {
    verifications.set('The Cure', 'A Song', null, 100);
    verifications.set('The Cure', 'A Song', 'deezer:5', 300);
    expect(verifications.get('The Cure', 'A Song')).toEqual({
      normArtist: 'cure',
      normTitle: 'a song',
      trackKey: 'deezer:5',
      checkedAt: 300,
    });
  });
});

describe('runs repo', () => {
  it('round-trips a RunRecord and finds it by the cache key', () => {
    const run = runRecord();
    const hash = runs.optionsHash(run.options);
    runs.save(run, hash);

    expect(runs.get(run.id)).toEqual(run);
    expect(runs.find(run.seed.key, hash, 'test-1')).toEqual(run);
    expect(runs.find(run.seed.key, hash, 'other-version')).toBeNull();
    expect(runs.find(run.seed.key, runs.optionsHash({ includeSameArtist: true }), 'test-1')).toBeNull();
    expect(runs.count()).toBe(1);
  });

  it('optionsHash is stable and order-insensitive', () => {
    expect(runs.optionsHash({ includeSameArtist: false })).toBe(
      runs.optionsHash({ includeSameArtist: false }),
    );
    expect(runs.optionsHash({ includeSameArtist: true })).not.toBe(
      runs.optionsHash({ includeSameArtist: false }),
    );
  });

  it('find returns the most recent matching run', () => {
    const hash = runs.optionsHash({ includeSameArtist: false });
    runs.save(runRecord({ createdAt: 1 }), hash);
    const newer = runRecord({ createdAt: 2, degraded: ['newer'] });
    runs.save(newer, hash);
    expect(runs.find(newer.seed.key, hash, 'test-1')?.degraded).toEqual(['newer']);
  });

  /**
   * `latestForSeed` ignores the cache key entirely: it answers "what did this listener
   * last see for this track", which is what the correction prompt has to quote back.
   */
  it('latestForSeed returns the newest run for a seed whatever options produced it', () => {
    expect(runs.latestForSeed('isrc:GBAAM8300010')).toBeNull();

    const first = runRecord({ createdAt: 1 });
    runs.save(first, runs.optionsHash(first.options));

    const corrected = runRecord({
      createdAt: 2,
      options: { includeSameArtist: false, corrections: { vocal_delivery: 'wrong' } },
      fingerprint: { ...fingerprint(), vocal_delivery: 'a second reading of the vocal' },
    });
    runs.save(corrected, runs.optionsHash(corrected.options));

    const latest = runs.latestForSeed(corrected.seed.key);
    expect(latest?.id).toBe(corrected.id);
    expect(latest?.fingerprint?.vocal_delivery).toBe('a second reading of the vocal');
    // Not the uncorrected row that `find` would replay for the *uncorrected* options.
    expect(runs.find(first.seed.key, runs.optionsHash(first.options), 'test-1')?.id).toBe(first.id);
    expect(runs.latestForSeed('deezer:nothing-here')).toBeNull();
  });
});

describe('playlists repo', () => {
  beforeEach(() => {
    tracks.upsert(track());
    tracks.upsert(track({ key: 'deezer:2', isrc: null, title: 'Hell', artist: 'Squirrel Nut Zippers' }));
    tracks.upsert(track({ key: 'deezer:3', isrc: null, title: 'Fever', artist: 'Peggy Lee' }));
  });

  it('creates, gets, lists, renames and deletes', () => {
    const pl = playlists.create('Stings');
    expect(pl.id).toMatch(/^pl_/);
    expect(playlists.get(pl.id)).toEqual(pl);
    expect(playlists.list()).toEqual([{ ...pl, count: 0 }]);

    const renamed = playlists.rename(pl.id, 'Stings II');
    expect(renamed?.name).toBe('Stings II');
    expect(playlists.rename('pl_nope', 'x')).toBeNull();

    expect(playlists.delete(pl.id)).toBe(true);
    expect(playlists.get(pl.id)).toBeNull();
    expect(playlists.delete(pl.id)).toBe(false);
  });

  it('adds items in order, dedupes, and refuses unknown tracks or playlists', () => {
    const pl = playlists.create('Stings');
    const a = playlists.addItem(pl.id, { trackKey: 'isrc:GBAAM8300010', why: 'the seed' });
    const b = playlists.addItem(pl.id, { trackKey: 'deezer:2', seedKey: 'isrc:GBAAM8300010' });
    expect(a?.position).toBe(0);
    expect(b?.position).toBe(1);
    expect(a?.why).toBe('the seed');
    expect(b?.seedKey).toBe('isrc:GBAAM8300010');

    // Adding the same track again is a no-op that hands back the existing item.
    const again = playlists.addItem(pl.id, { trackKey: 'isrc:GBAAM8300010' });
    expect(again?.id).toBe(a?.id);
    expect(playlists.items(pl.id)).toHaveLength(2);

    expect(playlists.addItem(pl.id, { trackKey: 'not-resolved' })).toBeNull();
    expect(playlists.addItem('pl_nope', { trackKey: 'deezer:2' })).toBeNull();
    expect(playlists.list()[0].count).toBe(2);
  });

  it('removes an item and repacks positions', () => {
    const pl = playlists.create('Stings');
    const a = playlists.addItem(pl.id, { trackKey: 'isrc:GBAAM8300010' })!;
    const b = playlists.addItem(pl.id, { trackKey: 'deezer:2' })!;
    const c = playlists.addItem(pl.id, { trackKey: 'deezer:3' })!;

    expect(playlists.removeItem(pl.id, b.id)).toBe(true);
    expect(playlists.items(pl.id).map((i) => [i.id, i.position])).toEqual([
      [a.id, 0],
      [c.id, 1],
    ]);
    expect(playlists.removeItem(pl.id, 99_999)).toBe(false);
  });

  it('reorders by item id and keeps unlisted items after the listed ones', () => {
    const pl = playlists.create('Stings');
    const a = playlists.addItem(pl.id, { trackKey: 'isrc:GBAAM8300010' })!;
    const b = playlists.addItem(pl.id, { trackKey: 'deezer:2' })!;
    const c = playlists.addItem(pl.id, { trackKey: 'deezer:3' })!;

    expect(playlists.reorder(pl.id, [c.id, a.id, b.id]).map((i) => i.id)).toEqual([
      c.id,
      a.id,
      b.id,
    ]);
    expect(playlists.reorder(pl.id, [b.id]).map((i) => i.id)).toEqual([b.id, c.id, a.id]);
    expect(playlists.items(pl.id).map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it('deleting a playlist cascades to its items', () => {
    const pl = playlists.create('Stings');
    playlists.addItem(pl.id, { trackKey: 'deezer:2' });
    playlists.delete(pl.id);
    expect(playlists.items(pl.id)).toEqual([]);
    expect(
      (getDb().prepare('SELECT COUNT(*) AS n FROM playlist_items').get() as { n: number }).n,
    ).toBe(0);
  });
});
