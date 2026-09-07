import { afterEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/lib/db';
import * as counters from '@/lib/db/repos/counters';
import {
  DEFAULT_MAX_RUNS_PER_DAY,
  DEFAULT_MAX_RUNS_PER_IP_PER_HOUR,
  GATE_COOKIE,
  GATE_PATH,
  INVITE_ONLY_MESSAGE,
  SCOPE_DAY,
  SCOPE_IP_HOUR,
  accessToken,
  checkRunBudget,
  clientIp,
  dayBucket,
  decideAccess,
  gateEnabled,
  hourBucket,
  inviteLink,
  ipHourBucket,
  isApiPath,
  isBypassedPath,
  runCaps,
  tokenMatches,
} from '@/lib/gate';

const TOKEN = 'sting-abc123';

afterEach(() => {
  closeDb();
});

describe('the gate is off unless a token is configured', () => {
  it('reads the token, trimming it, and treats empty as unset', () => {
    expect(accessToken({})).toBeNull();
    expect(accessToken({ ITSTINGS_ACCESS_TOKEN: '' })).toBeNull();
    expect(accessToken({ ITSTINGS_ACCESS_TOKEN: '   ' })).toBeNull();
    expect(accessToken({ ITSTINGS_ACCESS_TOKEN: '  t  ' })).toBe('t');
    expect(gateEnabled({})).toBe(false);
    expect(gateEnabled({ ITSTINGS_ACCESS_TOKEN: TOKEN })).toBe(true);
  });

  it('lets every request through when there is no token', () => {
    expect(decideAccess({ pathname: '/' }, null)).toEqual({ action: 'allow' });
    expect(decideAccess({ pathname: '/api/recommend', search: '?seed=x' }, null)).toEqual({
      action: 'allow',
    });
  });
});

describe('tokenMatches', () => {
  it('accepts only the exact token', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches('sting-abc124', TOKEN)).toBe(false);
    expect(tokenMatches('sting-abc123 ', TOKEN)).toBe(false);
    expect(tokenMatches('sting', TOKEN)).toBe(false);
    expect(tokenMatches('', TOKEN)).toBe(false);
  });

  it('never throws on a length mismatch (timingSafeEqual would)', () => {
    expect(() => tokenMatches('x', TOKEN)).not.toThrow();
    expect(() => tokenMatches('x'.repeat(5000), TOKEN)).not.toThrow();
    expect(tokenMatches('x'.repeat(5000), TOKEN)).toBe(false);
  });

  it('is false for a missing candidate or a missing token', () => {
    expect(tokenMatches(null, TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN, null)).toBe(false);
  });
});

describe('bypassed paths', () => {
  it('never gates the healthcheck, the gate page, the build output or static files', () => {
    for (const p of [
      '/api/health',
      GATE_PATH,
      '/_next/static/chunk.js',
      '/_next/image',
      '/favicon.ico',
      '/robots.txt',
      '/wasp.svg',
      '/fonts/plex.woff2',
    ]) {
      expect(isBypassedPath(p), p).toBe(true);
    }
  });

  it('gates everything else', () => {
    for (const p of ['/', '/playlists', '/api/search', '/api/recommend', '/api/healthz', '/gateway']) {
      expect(isBypassedPath(p), p).toBe(false);
    }
  });

  it('knows an API path from a page path', () => {
    expect(isApiPath('/api/search')).toBe(true);
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/apiary')).toBe(false);
    expect(isApiPath('/')).toBe(false);
  });
});

