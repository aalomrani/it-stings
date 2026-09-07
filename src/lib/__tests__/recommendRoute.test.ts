/**
 * `GET /api/recommend` — the two things the route decides before the pipeline runs.
 *
 *   1. THE COST CAPS (docs/tasks/phase7-ship.md §5, Part B): a run that will execute is
 *      charged; a run the `runs` cache will replay is not; a refusal is an `error` event
 *      on a normal stream, with the human sentence `@/lib/gate` writes.
 *   2. THE PREVIOUS FINGERPRINT (phase3-engine review, F15): when the listener has struck
 *      a field, Stage 2 is handed the fingerprint of the last run for that seed — the one
 *      that was on screen when they struck it.
 *
 * The pipeline itself is stubbed: nothing here may reach the model or the network. The
 * cache lookup and the counters are real, against the in-memory database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Fingerprint, RunOptions, RunRecord, TrackRecord } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  env: {
    lastfmApiKey: undefined,
    tavilyApiKey: undefined,
    braveApiKey: undefined,
    spotifyClientId: undefined,
    spotifyClientSecret: undefined,
    getsongbpmApiKey: undefined,
    anthropicApiKey: undefined,
    keys: { websearch: null, anthropic: false },
  },
  runPipeline: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env, keys: mocks.env.keys }));
vi.mock('@/lib/engine/pipeline', async () => {
  const actual = await vi.importActual<typeof import('@/lib/engine/pipeline')>(
    '@/lib/engine/pipeline',
  );
  return { ...actual, runPipeline: mocks.runPipeline };
});

const route = await import('@/app/api/recommend/route');
const pipeline = await import('@/lib/engine/pipeline');
const runsRepo = await import('@/lib/db/repos/runs');
const counters = await import('@/lib/db/repos/counters');
const { getDb } = await import('@/lib/db');
const { parseSseFrames } = await import('@/lib/sse');

const SEED = 'isrc:GBAAM8300010';

function track(): TrackRecord {
  return {
    key: SEED,
    isrc: 'GBAAM8300010',
    title: 'The Lovecats',
    artist: 'The Cure',
    album: 'Japanese Whispers',
    year: { value: 1983, source: { source: 'musicbrainz', field: 'first-release-date' } },
    durationMs: { value: 217000, source: { source: 'itunes', field: 'trackTimeMillis' } },
    artwork: null,
    preview: null,
    tempoBpm: null,
    keySignature: null,
    links: {},
    ids: {},
    tags: null,
    features: null,
    resolvedAt: 1_757_000_000_000,
    degraded: [],
  };
}

function fingerprint(vocal: string): Fingerprint {
  return {
    tempo_bpm: null,
    tempo_feel: 'bouncing',
    rhythmic_character: 'swung shuffle, upright bass walking in quarters',
    instrumentation: ['upright bass', 'brushed kit'],
    vocal_delivery: vocal,
    harmonic_language: 'minor-key jazz voicings',
    emotional_register: 'arch, flirtatious',
    production_texture: 'roomy 1983 analogue',
    era: 1983,
    scene_context: 'post-punk band deliberately playing lounge jazz',
    signature_hook: 'the meowing',
    genre_labels: ['post-punk', 'jazz pop'],
    confidence: {
      tempo_feel: 'high',
      rhythmic_character: 'high',
      instrumentation: 'medium',
      vocal_delivery: 'high',
      harmonic_language: 'medium',
      emotional_register: 'high',
      production_texture: 'medium',
      scene_context: 'high',
      signature_hook: 'high',
    },
    grounded_on: ['Deezer bpm 132'],
    model: 'claude-opus-5',
  };
}

function runRecord(options: RunOptions, fp: Fingerprint, createdAt: number): RunRecord {
  return {
    id: `run_${createdAt}`,
    seed: track(),
    options,
    fingerprint: fp,
    results: [],
    degraded: [],
    stats: {
      perChannel: {
        A: { found: 0, verified: 0, dropped: 0 },
        B: { found: 0, verified: 0, dropped: 0 },
        C: { found: 0, verified: 0, dropped: 0 },
      },
      durationMs: 1,
      modelCalls: 0,
    },
    engineVersion: pipeline.ENGINE_VERSION,
    createdAt,
  };
}

const url = (query: string) => new Request(`http://localhost/api/recommend?${query}`);
const fromIp = (query: string, ip: string) =>
  new Request(`http://localhost/api/recommend?${query}`, { headers: { 'x-forwarded-for': ip } });

/** Reads a whole SSE response body into its parsed events. */
async function events(res: Response): Promise<{ type: string; message?: string }[]> {
  const body = await res.text();
  return parseSseFrames(body).data.map((d) => JSON.parse(d) as { type: string; message?: string });
}

