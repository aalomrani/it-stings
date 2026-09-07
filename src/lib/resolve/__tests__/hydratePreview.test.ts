import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as tracksRepo from '@/lib/db/repos/tracks';
import {
  PREVIEW_LIFETIME_MS,
  hydratePreview,
  previewForKey,
  stripVolatilePreview,
} from '@/lib/resolve/hydratePreview';
import { fixture, installFetch, resetHarness } from '@/lib/sources/__tests__/harness';
import type { TrackRecord } from '@/lib/types';

const base: TrackRecord = {
  key: 'isrc:GBALB8300001',
  isrc: 'GBALB8300001',
  title: 'The Lovecats',
  artist: 'The Cure',
  album: 'Greatest Hits',
  year: null,
  durationMs: null,
  artwork: null,
  preview: null,
  tempoBpm: null,
  keySignature: null,
  links: {},
  ids: { deezer: 1143631 },
  tags: null,
  features: null,
  resolvedAt: Date.now(),
  degraded: [],
};

const itunesPreview = {
  url: 'https://audio-ssl.itunes.apple.com/x.m4a',
  source: { source: 'itunes' as const, id: '1288102536' },
  expiresAt: null,
};

beforeEach(() => resetHarness());
afterEach(() => resetHarness());

describe('hydratePreview', () => {
  it('mints a Deezer preview with an expiry short of the 900 s signature', async () => {
    installFetch([{ when: '/track/1143631', body: fixture('deezer-track-1143631') }]);

    const before = Date.now();
    const hydrated = await hydratePreview(base);
    expect(hydrated.preview?.url).toContain('cdnt-preview.dzcdn.net');
    expect(hydrated.preview?.source).toEqual({ source: 'deezer', id: '1143631', field: 'preview' });
    expect(hydrated.preview?.expiresAt).toBeGreaterThanOrEqual(before + PREVIEW_LIFETIME_MS);
    expect(PREVIEW_LIFETIME_MS).toBeLessThan(900_000);
  });

  it('does not mutate the input record', async () => {
    installFetch([{ when: '/track/', body: fixture('deezer-track-1143631') }]);
    await hydratePreview(base);
    expect(base.preview).toBeNull();
  });

  it('falls back to a persisted iTunes preview when Deezer fails', async () => {
    installFetch([{ when: '/track/', status: 500, body: 'nope' }]);
    const hydrated = await hydratePreview({ ...base, preview: itunesPreview });
    expect(hydrated.preview).toEqual(itunesPreview);
  }, 10_000);

  it('answers null rather than throwing when there is no audio at all', async () => {
    installFetch([{ when: '/track/', body: fixture('deezer-track-not-found') }]);
    const hydrated = await hydratePreview(base);
    expect(hydrated.preview).toBeNull();
  });
});

describe('stripVolatilePreview', () => {
  it('removes a Deezer URL and keeps an iTunes one', () => {
    const withDeezer = {
      ...base,
      preview: { url: 'https://cdnt-preview.dzcdn.net/x?hdnea=exp', source: { source: 'deezer' as const }, expiresAt: 1 },
    };
    expect(stripVolatilePreview(withDeezer).preview).toBeNull();
    expect(stripVolatilePreview({ ...base, preview: itunesPreview }).preview).toEqual(itunesPreview);
  });
});

describe('previewForKey', () => {
  it('returns undefined for an unknown key and a minted preview for a known one', async () => {
    installFetch([{ when: '/track/1143631', body: fixture('deezer-track-1143631') }]);
    expect(await previewForKey('isrc:NOPE')).toBeUndefined();

    tracksRepo.upsert(base);
    const preview = await previewForKey('isrc:GBALB8300001');
    expect(preview?.url).toContain('dzcdn.net');
  });
});
