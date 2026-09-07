import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { USER_AGENT } from '@/lib/http/fetchExternal';
import { getRecording, lookupByIsrc, searchRecording } from '@/lib/sources/musicbrainz';
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