beforeEach(() => {
  getDb().exec('DELETE FROM runs; DELETE FROM run_counters;');
  mocks.runPipeline.mockReset();
  mocks.runPipeline.mockImplementation(
    async (args: { onEvent: (e: unknown) => void }): Promise<void> => {
      args.onEvent({ type: 'stage', stage: 'done', status: 'done' });
    },
  );
  delete process.env.ITSTINGS_MAX_RUNS_PER_DAY;
  delete process.env.ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR;
});

afterEach(() => {
  delete process.env.ITSTINGS_MAX_RUNS_PER_DAY;
  delete process.env.ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR;
});

describe('the cost caps', () => {
  it('charges nothing, and writes no counter row, when nothing is capped', async () => {
    const res = route.GET(url(`seed=${encodeURIComponent(SEED)}`));
    await events(res);

    expect(mocks.runPipeline).toHaveBeenCalledTimes(1);
    expect(counters.count()).toBe(0);
  });

  it('charges one run per execution and refuses the run after the day budget', async () => {
    process.env.ITSTINGS_MAX_RUNS_PER_DAY = '2';

    for (const seed of ['a', 'b']) {
      const res = route.GET(url(`seed=${seed}`));
      const seen = await events(res);
      expect(seen.some((e) => e.type === 'error')).toBe(false);
    }
    expect(mocks.runPipeline).toHaveBeenCalledTimes(2);

    const res = route.GET(url('seed=c'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const seen = await events(res);

    // The protocol's own `error` event, carrying a human sentence, and then the close.
    expect(seen).toEqual([
      { type: 'error', message: "today's budget of 2 runs is used up — try tomorrow" },
    ]);
    // Refused means not run, and not charged: the third request added nothing.
    expect(mocks.runPipeline).toHaveBeenCalledTimes(2);
  });

  it('refuses on the per-IP hour budget, and only for that address', async () => {
    process.env.ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR = '1';

    await events(route.GET(fromIp('seed=a', '203.0.113.7')));
    const blocked = await events(route.GET(fromIp('seed=b', '203.0.113.7')));
    expect(blocked).toEqual([
      { type: 'error', message: "that's 1 runs from here in the last hour — give it a little while" },
    ]);

    // A different address has its own bucket and still runs.
    const other = await events(route.GET(fromIp('seed=c', '198.51.100.9')));
    expect(other.some((e) => e.type === 'error')).toBe(false);
    expect(mocks.runPipeline).toHaveBeenCalledTimes(2);
  });

  it('does not charge a run the cache will replay', async () => {
    process.env.ITSTINGS_MAX_RUNS_PER_DAY = '1';
    const options: RunOptions = { includeSameArtist: false };
    runsRepo.save(runRecord(options, fingerprint('a dry sung-spoken deadpan'), 10), pipeline.runCacheHash(options));

    // Twice: a replay costs nothing, so the budget of one is still untouched afterwards.
    await events(route.GET(url(`seed=${encodeURIComponent(SEED)}`)));
    await events(route.GET(url(`seed=${encodeURIComponent(SEED)}`)));
    expect(counters.count()).toBe(0);

    // And the one run that IS a run still gets to happen.
    const seen = await events(route.GET(url('seed=something-else')));
    expect(seen.some((e) => e.type === 'error')).toBe(false);
  });
});

describe('corrections', () => {
  it('hands Stage 2 the fingerprint of the latest run for the seed', async () => {
    const uncorrected: RunOptions = { includeSameArtist: false };
    runsRepo.save(
      runRecord(uncorrected, fingerprint('the original reading'), 10),
      pipeline.runCacheHash(uncorrected),
    );
    const corrected: RunOptions = {
      includeSameArtist: false,
      corrections: { vocal_delivery: 'wrong' },
    };
    runsRepo.save(
      runRecord(corrected, fingerprint('the reading they rejected again'), 20),
      pipeline.runCacheHash(corrected),
    );

    const corrections = encodeURIComponent(JSON.stringify({ vocal_delivery: 'wrong', tempo_feel: 'wrong' }));
    await events(route.GET(url(`seed=${encodeURIComponent(SEED)}&corrections=${corrections}`)));

    const args = mocks.runPipeline.mock.calls[0][0] as { previous?: Fingerprint | null };
    // The NEWEST run's fingerprint, not the uncorrected one still in `fingerprints`.
    expect(args.previous?.vocal_delivery).toBe('the reading they rejected again');
  });

  it('passes no previous fingerprint when nothing was struck', async () => {
    runsRepo.save(
      runRecord({ includeSameArtist: false }, fingerprint('the original reading'), 10),
      'some-other-hash',
    );
    await events(route.GET(url(`seed=${encodeURIComponent(SEED)}`)));

    const args = mocks.runPipeline.mock.calls[0][0] as { previous?: Fingerprint | null };
    expect(args.previous).toBeUndefined();
  });

  it('still 400s on corrections that are not the documented shape', async () => {
    const res = route.GET(url(`seed=${encodeURIComponent(SEED)}&corrections=not-json`));
    expect(res.status).toBe(400);
    expect(mocks.runPipeline).not.toHaveBeenCalled();
  });
});
