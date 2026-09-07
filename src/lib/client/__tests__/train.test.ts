/**
 * The training client lib, against a fake `fetch`.
 *
 * These three calls are the whole browser→server training surface. Each one has to hit the
 * right route with the right method/body and unwrap the JSON — and the cookie that scopes it
 * all is httpOnly, so the client never touches it: the calls rely on the default same-origin
 * credentials, which means NO explicit `credentials` option that would narrow them. A non-2xx
 * answer becomes a thrown `Error` carrying the server's `error` string, exactly like `api.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProfile, postFeedback, setName } from '@/lib/client/train';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

let calls: Call[];

/** A fake `fetch` that records the call and answers with `body` at `status`. */
function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'stub',
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function lastBody(): unknown {
  const raw = calls[calls.length - 1]?.init?.body;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postFeedback', () => {
  it('POSTs the vote to /api/feedback as JSON and returns { weights, count }', async () => {
    stubFetch({ weights: { rhythmic_character: 7, era: 0 }, count: 3 });

    const out = await postFeedback({
      seedKey: 'seed:1',
      candidateKey: 'cand:2',
      label: 'match',
      source: 'card',
    });

    expect(out).toEqual({ weights: { rhythmic_character: 7, era: 0 }, count: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/feedback');
    expect(calls[0].init?.method).toBe('POST');
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    // The full vote rides in the body — the server needs every field to record the pair.
    expect(lastBody()).toEqual({
      seedKey: 'seed:1',
      candidateKey: 'cand:2',
      label: 'match',
      source: 'card',
    });
  });

  it('carries no explicit credentials, so the same-origin httpOnly cookie rides by default', async () => {
    stubFetch({ weights: {}, count: 0 });
    await postFeedback({ seedKey: 's', candidateKey: 'c', label: 'not', source: 'added' });
    expect(calls[0].init?.credentials).toBeUndefined();
    // and the no-store cache mode api.ts uses everywhere
    expect(calls[0].init?.cache).toBe('no-store');
  });

  it('throws the server error string on a 400', async () => {
    stubFetch({ error: 'invalid_request' }, 400);
    await expect(
      postFeedback({ seedKey: '', candidateKey: 'c', label: 'match', source: 'card' }),
    ).rejects.toThrow('invalid_request');
  });
});

describe('getProfile', () => {
  it('GETs /api/profile and returns the whole view', async () => {
    const view = { id: 'p1', displayName: 'ada', weights: { era: 0 }, count: 5 };
    stubFetch(view);

    const out = await getProfile();

    expect(out).toEqual(view);
    expect(calls[0].url).toBe('/api/profile');
    // A GET: no method override, no body.
    expect(calls[0].init?.method).toBeUndefined();
    expect(calls[0].init?.body).toBeUndefined();
  });
});

describe('setName', () => {
  it('POSTs the display name to /api/profile and returns the saved view', async () => {
    stubFetch({ id: 'p1', displayName: 'ada', weights: {}, count: 0 });

    const out = await setName('ada');

    expect(out.displayName).toBe('ada');
    expect(calls[0].url).toBe('/api/profile');
    expect(calls[0].init?.method).toBe('POST');
    expect(lastBody()).toEqual({ displayName: 'ada' });
  });

  it('sends null to clear the name', async () => {
    stubFetch({ id: 'p1', displayName: null, weights: {}, count: 0 });
    await setName(null);
    expect(lastBody()).toEqual({ displayName: null });
  });
});
