import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_POLICY, getLimiter, getLimiterForUrl, policyFor, resetLimiters } from '@/lib/http/rateLimit';

beforeEach(() => {
  resetLimiters();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  resetLimiters();
});

/** Schedules `n` no-op tasks and records the ms at which each one STARTED. */
function scheduleMany(host: string, n: number, durationMs = 0) {
  const limiter = getLimiter(host);
  const starts: number[] = [];
  const done = Promise.all(
    Array.from({ length: n }, () =>
      limiter.schedule(async () => {
        starts.push(Date.now());
        if (durationMs > 0) await new Promise((r) => setTimeout(r, durationMs));
      }),
    ),
  );
  return { starts, done };
}

describe('policyFor', () => {
  it('knows every host the app talks to', () => {
    expect(policyFor('musicbrainz.org')).toMatchObject({ serial: true, minGapMs: 1100 });
    expect(policyFor('api.deezer.com')).toMatchObject({ limit: 45, windowMs: 5000 });
    expect(policyFor('itunes.apple.com')).toMatchObject({ limit: 20, windowMs: 60_000 });
    expect(policyFor('ws.audioscrobbler.com')).toMatchObject({ limit: 4, windowMs: 1000 });
    expect(policyFor('api.tavily.com')).toMatchObject({ limit: 1, windowMs: 1000 });
    expect(policyFor('api.search.brave.com')).toMatchObject({ limit: 1, windowMs: 1000 });
    expect(policyFor('acousticbrainz.org')).toMatchObject({ limit: 5, windowMs: 1000 });
  });

  it('lets a subdomain inherit and everything else take the default', () => {
    expect(policyFor('beta.musicbrainz.org')).toBe(policyFor('musicbrainz.org'));
    expect(policyFor('api.getsong.co')).toBe(DEFAULT_POLICY);
    expect(DEFAULT_POLICY).toMatchObject({ limit: 10, windowMs: 1000 });
  });

  it('is case-insensitive and resolves from a URL', () => {
    expect(getLimiterForUrl('https://API.Deezer.com/track/1').policy).toBe(
      policyFor('api.deezer.com'),
    );
    expect(getLimiterForUrl('not a url').policy).toBe(DEFAULT_POLICY);
  });
});

describe('getLimiter', () => {
  it('returns one process-wide instance per host', () => {
    expect(getLimiter('api.deezer.com')).toBe(getLimiter('api.deezer.com'));
    expect(getLimiter('api.deezer.com')).not.toBe(getLimiter('itunes.apple.com'));
  });
});

describe('musicbrainz policy', () => {
  it('spaces request STARTS at least 1100 ms apart', async () => {
    const { starts, done } = scheduleMany('musicbrainz.org', 4);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    expect(starts).toEqual([0, 1100, 2200, 3300]);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1100);
    }
  });

  it('is strictly serial — a slow request delays the next start beyond the gap', async () => {
    const { starts, done } = scheduleMany('musicbrainz.org', 3, 3000);
    await vi.advanceTimersByTimeAsync(20_000);
    await done;

    expect(starts).toEqual([0, 3000, 6000]);
  });
});

describe('deezer policy', () => {
  it('allows 45 starts immediately and holds the rest for the 5 s window', async () => {
    const { starts, done } = scheduleMany('api.deezer.com', 50);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    expect(starts).toHaveLength(50);
    expect(starts.filter((t) => t === 0)).toHaveLength(45);
    expect(starts.filter((t) => t === 5000)).toHaveLength(5);
  });

  it('keeps the window sliding across bursts', async () => {
    const first = scheduleMany('api.deezer.com', 45);
    await vi.advanceTimersByTimeAsync(1000);
    const second = scheduleMany('api.deezer.com', 1);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([first.done, second.done]);

    expect(first.starts.every((t) => t === 0)).toBe(true);
    expect(second.starts).toEqual([5000]);
  });
});

describe('per-second policies', () => {
  it('lets Last.fm run 4 per second', async () => {
    const { starts, done } = scheduleMany('ws.audioscrobbler.com', 9);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(starts).toEqual([0, 0, 0, 0, 1000, 1000, 1000, 1000, 2000]);
  });

  it('lets web search run 1 per second', async () => {
    const { starts, done } = scheduleMany('api.tavily.com', 3);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('runs unknown hosts at the default 10 per second', async () => {
    const { starts, done } = scheduleMany('api.getsong.co', 12);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(starts.filter((t) => t === 0)).toHaveLength(10);
    expect(starts.filter((t) => t === 1000)).toHaveLength(2);
  });
});

describe('schedule', () => {
  it('passes the value through and propagates a rejection without wedging the queue', async () => {
    const limiter = getLimiter('api.deezer.com');
    const good = limiter.schedule(async () => 'ok');
    // The rejection handler is attached immediately so the rejection is never "unhandled"
    // in the window before the assertions run.
    const bad = limiter
      .schedule(async () => {
        throw new Error('boom');
      })
      .then(
        () => 'resolved',
        (err: Error) => `rejected: ${err.message}`,
      );
    const after = limiter.schedule(async () => 'still running');
    await vi.advanceTimersByTimeAsync(1000);

    await expect(good).resolves.toBe('ok');
    await expect(bad).resolves.toBe('rejected: boom');
    await expect(after).resolves.toBe('still running');
  });
});
