import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb } from '@/lib/db';
import * as httpCache from '@/lib/db/repos/httpCache';
import {
  RETRY_BACKOFF_MS,
  USER_AGENT,
  cacheKeyFor,
  fetchExternal,
  setFetchImpl,
  type ExternalRequest,
} from '@/lib/http/fetchExternal';
import { resetLimiters } from '@/lib/http/rateLimit';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  cache?: RequestCache;
}

/**
 * A fake transport. `responses` is consumed one entry per call; the last entry repeats
 * once the list runs out.
 */
function fakeFetch(responses: Array<{ status: number; body: string } | 'network-error'>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body as string | undefined,
      cache: init?.cache,
    });
    if (next === 'network-error') throw new TypeError('fetch failed');
    return new Response(next.body, { status: next.status });
  }) as typeof fetch;
  return { impl, calls, get count() { return i; } };
}

const req = (over: Partial<ExternalRequest> = {}): ExternalRequest => ({
  url: 'https://example.test/thing',
  ttlMs: 0,
  ...over,
});

beforeEach(() => {
  resetLimiters();
  getDb().exec('DELETE FROM http_cache');
});

afterEach(() => {
  setFetchImpl(null);
  vi.useRealTimers();
  resetLimiters();
});

describe('happy path', () => {
  it('returns the body, the status and a typed json() accessor', async () => {
    const fake = fakeFetch([{ status: 200, body: '{"resultCount":1}' }]);
    setFetchImpl(fake.impl);

    const res = await fetchExternal(req());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.status).toBe(200);
    expect(res.text).toBe('{"resultCount":1}');
    expect(res.json<{ resultCount: number }>()).toEqual({ resultCount: 1 });
    expect(res.fromCache).toBe(false);
    expect(res.fetchedAt).toBeGreaterThan(0);
  });

  it('sends the fixed User-Agent, no-store and any caller headers', async () => {
    const fake = fakeFetch([{ status: 200, body: 'ok' }]);
    setFetchImpl(fake.impl);

    await fetchExternal(req({ method: 'POST', body: '{"q":1}', headers: { 'X-API-KEY': 'k' } }));
    expect(fake.calls[0].method).toBe('POST');
    expect(fake.calls[0].body).toBe('{"q":1}');
    expect(fake.calls[0].headers['User-Agent']).toBe(USER_AGENT);
    expect(fake.calls[0].headers['X-API-KEY']).toBe('k');
  });
});

