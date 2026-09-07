import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { USER_AGENT } from '@/lib/http/fetchExternal';
import {
  getArtist,
  getRecording,
  lookupByIsrc,
  searchRecording,
  searchRecordingsByTags,
} from '@/lib/sources/musicbrainz';
import { fixture, installFetch, resetHarness } from './harness';

beforeEach(() => resetHarness());
afterEach(() => resetHarness());

describe('lookupByIsrc', () => {
  it('returns the recording, its year, ISRCs and tags', async () => {
    const h = installFetch([{ when: '/ws/2/isrc/', body: fixture('mb-isrc-GBALB8300001') }]);

    const res = await lookupByIsrc('GBALB8300001', { lengthMs: 220093 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value).toMatchObject({
      mbid: '1c19fbb9-edce-49e1-a934-de6071dd7964',
      title: 'The Lovecats',
      artist: 'The Cure',
      firstReleaseDate: '1983-11-28',
      year: 1983,
      lengthMs: 220000,
      disambiguation: 'album original mix',
    });
    expect(res.value.isrcs).toContain('GBALB8300001');
    expect(res.value.tags.map((t) => t.name)).toContain('new wave');
    expect(res.value.url).toBe('https://musicbrainz.org/recording/1c19fbb9-edce-49e1-a934-de6071dd7964');

    // The User-Agent is mandatory: without it MusicBrainz answers 403 ua-missing.
    expect(h.calls[0].headers['User-Agent']).toBe(USER_AGENT);
    expect(h.urls()[0]).toContain('inc=artist-credits%2Bisrcs%2Btags');
  });

  it('retries without tags when MusicBrainz rejects the inc list', async () => {
    // Verified live: `genres` is not a valid inc parameter for the isrc resource (400).
    const h = installFetch([
      { when: 'inc=artist-credits%2Bisrcs%2Btags', status: 400, body: { error: 'tags is not a valid inc parameter' } },
      { when: '/ws/2/isrc/', body: fixture('mb-isrc-GBALB8300001') },
    ]);
    const res = await lookupByIsrc('GBALB8300001');
    expect(res.ok).toBe(true);
    expect(h.calls).toHaveLength(2);
    expect(h.urls()[1]).toContain('inc=artist-credits%2Bisrcs');
  });

  it('maps a 404 to not_found (2 of 15 sample ISRCs miss)', async () => {
    installFetch([{ when: '/ws/2/isrc/', status: 404, body: fixture('mb-isrc-not-found') }]);
    expect(await lookupByIsrc('USCA29900213')).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('rejects a malformed ISRC without a request', async () => {
    const h = installFetch([]);
    expect(await lookupByIsrc('nope')).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('searchRecording', () => {
  it('accepts only a normalise-matched hit and prefers the closest duration', async () => {
    installFetch([{ when: '/ws/2/recording?', body: fixture('mb-search-lovecats') }]);
    const res = await searchRecording('The Cure', 'The Lovecats', { lengthMs: 227592 });
    expect(res.ok && res.value.mbid).toBe('54a5be2e-7685-4947-8cb6-aa5a7c916ab3');
  });

  it('refuses a search whose hits are a different song', async () => {
    installFetch([{ when: '/ws/2/recording?', body: fixture('mb-search-lovecats') }]);
    const res = await searchRecording('The Cure', 'Close to Me');
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('quotes the Lucene query for both fields', async () => {
    const h = installFetch([{ when: '/ws/2/recording?', body: { recordings: [] } }]);
    await searchRecording('The Cure', 'The Lovecats');
    expect(decodeURIComponent(h.urls()[0])).toContain(
      'query=recording:"The Lovecats" AND artist:"The Cure"',
    );
  });
});

describe('getRecording', () => {
  it('validates the MBID shape before spending a request', async () => {
    const h = installFetch([]);
    expect(await getRecording('not-a-uuid')).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(h.calls).toHaveLength(0);
  });

  it('reads tags and genres from a recording lookup', async () => {
    const body = fixture<Record<string, unknown>>('mb-isrc-GBALB8300001') as {
      recordings: Record<string, unknown>[];
    };
    installFetch([
      { when: '/ws/2/recording/', body: { ...body.recordings[0], genres: [{ name: 'new wave', count: 9 }] } },
    ]);
    const res = await getRecording('1c19fbb9-edce-49e1-a934-de6071dd7964');
    expect(res.ok && res.value.genres[0]).toEqual({ name: 'new wave', count: 9 });
  });
});

describe('searchRecordingsByTags (keyless Channel B tag cohort)', () => {
  it('quotes each tag, ANDs them, and keeps only score >= 85', async () => {
    const h = installFetch([{ when: '/ws/2/recording?', body: fixture('mb-search-tags-swing') }]);
    const res = await searchRecordingsByTags(['electro swing', 'swing']);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Quoting is mandatory — an unquoted multi-word tag explodes the cohort.
    expect(decodeURIComponent(h.urls()[0])).toContain('query=tag:"electro swing" AND tag:"swing"');
    // The score-62 filler is dropped; the score-100 and score-90 hits survive.
    expect(res.value.map((r) => r.title)).toEqual(['Booty Swing', 'That Man']);
    expect(res.value[0]).toMatchObject({ artist: 'Parov Stelar', year: 2012 });
    expect(res.value[0].tags.map((t) => t.name)).toContain('electro swing');
  });

  it('respects a custom minScore', async () => {
    installFetch([{ when: '/ws/2/recording?', body: fixture('mb-search-tags-swing') }]);
    const res = await searchRecordingsByTags(['electro swing'], { minScore: 95 });
    expect(res.ok && res.value.map((r) => r.title)).toEqual(['Booty Swing']);
  });

  it('strips quotes/backslashes from a tag so it cannot break out of its own quotes', async () => {
    const h = installFetch([{ when: '/ws/2/recording?', body: { recordings: [] } }]);
    await searchRecordingsByTags(['ele"ctro\\ swing']);
    expect(decodeURIComponent(h.urls()[0])).toContain('query=tag:"electro swing"');
  });

  it('rejects a call with no usable tag without a request', async () => {
    const h = installFetch([]);
    expect(await searchRecordingsByTags(['  ', '""'])).toMatchObject({
      ok: false,
      reason: 'invalid_request',
    });
    expect(h.calls).toHaveLength(0);
  });
});

describe('getArtist', () => {
  it('reads artist tags and genres and falls back off a rejected inc', async () => {
    const h = installFetch([
      { when: 'inc=tags%2Bgenres', status: 400, body: { error: 'genres is not a valid inc parameter' } },
      { when: '/ws/2/artist/', body: fixture('mb-artist-tags-parov') },
    ]);
    const res = await getArtist('44444444-4444-4444-8444-444444444444');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(h.calls).toHaveLength(2);
    expect(res.value).toMatchObject({ name: 'Parov Stelar' });
    expect(res.value.tags.map((t) => t.name)).toContain('electro swing');
    expect(res.value.genres[0]).toEqual({ name: 'electro swing', count: 9 });
  });

  it('rejects a malformed MBID without a request', async () => {
    const h = installFetch([]);
    expect(await getArtist('nope')).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(h.calls).toHaveLength(0);
  });
});
