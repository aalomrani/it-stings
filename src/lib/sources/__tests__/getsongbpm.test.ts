import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixture, installFetch, resetHarness } from './harness';

const mocks = vi.hoisted(() => ({ env: { getsongbpmApiKey: undefined as string | undefined } }));
vi.mock('@/lib/env', () => ({ env: mocks.env, keys: {} }));

const getsongbpm = await import('@/lib/sources/getsongbpm');

beforeEach(() => {
  resetHarness();
  mocks.env.getsongbpmApiKey = 'key123';
});
afterEach(() => resetHarness());

const song = (over: Record<string, unknown> = {}) => ({
  id: 'o2r0L',
  title: 'The Lovecats',
  uri: 'https://getsongbpm.com/song/the-lovecats/o2r0L',
  tempo: '92', // a STRING in the docs' own example
  time_sig: '4/4',
  key_of: 'F',
  artist: { id: 'nZR', name: 'The Cure' },
  ...over,
});

describe('without a key', () => {
  it('never makes a request (unauthenticated requests are not allowed)', async () => {
    mocks.env.getsongbpmApiKey = undefined;
    const h = installFetch([]);
    expect(await getsongbpm.lookup('The Cure', 'The Lovecats')).toEqual({
      ok: false,
      reason: 'no_api_key',
      detail: 'GETSONGBPM_API_KEY is not set',
    });
    expect(h.calls).toHaveLength(0);
    expect(getsongbpm.describe()).toEqual({ name: 'getsongbpm', needsKey: true, configured: false });
  });
});

describe('lookup', () => {
  it('sends the key as a header and parses the string tempo', async () => {
    const h = installFetch([{ when: 'api.getsong.co', body: { search: [song()] } }]);
    const res = await getsongbpm.lookup('The Cure', 'The Lovecats');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({
      bpm: 92,
      key: 'F',
      timeSig: '4/4',
      url: 'https://getsongbpm.com/song/the-lovecats/o2r0L',
      title: 'The Lovecats',
      artist: 'The Cure',
    });

    expect(h.calls[0].headers['X-API-KEY']).toBe('key123');
    expect(h.urls()[0]).not.toContain('key123'); // never in a URL, a log or a cache row
    expect(h.urls()[0]).toContain('api.getsong.co/search/');
    expect(decodeURIComponent(h.urls()[0])).toContain('lookup=song:The Lovecats artist:The Cure');
  });

  it('treats tempo 0 and a non-numeric tempo as unknown', async () => {
    installFetch([{ when: 'api.getsong.co', body: { search: [song({ tempo: '0' })] } }]);
    expect((await getsongbpm.lookup('The Cure', 'The Lovecats')) as { value: { bpm: null } }).toMatchObject({
      value: { bpm: null },
    });

    resetHarness();
    installFetch([{ when: 'api.getsong.co', body: { search: [song({ tempo: 'n/a' })] } }]);
    expect((await getsongbpm.lookup('The Cure', 'The Lovecats')) as { value: { bpm: null } }).toMatchObject({
      value: { bpm: null },
    });
  });

  it('rejects a song by another artist', async () => {
    installFetch([
      { when: 'api.getsong.co', body: { search: [song({ artist: { name: 'Twinkle Twinkle Little Rock Star' } })] } },
    ]);
    expect(await getsongbpm.lookup('The Cure', 'The Lovecats')).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('handles a non-array `search` (the API answers that when it has nothing)', async () => {
    installFetch([{ when: 'api.getsong.co', body: { search: 'Nothing found' } }]);
    expect(await getsongbpm.lookup('The Cure', 'Purple Marmalade Sunrise')).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('maps the recorded 401 to invalid_api_key even under a text/html content type', async () => {
    installFetch([{ when: 'api.getsong.co', status: 401, body: fixture('getsongbpm-401') }]);
    expect(await getsongbpm.lookup('The Cure', 'The Lovecats')).toMatchObject({
      ok: false,
      reason: 'invalid_api_key',
    });
  });
});

describe('attribution', () => {
  it('exports the mandatory backlink', () => {
    expect(getsongbpm.ATTRIBUTION).toEqual({
      text: 'Tempo data by GetSongBPM',
      href: 'https://getsongbpm.com',
    });
  });
});