describe('decideAccess with a token configured', () => {
  it('allows a request carrying the right cookie', () => {
    expect(decideAccess({ pathname: '/', cookie: TOKEN }, TOKEN)).toEqual({ action: 'allow' });
  });

  it('sends a browser without a cookie to /gate', () => {
    expect(decideAccess({ pathname: '/' }, TOKEN)).toEqual({
      action: 'challenge',
      location: GATE_PATH,
    });
    expect(decideAccess({ pathname: '/playlists', cookie: 'nope' }, TOKEN)).toEqual({
      action: 'challenge',
      location: GATE_PATH,
    });
  });

  it('answers an API request without a cookie with 401 JSON, not a redirect', () => {
    expect(decideAccess({ pathname: '/api/recommend', search: '?seed=x' }, TOKEN)).toEqual({
      action: 'deny',
      message: INVITE_ONLY_MESSAGE,
    });
  });

  it('still lets the healthcheck and the gate page through', () => {
    expect(decideAccess({ pathname: '/api/health' }, TOKEN)).toEqual({ action: 'allow' });
    expect(decideAccess({ pathname: GATE_PATH }, TOKEN)).toEqual({ action: 'allow' });
  });

  it('grants on ?key= and redirects to the same URL without the key', () => {
    expect(decideAccess({ pathname: '/', search: `?key=${TOKEN}` }, TOKEN)).toEqual({
      action: 'grant',
      location: '/',
    });
    expect(
      decideAccess({ pathname: '/', search: `?seed=isrc%3AGB1&key=${TOKEN}` }, TOKEN),
    ).toEqual({ action: 'grant', location: '/?seed=isrc%3AGB1' });
    expect(
      decideAccess({ pathname: '/api/recommend', search: `?key=${TOKEN}&seed=x` }, TOKEN),
    ).toEqual({ action: 'grant', location: '/api/recommend?seed=x' });
  });

  it('lets a fresh key override a stale cookie', () => {
    expect(decideAccess({ pathname: '/', search: `?key=${TOKEN}`, cookie: 'old' }, TOKEN)).toEqual({
      action: 'grant',
      location: '/',
    });
  });

  it('treats a wrong key exactly like no key', () => {
    expect(decideAccess({ pathname: '/', search: '?key=guess' }, TOKEN)).toEqual({
      action: 'challenge',
      location: GATE_PATH,
    });
    expect(decideAccess({ pathname: '/api/search', search: '?key=guess' }, TOKEN)).toEqual({
      action: 'deny',
      message: INVITE_ONLY_MESSAGE,
    });
  });

  it('names the cookie `itstings` and builds the documented invite link', () => {
    expect(GATE_COOKIE).toBe('itstings');
    expect(inviteLink('https://itstings.fly.dev', TOKEN)).toBe(
      `https://itstings.fly.dev/?key=${TOKEN}`,
    );
  });
});

describe('run caps', () => {
  it('is unlimited when unset — the local single-user default', () => {
    expect(runCaps({})).toEqual({ perDay: null, perIpPerHour: null });
    expect(checkRunBudget({ day: 10_000, ipHour: 10_000 }, runCaps({}))).toEqual({ ok: true });
  });

  it('reads positive integers, and 0 means "no cap"', () => {
    expect(runCaps({ ITSTINGS_MAX_RUNS_PER_DAY: '60', ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR: '6' })).toEqual(
      { perDay: 60, perIpPerHour: 6 },
    );
    expect(runCaps({ ITSTINGS_MAX_RUNS_PER_DAY: '0' }).perDay).toBeNull();
  });

  it('falls back to the deployed default on a value that is not a number', () => {
    // A typo must not silently remove a spending limit.
    expect(runCaps({ ITSTINGS_MAX_RUNS_PER_DAY: 'sixty' }).perDay).toBe(DEFAULT_MAX_RUNS_PER_DAY);
    expect(runCaps({ ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR: '-3' }).perIpPerHour).toBe(
      DEFAULT_MAX_RUNS_PER_IP_PER_HOUR,
    );
  });

  it('allows the limit-th run and refuses the next one', () => {
    const caps = { perDay: 60, perIpPerHour: 6 };
    expect(checkRunBudget({ day: 59, ipHour: 5 }, caps)).toEqual({ ok: true });
    const verdict = checkRunBudget({ day: 60, ipHour: 0 }, caps);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.scope).toBe(SCOPE_DAY);
      expect(verdict.message).toBe("today's budget of 60 runs is used up — try tomorrow");
    }
  });

  it('reports the per-IP cap when only that one is blown', () => {
    const verdict = checkRunBudget({ day: 3, ipHour: 6 }, { perDay: 60, perIpPerHour: 6 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.scope).toBe(SCOPE_IP_HOUR);
      expect(verdict.message).toContain('6 runs from here');
    }
  });

  it('prefers the instance-wide sentence when both are blown', () => {
    const verdict = checkRunBudget({ day: 99, ipHour: 99 }, { perDay: 60, perIpPerHour: 6 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.scope).toBe(SCOPE_DAY);
  });
});

