/**
 * The training endpoints — `POST /api/feedback`, `GET/POST /api/profile` — and the
 * recommend route's weight precedence, all called directly against the in-memory database.
 * No network, no model: the pipeline is mocked so the precedence test can read the options
 * the route hands it without running a real pipeline.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captured: null as unknown,
}));

// The recommend route's only heavy dependency. Mocked so we can assert the `weights` it
// resolves without spending a run or touching the network.
vi.mock('@/lib/engine/pipeline', () => ({
  ENGINE_VERSION: 'test-engine',
  runCacheHash: () => 'test-hash',
  runPipeline: async (args: { options: unknown }) => {
    mocks.captured = args.options;
    return {};
  },
}));

const feedbackRoute = await import('@/app/api/feedback/route');
const profileRoute = await import('@/app/api/profile/route');
const recommendRoute = await import('@/app/api/recommend/route');
const profilesRepo = await import('@/lib/db/repos/profiles');
const tracksRepo = await import('@/lib/db/repos/tracks');
const { getDb } = await import('@/lib/db');
const { DEFAULT_DIMENSION_WEIGHTS } = await import('@/lib/engine/rank');
const { PROFILE_COOKIE } = await import('@/lib/profile');

const ORIGIN = 'http://127.0.0.1:3000';
const PID = '33333333-3333-4333-8333-333333333333';

import type { SourceRef, TrackRecord } from '@/lib/types';

const SRC: SourceRef = { source: 'deezer' };

function track(key: string, bpm: number): TrackRecord {
  return {
    key,
    isrc: null,
    title: key,
    artist: 'Artist ' + key,
    album: null,
    year: null,
    durationMs: null,
    artwork: null,
    preview: null,
    tempoBpm: { value: bpm, source: SRC },
    keySignature: null,
    links: {},
    ids: {},
    tags: null,
    features: null,
    resolvedAt: 0,
    degraded: [],
  };
}

function postFeedback(body: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}/api/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cookieOf(response: Response, name: string): string | null {
  for (const line of response.headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) {
      const pair = line.split(';')[0];
      return decodeURIComponent(pair.slice(pair.indexOf('=') + 1));
    }
  }
  return null;
}

beforeEach(() => {
  getDb().exec('DELETE FROM feedback');
  getDb().exec('DELETE FROM profiles');
  getDb().exec('DELETE FROM tracks');
  getDb().exec('DELETE FROM runs');
  mocks.captured = null;
  // Two cached tracks: a bpm-identical "match" and a 60-bpm-away "not".
  tracksRepo.upsert(track('seed', 100));
  tracksRepo.upsert(track('cm', 100));
  tracksRepo.upsert(track('cf', 160));
});

describe('POST /api/feedback', () => {
  it('records a vote, learns weights, and returns { weights, count }', async () => {
    const res = await feedbackRoute.POST(
      postFeedback(
        { seedKey: 'seed', candidateKey: 'cm', label: 'match', source: 'card' },
        `${PROFILE_COOKIE}=${PID}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { weights: Record<string, number>; count: number };
    expect(body.count).toBe(1);
    // A single match on a bpm-identical track pushes rhythmic_character above its default.
    expect(body.weights.rhythmic_character).toBeGreaterThan(
      DEFAULT_DIMENSION_WEIGHTS.rhythmic_character,
    );
    // Persisted on the profile.
    expect(profilesRepo.get(PID)?.feedbackCount).toBe(1);
  });

  it('mints and sets the profile cookie when the request has none', async () => {
    const res = await feedbackRoute.POST(
      postFeedback({ seedKey: 'seed', candidateKey: 'cm', label: 'match', source: 'card' }),
    );
    const id = cookieOf(res, PROFILE_COOKIE);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const line = res.headers.getSetCookie().find((l) => l.startsWith(PROFILE_COOKIE));
    expect(line).toContain('HttpOnly');
    expect(line?.toLowerCase()).toContain('samesite=lax');
    // Plain http in the test -> not Secure (localhost must stay usable).
    expect(line).not.toContain('Secure');
  });

  it('upserts a re-vote on the same pair (count stays 1) and re-learns', async () => {
    const cookie = `${PROFILE_COOKIE}=${PID}`;
    await feedbackRoute.POST(
      postFeedback({ seedKey: 'seed', candidateKey: 'cm', label: 'match', source: 'card' }, cookie),
    );
    const res2 = await feedbackRoute.POST(
      postFeedback({ seedKey: 'seed', candidateKey: 'cm', label: 'not', source: 'card' }, cookie),
    );
    const body = (await res2.json()) as { count: number };
    expect(body.count).toBe(1);
  });

  it('keeps two browsers independent', async () => {
    const other = '44444444-4444-4444-8444-444444444444';
    await feedbackRoute.POST(
      postFeedback(
        { seedKey: 'seed', candidateKey: 'cm', label: 'match', source: 'card' },
        `${PROFILE_COOKIE}=${PID}`,
      ),
    );
    expect(profilesRepo.get(PID)?.feedbackCount).toBe(1);
    expect(profilesRepo.get(other)).toBeNull();
  });

  it('rejects a bad body with 400', async () => {
    const res = await feedbackRoute.POST(
      postFeedback({ seedKey: 'seed', label: 'match' }, `${PROFILE_COOKIE}=${PID}`),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/profile', () => {
  it('returns the untrained defaults and sets a cookie for a fresh browser', () => {
    const res = profileRoute.GET(new Request(`${ORIGIN}/api/profile`));
    expect(res.status).toBe(200);
    expect(cookieOf(res, PROFILE_COOKIE)).toMatch(/^[0-9a-f-]{36}$/);
    // No row was created just by looking.
    expect(profilesRepo.count()).toBe(0);
  });

  it('reflects a trained profile', async () => {
    profilesRepo.setWeights(PID, { rhythmic_character: 9 }, 3, 1000);
    const res = profileRoute.GET(
      new Request(`${ORIGIN}/api/profile`, { headers: { cookie: `${PROFILE_COOKIE}=${PID}` } }),
    );
    const body = (await res.json()) as { id: string; weights: Record<string, number>; count: number };
    expect(body.id).toBe(PID);
    expect(body.weights).toEqual({ rhythmic_character: 9 });
    expect(body.count).toBe(3);
  });
});

describe('POST /api/profile', () => {
  it('saves a display name and returns the profile', async () => {
    const res = await profileRoute.POST(
      new Request(`${ORIGIN}/api/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: `${PROFILE_COOKIE}=${PID}` },
        body: JSON.stringify({ displayName: 'Ada' }),
      }),
    );
    const body = (await res.json()) as { displayName: string | null };
    expect(body.displayName).toBe('Ada');
    expect(profilesRepo.get(PID)?.displayName).toBe('Ada');
  });
});

describe('GET /api/recommend — weight precedence', () => {
  const recommend = (query: string, cookie?: string) =>
    recommendRoute.GET(
      new Request(`${ORIGIN}/api/recommend?${query}`, cookie ? { headers: { cookie } } : undefined),
    );

  async function optionsFrom(res: Response): Promise<{ weights?: Record<string, number> }> {
    // Drain the SSE stream so the (mocked) pipeline runs and captures the options.
    await res.text();
    return mocks.captured as { weights?: Record<string, number> };
  }

  it('uses the profile learned weights when no explicit ?weights is given', async () => {
    profilesRepo.setWeights(PID, { rhythmic_character: 8 }, 5, 1000);
    const opts = await optionsFrom(recommend('seed=seed', `${PROFILE_COOKIE}=${PID}`));
    expect(opts.weights).toEqual({ rhythmic_character: 8 });
  });

  it('lets an explicit ?weights override the profile learned weights', async () => {
    profilesRepo.setWeights(PID, { rhythmic_character: 8 }, 5, 1000);
    const explicit = encodeURIComponent(JSON.stringify({ era: 10 }));
    const opts = await optionsFrom(recommend(`seed=seed&weights=${explicit}`, `${PROFILE_COOKIE}=${PID}`));
    expect(opts.weights).toEqual({ era: 10 });
  });

  it('passes no weights (so rank falls back to DEFAULT) for an untrained browser', async () => {
    const opts = await optionsFrom(recommend('seed=seed', `${PROFILE_COOKIE}=${PID}`));
    expect(opts.weights).toBeUndefined();
  });
});
