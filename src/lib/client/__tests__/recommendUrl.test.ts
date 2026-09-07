/**
 * The URL `useRecommendStream` opens the SSE stream on — the one place the weights map is
 * threaded onto the `/api/recommend` request. Tested as the pure function it is (the hook
 * only feeds it `EventSource(url)`), so no network and no fake EventSource are needed: the
 * contract that matters is exactly which query the browser asks for.
 */

import { describe, expect, it } from 'vitest';

import { recommendUrl } from '@/lib/client/useRecommendStream';

const base = { seedKey: 'isrc:GBAAM8300010', sameArtist: false, corrections: {}, weights: {} };

describe('recommendUrl', () => {
  it('is null without a seed — nothing to open', () => {
    expect(recommendUrl({ ...base, seedKey: null })).toBeNull();
  });

  it('omits the weights param entirely when the map is empty (the "use defaults" signal)', () => {
    const url = recommendUrl(base);
    expect(url).toBe('/api/recommend?seed=isrc%3AGBAAM8300010&sameArtist=0');
    expect(url).not.toContain('weights');
  });

  it('threads a non-empty weights map as url-encoded JSON, like corrections', () => {
    const url = recommendUrl({ ...base, weights: { era: 1, rhythmic_character: 5 } });
    const param = new URL(url as string, 'http://x').searchParams.get('weights');
    expect(param).not.toBeNull();
    expect(JSON.parse(param as string)).toEqual({ era: 1, rhythmic_character: 5 });
  });

  it('carries weights alongside sameArtist and corrections', () => {
    const url = recommendUrl({
      seedKey: 'deezer:3135556',
      sameArtist: true,
      corrections: { tempo_feel: 'wrong' },
      weights: { scene_context: 2 },
    });
    const params = new URL(url as string, 'http://x').searchParams;
    expect(params.get('sameArtist')).toBe('1');
    expect(JSON.parse(params.get('corrections') as string)).toEqual({ tempo_feel: 'wrong' });
    expect(JSON.parse(params.get('weights') as string)).toEqual({ scene_context: 2 });
  });
});
