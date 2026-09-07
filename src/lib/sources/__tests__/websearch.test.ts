import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixture, installFetch, resetHarness } from './harness';

const mocks = vi.hoisted(() => ({
  env: {
    tavilyApiKey: undefined as string | undefined,
    braveApiKey: undefined as string | undefined,
    keys: { websearch: null as 'tavily' | 'brave' | null },
  },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env, keys: mocks.env.keys }));

const websearch = await import('@/lib/sources/websearch');
const { getDb } = await import('@/lib/db');

function useTavily(): void {
  mocks.env.tavilyApiKey = 'tvly-test';
  mocks.env.braveApiKey = undefined;
  mocks.env.keys.websearch = 'tavily';
}

function useBrave(): void {
  mocks.env.tavilyApiKey = undefined;
  mocks.env.braveApiKey = 'brave-test';
  mocks.env.keys.websearch = 'brave';
}

beforeEach(() => {
  resetHarness();
  mocks.env.tavilyApiKey = undefined;
  mocks.env.braveApiKey = undefined;
  mocks.env.keys.websearch = null;
});
afterEach(() => resetHarness());

describe('with no provider configured', () => {
  it('answers no_provider without a request', async () => {
    const h = installFetch([]);
    expect(await websearch.search('lovecats sounds like')).toMatchObject({
      ok: false,
      reason: 'no_provider',
    });
    expect(h.calls).toHaveLength(0);
  });
});

describe('tavily (primary)', () => {
  beforeEach(useTavily);

  it('pins search_depth basic, asks for raw content, and passes include_domains', async () => {
    const h = installFetch([
      {
        when: 'api.tavily.com',
        body: {
          query: 'x',
          results: [
            {
              url: 'https://www.reddit.com/r/ifyoulikeblank/comments/x',
              title: 'Songs like The Lovecats?',
              content: 'chunk one [...] chunk two',
              raw_content: 'the whole cleaned thread',
              score: 0.81,
            },
          ],
        },
      },
    ]);

    const res = await websearch.search('"The Lovecats" songs like', {
      includeDomains: ['reddit.com'],
      maxResults: 5,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.provider).toBe('tavily');
    expect(res.value.storable).toBe(true);
    expect(res.value.results[0]).toEqual({
      url: 'https://www.reddit.com/r/ifyoulikeblank/comments/x',
      title: 'Songs like The Lovecats?',
      snippet: 'chunk one [...] chunk two',
      content: 'the whole cleaned thread',
      score: 0.81,
    });

    const body = JSON.parse(h.calls[0].body as string);
    expect(body).toMatchObject({
      search_depth: 'basic',
      include_raw_content: true,
      max_results: 5,
      include_domains: ['reddit.com'],
    });
    expect(h.calls[0].headers.Authorization).toBe('Bearer tvly-test');
  });

  it('maps the recorded 401 to invalid_api_key', async () => {
    installFetch([{ when: 'api.tavily.com', status: 401, body: fixture('tavily-401') }]);
    expect(await websearch.search('anything')).toMatchObject({
      ok: false,
      reason: 'invalid_api_key',
    });
  });

  it('caches results (its terms allow it)', async () => {
    const h = installFetch([{ when: 'api.tavily.com', body: { results: [] } }]);
    await websearch.search('the lovecats');
    await websearch.search('the lovecats');
    expect(h.calls).toHaveLength(1);
    expect((getDb().prepare('SELECT COUNT(*) n FROM http_cache').get() as { n: number }).n).toBe(1);
  });
});

describe('brave (fallback)', () => {
  beforeEach(useBrave);

  it('merges web and discussion results and NEVER caches them', async () => {
    const h = installFetch([
      {
        when: 'api.search.brave.com',
        body: {
          web: {
            results: [
              {
                url: 'https://example.com/a',
                title: 'A',
                description: 'snippet a',
                extra_snippets: ['more a', 'even more a'],
              },
            ],
          },
          discussions: { results: [{ url: 'https://reddit.com/b', title: 'B', description: 'snippet b' }] },
        },
      },
    ]);

    const res = await websearch.search('lovecats', { includeDomains: ['reddit.com'] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.provider).toBe('brave');
    expect(res.value.storable).toBe(false);
    expect(res.value.results.map((r) => r.url)).toEqual([
      'https://example.com/a',
      'https://reddit.com/b',
    ]);
    expect(res.value.results[0].content).toBe('more a … even more a');

    expect(h.calls[0].headers['X-Subscription-Token']).toBe('brave-test');
    expect(decodeURIComponent(h.calls[0].url)).toContain('site:reddit.com');
    expect(h.calls[0].url).toContain('text_decorations=false');

    // Brave's ToS forbids retention: nothing may be written to http_cache.
    expect((getDb().prepare('SELECT COUNT(*) n FROM http_cache').get() as { n: number }).n).toBe(0);
    await websearch.search('lovecats', { includeDomains: ['reddit.com'] });
    expect(h.calls).toHaveLength(2);
  });

  it('maps the recorded 422 to invalid_api_key', async () => {
    installFetch([{ when: 'api.search.brave.com', status: 422, body: fixture('brave-422') }]);
    expect(await websearch.search('anything')).toMatchObject({
      ok: false,
      reason: 'invalid_api_key',
    });
  });
});

describe('provider selection', () => {
  it('prefers Tavily and reports the choice', () => {
    useTavily();
    expect(websearch.providerFor()).toBe('tavily');
    expect(websearch.providerFor('brave')).toBeNull();
    useBrave();
    expect(websearch.providerFor()).toBe('brave');
    expect(websearch.providerFor('tavily')).toBeNull();
  });
});