describe('counter buckets', () => {
  const t = Date.UTC(2026, 8, 6, 19, 44, 12);

  it('buckets by UTC day and hour', () => {
    expect(dayBucket(t)).toBe('2026-09-06');
    expect(hourBucket(t)).toBe('2026-09-06T19');
    expect(ipHourBucket('203.0.113.7', t)).toBe('203.0.113.7@2026-09-06T19');
  });

  it('gives an unknown IP one shared bucket rather than a free pass', () => {
    expect(ipHourBucket(null, t)).toBe('unknown@2026-09-06T19');
    expect(ipHourBucket('   ', t)).toBe('unknown@2026-09-06T19');
  });

  it('prefers fly-client-ip, then the first x-forwarded-for hop', () => {
    expect(clientIp(new Headers({ 'fly-client-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe(
      '203.0.113.7',
    );
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe('run_counters (the durable half)', () => {
  const now = Date.UTC(2026, 8, 6, 12, 0, 0);
  const caps = { perDay: 3, perIpPerHour: 2 };

  it('is created by migration 003', () => {
    const tables = (
      getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='run_counters'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toEqual(['run_counters']);
  });

  it('counts from zero and increments', () => {
    expect(counters.current(SCOPE_DAY, dayBucket(now))).toBe(0);
    expect(counters.increment(SCOPE_DAY, dayBucket(now), now)).toBe(1);
    expect(counters.increment(SCOPE_DAY, dayBucket(now), now)).toBe(2);
    expect(counters.current(SCOPE_DAY, dayBucket(now))).toBe(2);
  });

  it('charges both counters for an allowed run and neither for a refused one', () => {
    const ip = '203.0.113.7';
    expect(counters.consumeRunBudget(ip, now, caps)).toEqual({ ok: true });
    expect(counters.consumeRunBudget(ip, now, caps)).toEqual({ ok: true });
    expect(counters.countsFor(ip, now)).toEqual({ day: 2, ipHour: 2 });

    // Third run from this IP inside the hour: over the per-IP cap.
    const refused = counters.consumeRunBudget(ip, now, caps);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.scope).toBe(SCOPE_IP_HOUR);
    // Nothing was charged for the refusal.
    expect(counters.countsFor(ip, now)).toEqual({ day: 2, ipHour: 2 });

    // A different IP still has its own hour budget, up to the instance-wide cap of 3.
    expect(counters.consumeRunBudget('198.51.100.4', now, caps)).toEqual({ ok: true });
    const dayBlown = counters.consumeRunBudget('198.51.100.4', now, caps);
    expect(dayBlown.ok).toBe(false);
    if (!dayBlown.ok) expect(dayBlown.scope).toBe(SCOPE_DAY);
  });

  it('gives every IP a fresh bucket in the next hour and the instance one per day', () => {
    const ip = '203.0.113.7';
    counters.consumeRunBudget(ip, now, caps);
    counters.consumeRunBudget(ip, now, caps);
    const nextHour = now + 60 * 60 * 1000;
    expect(counters.countsFor(ip, nextHour)).toEqual({ day: 2, ipHour: 0 });
    const nextDay = now + 24 * 60 * 60 * 1000;
    expect(counters.countsFor(ip, nextDay)).toEqual({ day: 0, ipHour: 0 });
  });

  it('writes nothing at all when both caps are off', () => {
    expect(counters.consumeRunBudget('203.0.113.7', now, { perDay: null, perIpPerHour: null })).toEqual(
      { ok: true },
    );
    expect(counters.count()).toBe(0);
  });

  it('purges old buckets', () => {
    counters.increment(SCOPE_DAY, dayBucket(now), now);
    counters.increment(SCOPE_IP_HOUR, ipHourBucket('203.0.113.7', now), now);
    expect(counters.count()).toBe(2);
    expect(counters.purgeOlderThan(now + 1)).toBe(2);
    expect(counters.count()).toBe(0);
  });
});
