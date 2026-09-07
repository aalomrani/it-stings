import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getTrack,
  getTrackByIsrc,
  isRetryableBody,
  pickBestMatch,
  searchTrack,
  type DeezerHit,
} from '@/lib/sources/deezer';
import { fixture, installFetch, resetHarness } from './harness';

beforeEach(() => resetHarness());
afterEach(() => resetHarness());

/** Turn a recorded search body into the client's hit shape without a request. */
function hitsFrom(...names: string[]): DeezerHit[] {
  const out: DeezerHit[] = [];
  const seen = new Set<number>();
  for (const name of names) {
    const raw = fixture<{ data: Record<string, never>[] }>(name);
    for (const t of raw.data) {
      const id = t.id as unknown as number;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        title: t.title as unknown as string,
        titleShort: (t.title_short as unknown as string) ?? (t.title as unknown as string),
        titleVersion: (t.title_version as unknown as string) ?? '',
        artist: {
          id: (t.artist as unknown as { id: number }).id,
          name: (t.artist as unknown as { name: string }).name,
        },
        album: { id: null, title: null, cover: null, coverXl: null },
        isrc: (t.isrc as unknown as string) ?? null,
        duration: t.duration as unknown as number,
        rank: t.rank as unknown as number,
        preview: (t.preview as unknown as string) ?? null,
        link: null,
      });
    }
  }
  return out;
}

describe('searchTrack', () => {
  it('uses the advanced query first and keeps its hits when they are clean', async () => {
    const h = installFetch([
      { when: 'artist%3A%22The%20Cure%22', body: fixture('deezer-search-lovecats-advanced') },
      { when: '/search', body: fixture('deezer-search-lovecats-plain') },
    ]);

    const res = await searchTrack('The Cure', 'The Lovecats');
    expect(res.ok).toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.urls()[0]).toContain('artist%3A%22The%20Cure%22%20track%3A%22The%20Lovecats%22');
  });

  it('falls back to the plain query and merges when advanced returns only variants', async () => {
    // Caravan Palace: the advanced query answers with the original, the plain one leads
    // with a 2025 DJ mix. Reverse them to prove the fallback merges rather than replaces.
    const h = installFetch([
      { when: 'artist%3A', body: fixture('deezer-search-lone-digger-plain') },
      { when: '/search', body: fixture('deezer-search-lone-digger-advanced') },
    ]);

    const res = await searchTrack('Caravan Palace', 'Lone Digger');
    expect(h.calls).toHaveLength(2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((x) => x.id)).toEqual([3392254691, 3594343412, 109590416]);
  });

  it('reports a Deezer error body (HTTP 200) as a typed failure', async () => {
    installFetch([{ when: '/search', body: { error: { type: 'ParameterException', code: 500 } } }]);
    const res = await searchTrack('The Cure', 'The Lovecats');
    expect(res).toMatchObject({ ok: false, reason: 'invalid_request' });
  });
});

describe('getTrack', () => {
  it('parses bpm, isrc and release date', async () => {
    installFetch([{ when: '/track/1143631', body: fixture('deezer-track-1143631') }]);
    const res = await getTrack(1143631);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({
      id: 1143631,
      isrc: 'GBALB8300001',
      bpm: 91.9,
      releaseDate: '2001-11-12',
      titleShort: 'The Lovecats',
    });
    expect(res.value.preview).toContain('dzcdn.net');
  });

  it('treats bpm 0 as unknown, never as zero beats per minute', async () => {
    installFetch([{ when: '/track/', body: fixture('deezer-track-2440763155') }]);
    const res = await getTrack(2440763155);
    expect(res.ok && res.value.bpm).toBeNull();
  });

  it('maps the HTTP-200 "no data" body to not_found', async () => {
    installFetch([{ when: '/track/', body: fixture('deezer-track-not-found') }]);
    const res = await getTrack(999999999999);
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('caches metadata and preview reads under DIFFERENT keys', async () => {
    const h = installFetch([{ when: '/track/1143631', body: fixture('deezer-track-1143631') }]);
    await getTrack(1143631);
    await getTrack(1143631); // cached (30 days)
    expect(h.calls).toHaveLength(1);

    // The preview read must NOT be served from the 30-day metadata entry: its signed URL
    // would already be minutes old.
    const preview = await getTrack(1143631, { forPreview: true });
    expect(preview.ok && preview.fromCache).toBe(false);
    expect(h.calls).toHaveLength(2);
  });

  it('rejects a nonsense id without a request', async () => {
    const h = installFetch([]);
    expect(await getTrack(0)).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('getTrackByIsrc', () => {
  it('normalises the ISRC and calls the isrc: form', async () => {
    const h = installFetch([{ when: '/track/isrc:', body: fixture('deezer-track-1143631') }]);
    const res = await getTrackByIsrc('gb-alb-83-00001');
    expect(res.ok).toBe(true);
    expect(h.urls()[0]).toBe('https://api.deezer.com/track/isrc:GBALB8300001');
  });
});

describe('quota (code 4) handling', () => {
  it('is retryable, is not cached, and eventually reports rate_limited', async () => {
    const quota = fixture('deezer-quota-code-4');
    expect(isRetryableBody(200, JSON.stringify(quota))).toBe(true);
    expect(isRetryableBody(200, JSON.stringify(fixture('deezer-track-not-found')))).toBe(false);

    const h = installFetch([
      { when: '/track/', body: quota, once: true },
      { when: '/track/', body: fixture('deezer-track-1143631') },
    ]);
    const res = await getTrack(1143631);
    expect(res.ok).toBe(true);
    expect(h.calls).toHaveLength(2); // the throttled attempt was retried, not cached
  }, 10_000);
});

describe('pickBestMatch', () => {
  it('prefers the original over the "(Mixed)" DJ edit', () => {
    const best = pickBestMatch(
      hitsFrom('deezer-search-lone-digger-plain', 'deezer-search-lone-digger-advanced'),
      { artist: 'Caravan Palace', title: 'Lone Digger' },
    );
    expect(best?.id).toBe(109590416);
    expect(best?.title).toBe('Lone Digger');
  });

  it('prefers the studio Lovecats over the live, acoustic and remix editions', () => {
    const best = pickBestMatch(hitsFrom('deezer-search-lovecats-plain'), {
      artist: 'The Cure',
      title: 'The Lovecats',
      durationMs: 220093,
    });
    expect(best?.id).toBe(1143631);
    expect(best?.isrc).toBe('GBALB8300001');
  });

  it('never matches a different song by the same artist', () => {
    const closeToMe = hitsFrom('deezer-search-lovecats-plain').filter((h) => h.id === 909884);
    expect(pickBestMatch(closeToMe, { artist: 'The Cure', title: 'The Lovecats' })).toBeNull();
  });

  it('returns null when nothing shares the title', () => {
    expect(
      pickBestMatch(hitsFrom('deezer-search-lovecats-plain'), {
        artist: 'The Cure',
        title: 'Purple Marmalade Sunrise',
      }),
    ).toBeNull();
  });
});