describe('failures', () => {
  it('never throws on a network error; it reports a readable reason', async () => {
    setFetchImpl(fakeFetch(['network-error']).impl);
    vi.useFakeTimers();

    const p = fetchExternal(req({ retries: 0 }));
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await p;

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBeNull();
    expect(res.reason).toContain('network error: fetch failed');
    expect(res.fromCache).toBe(false);
  });

  it('does not retry a 404 and reports it', async () => {
    const fake = fakeFetch([{ status: 404, body: 'nope' }]);
    setFetchImpl(fake.impl);

    const res = await fetchExternal(req());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
    expect(res.reason).toBe('HTTP 404 from example.test');
    expect(fake.count).toBe(1);
  });

  it('honours okStatuses', async () => {
    setFetchImpl(fakeFetch([{ status: 404, body: 'nope' }]).impl);
    const res = await fetchExternal(req({ okStatuses: [200, 404] }));
    expect(res.ok).toBe(true);
  });

  it('times out and says so', async () => {
    setFetchImpl((async (_input, init) => {
      await new Promise((_resolve, reject) => {
        (init?.signal as AbortSignal).addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
      return new Response('unreachable');
    }) as typeof fetch);
    vi.useFakeTimers();

    const p = fetchExternal(req({ timeoutMs: 50, retries: 0 }));
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await p;

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('timeout after 50ms');
  });
});

describe('retries', () => {
  it('retries a 503 with backoff and succeeds on the third attempt', async () => {
    const fake = fakeFetch([
      { status: 503, body: 'server is currently busy' },
      { status: 503, body: 'server is currently busy' },
      { status: 200, body: '{"ok":true}' },
    ]);
    setFetchImpl(fake.impl);
    vi.useFakeTimers();

    const p = fetchExternal(req({ url: 'https://musicbrainz.org/ws/2/isrc/X', retries: 2 }));
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await p;

    expect(fake.count).toBe(3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.json<{ ok: boolean }>()).toEqual({ ok: true });
  });

  it('gives up after the configured number of attempts', async () => {
    const fake = fakeFetch([{ status: 503, body: 'busy' }]);
    setFetchImpl(fake.impl);
    vi.useFakeTimers();

    const p = fetchExternal(req({ retries: 2 }));
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await p;

    expect(fake.count).toBe(3);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(503);
    expect(res.reason).toContain('gave up after 3 attempts');
  });

  it('retries 429 and 5xx', async () => {
    for (const status of [429, 500, 502, 503]) {
      const fake = fakeFetch([{ status, body: 'x' }, { status: 200, body: 'ok' }]);
      setFetchImpl(fake.impl);
      vi.useFakeTimers();
      const p = fetchExternal(req({ retries: 1 }));
      await vi.advanceTimersByTimeAsync(30_000);
      const res = await p;
      vi.useRealTimers();
      expect(res.ok, `status ${status} should be retried`).toBe(true);
      expect(fake.count).toBe(2);
    }
  });

  it('calls isRetryableBody and retries a Deezer quota error hidden in a 200', async () => {
    const quota = '{"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}';
    const fake = fakeFetch([
      { status: 200, body: quota },
      { status: 200, body: '{"id":3135556}' },
    ]);
    setFetchImpl(fake.impl);
    const seen: Array<[number, string]> = [];
    vi.useFakeTimers();

    const p = fetchExternal(
      req({
        url: 'https://api.deezer.com/track/3135556',
        ttlMs: 60_000,
        retries: 2,
        isRetryableBody: (status, text) => {
          seen.push([status, text]);
          return text.includes('"code":4');
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await p;

    expect(seen).toHaveLength(2);
    expect(seen[0][0]).toBe(200);
    expect(fake.count).toBe(2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toBe('{"id":3135556}');
    // The quota body must never have been cached.
    expect(httpCache.count()).toBe(1);
  });
});

describe('caching', () => {
  it('misses, stores, then hits without touching the network', async () => {
    const fake = fakeFetch([{ status: 200, body: 'first' }, { status: 200, body: 'second' }]);
    setFetchImpl(fake.impl);

    const first = await fetchExternal(req({ ttlMs: 60_000 }));
    expect(first.ok && first.fromCache).toBe(false);
    expect(httpCache.count()).toBe(1);

    const second = await fetchExternal(req({ ttlMs: 60_000 }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.fromCache).toBe(true);
    expect(second.text).toBe('first');
    expect(fake.count).toBe(1);
  });

  it('goes back to the network once the TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const fake = fakeFetch([{ status: 200, body: 'first' }, { status: 200, body: 'second' }]);
    setFetchImpl(fake.impl);

    await fetchExternal(req({ ttlMs: 1000 }));
    vi.setSystemTime(1_000_000 + 1001);
    const again = await fetchExternal(req({ ttlMs: 1000 }));

    expect(fake.count).toBe(2);
    expect(again.ok && again.text).toBe('second');
  });

  it('does not cache when ttlMs is 0', async () => {
    const fake = fakeFetch([{ status: 200, body: 'x' }]);
    setFetchImpl(fake.impl);
    await fetchExternal(req({ ttlMs: 0 }));
    await fetchExternal(req({ ttlMs: 0 }));
    expect(httpCache.count()).toBe(0);
    expect(fake.count).toBe(2);
  });

  it('respects noStore even when a TTL is given (Brave/Exa terms)', async () => {
    const fake = fakeFetch([{ status: 200, body: 'brave results' }]);
    setFetchImpl(fake.impl);

    const first = await fetchExternal(
      req({ url: 'https://api.search.brave.com/res/v1/web/search', ttlMs: 30 * 86_400_000, noStore: true }),
    );
    expect(first.ok).toBe(true);
    expect(httpCache.count()).toBe(0);

    const second = await fetchExternal(
      req({ url: 'https://api.search.brave.com/res/v1/web/search', ttlMs: 30 * 86_400_000, noStore: true }),
    );
    expect(second.ok && second.fromCache).toBe(false);
    expect(fake.count).toBe(2);
  });

  it('does not cache a failure', async () => {
    setFetchImpl(fakeFetch([{ status: 404, body: 'nope' }]).impl);
    await fetchExternal(req({ ttlMs: 60_000 }));
    expect(httpCache.count()).toBe(0);
  });

  it('keys the cache on method, url, body and cacheKeyExtra', async () => {
    const base = req({ ttlMs: 60_000 });
    expect(cacheKeyFor(base)).toBe(cacheKeyFor(req({ ttlMs: 60_000 })));
    expect(cacheKeyFor(base)).not.toBe(cacheKeyFor(req({ ttlMs: 60_000, method: 'POST' })));
    expect(cacheKeyFor(base)).not.toBe(cacheKeyFor(req({ ttlMs: 60_000, body: 'x' })));
    expect(cacheKeyFor(base)).not.toBe(
      cacheKeyFor(req({ ttlMs: 60_000, cacheKeyExtra: 'tavily' })),
    );
    expect(cacheKeyFor(base)).not.toBe(cacheKeyFor(req({ ttlMs: 60_000, url: 'https://example.test/other' })));

    const fake = fakeFetch([{ status: 200, body: 'a' }, { status: 200, body: 'b' }]);
    setFetchImpl(fake.impl);
    await fetchExternal(req({ ttlMs: 60_000, cacheKeyExtra: 'tavily' }));
    await fetchExternal(req({ ttlMs: 60_000, cacheKeyExtra: 'brave' }));
    expect(fake.count).toBe(2);
    expect(httpCache.count()).toBe(2);
  });
});

/* ------------------------------------------------------------------------------------ *
 * The two things the seam must NOT do
 * ------------------------------------------------------------------------------------ */

describe('no `cache` option ever reaches fetch', () => {
  it('leaves it undefined, so Next does not add no-cache headers upstream', async () => {
    // docs/architecture.md, "Rate limits and caching": `cache: 'no-store'` makes Next's
    // patched fetch send `cache-control: no-cache` + `pragma: no-cache` UPSTREAM, which
    // bypasses iTunes' Akamai edge cache (max-age=86400). Route handlers do not cache by
    // default, so the option buys nothing and costs the edge.
    const f = fakeFetch([{ status: 200, body: '{}' }]);
    setFetchImpl(f.impl);

    await fetchExternal(req({ url: 'https://itunes.apple.com/search?term=x' }));

    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].cache).toBeUndefined();
    expect(f.calls[0].headers['User-Agent']).toBe(USER_AGENT);
  });
});

describe('isCacheableBody', () => {
  it('answers a body it refuses to store, and does not store it', async () => {
    const errorBody = '{"error":{"type":"DataException","code":800}}';
    const f = fakeFetch([{ status: 200, body: errorBody }]);
    setFetchImpl(f.impl);

    const request = req({
      ttlMs: 30 * 86_400_000,
      isCacheableBody: (_status, text) => !text.includes('"error"'),
    });
    const res = await fetchExternal(request);

    // The caller still gets the body — it is a real answer, just not a durable fact.
    expect(res.ok && res.text).toBe(errorBody);
    expect(httpCache.get(cacheKeyFor(request))).toBeNull();
  });

  it('stores a clean body as usual', async () => {
    const f = fakeFetch([{ status: 200, body: '{"data":[]}' }]);
    setFetchImpl(f.impl);

    const request = req({
      ttlMs: 30 * 86_400_000,
      isCacheableBody: (_status, text) => !text.includes('"error"'),
    });
    await fetchExternal(request);

    expect(httpCache.get(cacheKeyFor(request))?.body).toBe('{"data":[]}');
  });
});

describe('the retry backoff ladder', () => {
  it('matches the schedule architecture.md specifies for MusicBrainz', async () => {
    expect(RETRY_BACKOFF_MS).toEqual([1200, 2400, 4800, 6000, 6000]);
  });
});
