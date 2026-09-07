/**
 * The pipeline is a protocol before it is an engine: the UI is written against the event
 * ORDER in docs/architecture.md ("Streaming protocol"), and every stage below it can fail.
 * So these tests assert the sequence, the cache replay, the multi-channel merge, the
 * Channel-C tightening guard, every degrade path and abort — with all five stages injected
 * and no network, no database beyond the in-memory one, and no model.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/lib/db';
import * as runsRepo from '@/lib/db/repos/runs';
import type { ChannelContext } from '@/lib/engine/channels/types';
import type { FingerprintResult } from '@/lib/engine/fingerprint';
import {
  BAD_API_KEY_DEGRADED,
  BILLING_DEGRADED,
  ENGINE_VERSION,
  OVERLOADED_DEGRADED,
  RATE_LIMITED_DEGRADED,
  PipelineAbortError,
  modelUnavailable,
  plainReason,
  runCacheHash,
  runCacheInputs,
  runPipeline,
  type ChannelOutcome,
  type PipelineDeps,
  type VerifiedCandidate,
} from '@/lib/engine/pipeline';
import { ACCOUNT_FAILURE_REASONS } from '@/lib/engine/model';
import { PICK_TAGS_PROMPT_VERSION } from '@/lib/engine/channels/a';
import { CHANNEL_B_PROMPT_VERSION } from '@/lib/engine/channels/b';
import { CHANNEL_C_PROMPT_VERSION } from '@/lib/engine/channels/c';
import { FINGERPRINT_PROMPT_VERSION, fingerprintTrack } from '@/lib/engine/fingerprint';
import { SCORED_DIMENSIONS } from '@/lib/engine/rank';
import { SCORE_PROMPT_VERSION, scoreBatch } from '@/lib/engine/score';
import type { ScoredCandidate } from '@/lib/engine/score';
import { FINGERPRINT_CONFIDENCE_KEYS, type Candidate, type Channel, type Evidence, type Fingerprint, type PipelineEvent, type SourceRef, type TrackRecord } from '@/lib/types';
import { trackNormKey } from '@/lib/util/normalize';

/* ------------------------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------------------------ */

function track(over: {
  key: string;
  artist: string;
  title: string;
  year?: number;
  bpm?: number;
}): TrackRecord {
  return {
    key: over.key,
    isrc: null,
    title: over.title,
    artist: over.artist,
    album: null,
    year: over.year ? { value: over.year, source: { source: 'musicbrainz' } } : null,
    durationMs: null,
    artwork: null,
    preview: null,
    tempoBpm: over.bpm ? { value: over.bpm, source: { source: 'deezer' } } : null,
    keySignature: null,
    links: {},
    ids: {},
    tags: null,
    features: null,
    resolvedAt: 1_700_000_000_000,
    degraded: [],
  };
}

const SEED = track({
  key: 'isrc:GBAAM8300010',
  artist: 'The Cure',
  title: 'The Lovecats',
  year: 1983,
  bpm: 132,
});

const FINGERPRINT: Fingerprint = {
  tempo_bpm: 132,
  tempo_feel: 'bouncing',
  rhythmic_character: 'swung shuffle, upright bass walking in quarters',
  instrumentation: ['upright bass', 'brushed kit'],
  vocal_delivery: 'playful, affected, breaks into scat',
  harmonic_language: 'minor-key jazz voicings',
  emotional_register: 'arch, flirtatious',
  production_texture: 'roomy analogue, live-feeling',
  era: 1983,
  scene_context: 'post-punk band deliberately playing lounge jazz',
  signature_hook: 'the meowing',
  genre_labels: ['jazz-pop', 'new wave'],
  confidence: Object.fromEntries(
    FINGERPRINT_CONFIDENCE_KEYS.map((k) => [k, 'medium' as const]),
  ) as Fingerprint['confidence'],
  grounded_on: ['tempo 132 BPM (Deezer)'],
  model: 'claude-opus-5',
};

const candidate = (
  artist: string,
  title: string,
  channel: Channel,
  hints: Candidate['hints'] = [],
): Candidate => ({ artist, title, channels: [channel], hints });

/** A channel result with everything the pipeline reads. */
function channelResult(
  channel: Channel,
  over: Partial<ChannelOutcome> = {},
): ChannelOutcome {
  return { channel, status: 'done', candidates: [], live: true, ...over };
}

/**
 * A scored candidate strong enough to survive `rank.ts`: nine real dimensions and two
 * concrete traits, so rule 4 (the genre-only cut) has nothing to cut.
 */
function scored(key: string, over: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    key,
    dimensions: SCORED_DIMENSIONS.map((dimension) => ({
      dimension,
      score: 0.8,
      note: 'walking upright bass under the vocal',
    })),
    why: 'both walk an upright bass in quarters while the singer slides into nonsense syllables',
    whyDiscriminates: 'Glenn Miller — In the Mood',
    sharedTraits: ['walking upright bass in quarters', 'vocal slides into nonsense syllables'],
    isCoverOrSameSong: false,
    flags: [],
    ...over,
  };
}

/** artist|title -> the TrackRecord Stage 4 answers with. Anything else fails to verify. */
function catalogue(entries: [string, string, string][]): Map<string, TrackRecord> {
  const map = new Map<string, TrackRecord>();
  for (const [artist, title, key] of entries) {
    map.set(trackNormKey(artist, title), track({ key, artist, title, year: 1997 }));
  }
  return map;
}

const DEFAULT_CATALOGUE = catalogue([
  ['Squirrel Nut Zippers', 'Hell', 'deezer:1'],
  ['Cherry Poppin Daddies', 'Zoot Suit Riot', 'deezer:2'],
  ['Louis Prima', 'Jump Jive an Wail', 'deezer:3'],
]);

interface FakeOptions {
  fingerprint?: PipelineDeps['fingerprint'];
  channels?: Partial<PipelineDeps['channels']>;
  verify?: Map<string, TrackRecord>;
  verifyMany?: PipelineDeps['verifyMany'];
  score?: PipelineDeps['score'];
  resolveTrack?: PipelineDeps['resolveTrack'];
}

/**
 * Deps that answer instantly: A and C each find one track, B skips honestly because this
 * seed has too few usable tags for a MusicBrainz cohort — exactly how the keyless Channel B
 * (channels/b.ts) skips. No key is involved; Channel B needs none.
 */
function deps(over: FakeOptions = {}): Partial<PipelineDeps> {
  const known = over.verify ?? DEFAULT_CATALOGUE;
  return {
    resolveTrack: over.resolveTrack ?? (async () => SEED),
    fingerprint:
      over.fingerprint
      ?? (async (): Promise<FingerprintResult> => ({
        ok: true,
        fingerprint: FINGERPRINT,
        cached: false,
      })),
    channels: {
      A: async () =>
        channelResult('A', {
          candidates: [candidate('Squirrel Nut Zippers', 'Hell', 'A', [{ lastfmMatch: 0.42 }])],
        }),
      B: async () =>
        channelResult('B', {
          status: 'skipped',
          reason: 'fewer than 2 usable tags on the seed',
          live: false,
        }),
      C: async () =>
        channelResult('C', {
          candidates: [
            candidate('Cherry Poppin Daddies', 'Zoot Suit Riot', 'C', [
              { modelNote: 'same brushed shuffle' },
            ]),
          ],
        }),
      ...over.channels,
    },
    verifyMany:
      over.verifyMany
      ?? (async (candidates, opts) => {
        const out: VerifiedCandidate[] = [];
        for (const c of candidates) {
          const found = known.get(trackNormKey(c.artist, c.title));
          if (!found) continue;
          const verified = { candidate: c, track: found };
          out.push(verified);
          opts?.onVerified?.(verified);
        }
        return out;
      }),
    score:
      over.score
      ?? (async (_seed, _fp, candidates) => ({
        scored: candidates.map((c) => scored(c.track.key)),
        failed: [],
      })),
  };
}

/** A compact label per event, so an order assertion reads like the protocol document. */
function label(event: PipelineEvent): string {
  switch (event.type) {
    case 'run':
      return `run:${event.cached ? 'cached' : 'fresh'}`;
    case 'stage':
      return `stage:${event.stage}:${event.status}`;
    case 'channel':
      return `channel:${event.channel}:${event.status}`;
    case 'verified':
      return `verified:${event.channel}`;
    case 'result':
      return `result:${event.item.track.key}`;
    default:
      return event.type;
  }
}

async function run(
  args: {
    seedKey?: string;
    includeSameArtist?: boolean;
    deps?: Partial<PipelineDeps>;
    signal?: AbortSignal;
    force?: boolean;
  } = {},
) {
  const events: PipelineEvent[] = [];
  const record = await runPipeline({
    seedKey: args.seedKey ?? SEED.key,
    options: { includeSameArtist: args.includeSameArtist ?? false },
    onEvent: (e) => events.push(e),
    signal: args.signal,
    force: args.force,
    deps: args.deps ?? deps(),
  });
  return { events, record, labels: events.map(label) };
}

beforeEach(() => {
  // Each test gets a fresh in-memory database, so the run cache starts empty.
  closeDb();
});

/* ------------------------------------------------------------------------------------ *
 * The event sequence
 * ------------------------------------------------------------------------------------ */

describe('event order (docs/architecture.md, "Streaming protocol")', () => {
  it('emits exactly the documented sequence', async () => {
    const { labels } = await run();
    expect(labels).toEqual([
      'run:fresh',
      'stage:resolve:start',
      'seed',
      'stage:resolve:done',
      'stage:fingerprint:start',
      'fingerprint',
      'stage:fingerprint:done',
      'stage:channels:start',
      // All three starts go out as the channels are launched, in A/B/C order.
      'channel:A:start',
      'channel:B:start',
      'channel:C:start',
      // Then each channel's tail, in completion order: terminal status, its provisional
      // results, then the tally — `kept`/`dropped` is not knowable until Stage 4 is done.
      'channel:A:done',
      'result:deezer:1',
      'verified:A',
      // A skipped channel emits no results and no tally.
      'channel:B:skipped',
      'channel:C:done',
      'result:deezer:2',
      'verified:C',
      'stage:channels:done',
      'stage:rank:start',
      'stage:rank:done',
      'final',
      'stage:done:done',
    ]);
  });

  it('the seed and fingerprint events carry the resolved record and Stage 2 output', async () => {
    const { events } = await run();
    expect(events.find((e) => e.type === 'seed')).toEqual({ type: 'seed', track: SEED });
    expect(events.find((e) => e.type === 'fingerprint')).toEqual({
      type: 'fingerprint',
      fingerprint: FINGERPRINT,
    });
  });

  it('final carries the per-channel stats, the cut list and the token spend', async () => {
    const { events, record } = await run({
      deps: deps({
        score: async (_seed, _fp, candidates, ctx: ChannelContext) => {
          ctx.usage.record({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900 });
          return { scored: candidates.map((c) => scored(c.track.key)), failed: [] };
        },
      }),
    });

    const final = events.find((e) => e.type === 'final');
    expect(final?.type === 'final' && final.results).toHaveLength(2);
    expect(record.stats.perChannel.A).toMatchObject({ found: 1, verified: 1, dropped: 0 });
    expect(record.stats.perChannel.B.skipped).toBe('fewer than 2 usable tags on the seed');
    expect(record.stats.perChannel.C).toMatchObject({ found: 1, verified: 1, dropped: 0 });
    // Two channels, two score calls, both recorded into the run's accumulator.
    expect(record.stats.modelCalls).toBe(2);
    expect(record.stats.tokens).toEqual({
      input: 200,
      output: 40,
      cacheRead: 1800,
      cacheCreation: 0,
    });
    expect(record.stats.cut).toEqual([]);
    expect(record.engineVersion).toBe(ENGINE_VERSION);
  });

  it('counts candidates that failed verification as dropped', async () => {
    const { events, record } = await run({
      deps: deps({
        channels: {
          A: async () =>
            channelResult('A', {
              candidates: [
                candidate('Squirrel Nut Zippers', 'Hell', 'A'),
                candidate('A Band That Does Not Exist', 'Nor This Song', 'A'),
              ],
            }),
        },
      }),
    });
    expect(events.find((e) => e.type === 'verified')).toEqual({
      type: 'verified',
      channel: 'A',
      kept: 1,
      dropped: 1,
    });
    expect(record.stats.perChannel.A).toMatchObject({ found: 2, verified: 1, dropped: 1 });
  });

  it('a channel that errors emits channel error, no tally, and a degraded line', async () => {
    const { labels, record } = await run({
      deps: deps({
        channels: {
          A: async () => {
            throw new Error('last.fm is down');
          },
        },
      }),
    });
    expect(labels).toContain('channel:A:error');
    expect(labels).not.toContain('verified:A');
    expect(labels.at(-1)).toBe('stage:done:done');
    expect(record.degraded.join('\n')).toMatch(/Channel A failed: last\.fm is down/);
  });
});

/* ------------------------------------------------------------------------------------ *
 * The pool: dedupe, evidence, seed exclusion
 * ------------------------------------------------------------------------------------ */

describe('the candidate pool', () => {
  const twoChannelDeps = () =>
    deps({
      channels: {
        A: async () =>
          channelResult('A', {
            candidates: [candidate('Squirrel Nut Zippers', 'Hell', 'A', [{ lastfmMatch: 0.42 }])],
            evidence: {
              [trackNormKey('Squirrel Nut Zippers', 'Hell')]: [
                {
                  channel: 'A',
                  kind: 'lastfm_similar',
                  detail: 'Last.fm match 0.42 · rank 1 of 60',
                  url: 'https://www.last.fm/music/x',
                },
              ],
            } as Record<string, Evidence[]>,
          }),
        C: async () =>
          channelResult('C', {
            candidates: [
              // The same recording, found again by another channel.
              candidate('Squirrel Nut Zippers', 'Hell', 'C', [{ modelNote: 'brushed shuffle' }]),
            ],
          }),
      },
    });

  it('scores a track found by two channels once and gives it both chips', async () => {
    const score = vi.fn(async (_seed, _fp, candidates: VerifiedCandidate[]) => ({
      scored: candidates.map((c) => scored(c.track.key)),
      failed: [],
    }));
    const { events, record } = await run({
      deps: { ...twoChannelDeps(), score },
    });

    // Scored ONCE: the second channel adds a chip, it does not re-verify or re-score.
    const scoredKeys = score.mock.calls.flatMap((call) => call[2].map((c) => c.track.key));
    expect(scoredKeys).toEqual(['deezer:1']);

    expect(record.results).toHaveLength(1);
    expect(record.results[0].channels).toEqual(['A', 'C']);
    expect(record.results[0].flags).toContain('multi-channel');

    // Two provisional results for one track: the first when it was scored, the second the
    // moment Channel C added its chip, so the UI can render the new one immediately.
    const results = events.filter((e) => e.type === 'result');
    expect(results).toHaveLength(2);
    expect(results[0].type === 'result' && results[0].item.channels).toEqual(['A']);
    expect(results[1].type === 'result' && results[1].item.channels).toEqual(['A', 'C']);
    // The multi-channel bonus is on the second one (rule 3: +0.12 per extra channel).
    const first = results[0].type === 'result' ? results[0].item.finalScore : 0;
    const second = results[1].type === 'result' ? results[1].item.finalScore : 0;
    expect(second).toBeGreaterThan(first);
  });

  it('carries each channel’s evidence onto the recommendation', async () => {
    const { record } = await run({ deps: twoChannelDeps() });
    const rec = record.results[0];
    expect(rec.evidence).toEqual([
      {
        channel: 'A',
        kind: 'lastfm_similar',
        detail: 'Last.fm match 0.42 · rank 1 of 60',
        url: 'https://www.last.fm/music/x',
      },
      // Channel C ships no evidence index; its `modelNote` becomes the model_prior row.
      { channel: 'C', kind: 'model_prior', detail: 'brushed shuffle' },
    ]);
  });

  it('drops the seed itself, by name and by verified track key', async () => {
    const verify = catalogue([
      ['Squirrel Nut Zippers', 'Hell', 'deezer:1'],
      // A different spelling of the seed that verifies back to the seed's own record.
      ['The Cure', 'The Love Cats', SEED.key],
    ]);
    const { record } = await run({
      deps: deps({
        verify,
        channels: {
          A: async () =>
            channelResult('A', {
              candidates: [
                candidate('The Cure', 'The Lovecats', 'A'), // the seed, by name
                candidate('The Cure', 'The Love Cats', 'A'), // the seed, by track key
                candidate('Squirrel Nut Zippers', 'Hell', 'A'),
              ],
            }),
        },
      }),
    });
    expect(record.results.map((r) => r.track.key)).toEqual(['deezer:1']);
    expect(record.stats.perChannel.A).toMatchObject({ found: 3, verified: 1, dropped: 2 });
  });

  it('never emits a same-artist track as a provisional result, and records the cut', async () => {
    const verify = catalogue([
      ['The Cure', 'Close To Me', 'deezer:cure'],
      ['Squirrel Nut Zippers', 'Hell', 'deezer:1'],
    ]);
    const { events, record } = await run({
      deps: deps({
        verify,
        channels: {
          A: async () =>
            channelResult('A', {
              candidates: [
                candidate('The Cure', 'Close To Me', 'A'),
                candidate('Squirrel Nut Zippers', 'Hell', 'A'),
              ],
            }),
        },
      }),
    });
    expect(events.filter((e) => e.type === 'result').map(label)).toEqual(['result:deezer:1']);
    expect(record.results.map((r) => r.track.key)).toEqual(['deezer:1']);
    expect(record.stats.cut).toContainEqual({
      key: 'deezer:cure',
      artist: 'The Cure',
      title: 'Close To Me',
      reason: 'same-artist',
    });
  });
});

/* ------------------------------------------------------------------------------------ *
 * Channel C's tightening guard (spec: "if Channel C's drop rate exceeds ~20%")
 * ------------------------------------------------------------------------------------ */

describe('the Channel-C drop-rate guard', () => {
  const wide = ['Louis Prima', 'Jump Jive an Wail'] as const;

  function cDeps(cFn: PipelineDeps['channels']['C']) {
    return deps({
      channels: {
        A: async () => channelResult('A', { status: 'skipped', reason: 'no LASTFM_API_KEY' }),
        C: cFn,
      },
    });
  }

  it('re-runs C once with the stricter prompt when too much of it does not exist', async () => {
    const calls: (string | undefined)[] = [];
    const C: PipelineDeps['channels']['C'] = async (_seed, _fp, _ctx, opts) => {
      calls.push(opts?.tightness);
      if (opts?.tightness === 'tight') {
        return channelResult('C', { candidates: [candidate(wide[0], wide[1], 'C')] });
      }
      return channelResult('C', {
        candidates: [
          candidate('Squirrel Nut Zippers', 'Hell', 'C'),
          candidate('Invented Artist', 'Invented Song', 'C'),
          candidate('Another Invention', 'Also Not Real', 'C'),
        ],
      });
    };

    const { record, labels } = await run({ deps: cDeps(C) });

    expect(calls).toEqual(['normal', 'tight']);
    // One `channel C` block and one tally, covering both passes.
    expect(labels.filter((l) => l.startsWith('channel:C'))).toEqual([
      'channel:C:start',
      'channel:C:done',
    ]);
    expect(labels.filter((l) => l === 'verified:C')).toHaveLength(1);
    expect(record.stats.channelCRetry).toEqual({
      firstDropRate: 0.667,
      retryDropRate: 0,
      added: 1,
    });
    expect(record.stats.perChannel.C).toMatchObject({ found: 4, verified: 2 });
    expect(record.results.map((r) => r.track.key).sort()).toEqual(['deezer:1', 'deezer:3']);
    expect(record.degraded.join('\n')).toMatch(/Channel C drop rate 67%/);
  });

  it('leaves C alone when its drop rate is inside the budget', async () => {
    const calls: (string | undefined)[] = [];
    const C: PipelineDeps['channels']['C'] = async (_seed, _fp, _ctx, opts) => {
      calls.push(opts?.tightness);
      return channelResult('C', {
        candidates: [
          candidate('Squirrel Nut Zippers', 'Hell', 'C'),
          candidate('Cherry Poppin Daddies', 'Zoot Suit Riot', 'C'),
          candidate('Louis Prima', 'Jump Jive an Wail', 'C'),
        ],
      });
    };
    const { record } = await run({ deps: cDeps(C) });
    expect(calls).toEqual(['normal']);
    expect(record.stats.channelCRetry).toEqual({ firstDropRate: 0, retryDropRate: null, added: 0 });
  });
});

/* ------------------------------------------------------------------------------------ *
 * Degrading
 * ------------------------------------------------------------------------------------ */

describe('degrading', () => {
  it('a ZERO-KEY run still produces results and never emits the no-key line', async () => {
    // The keyless engine: the default deps run every stage deterministically (Channel B
    // skips because this seed has too few tags for a MusicBrainz cohort — no key involved,
    // exactly as a real keyless run would), so the run must still return a non-empty list
    // and its degraded[] must not contain the old
    // "recommendations unavailable: no ANTHROPIC_API_KEY" wording anywhere.
    const { record } = await run({ deps: deps() });

    expect(record.fingerprint).not.toBeNull();
    expect(record.results.length).toBeGreaterThan(0);
    expect(record.stats.modelCalls).toBe(0);
    const degraded = record.degraded.join('\n');
    expect(degraded).not.toMatch(/no ANTHROPIC_API_KEY/i);
    expect(degraded).not.toMatch(/recommendations unavailable/i);
  });

  it('drives the REAL deterministic Stage 2 + Stage 5 end to end and still ranks a list', async () => {
    // The zero-key test above fakes fingerprint + score for speed; this one wires the ACTUAL
    // `fingerprintTrack` and `scoreBatch` (only resolve/verify/channels are stubbed to hand
    // back rich TrackRecords), so it proves the real scorer's dimension outputs clear rank
    // rule 4 through the pipeline — not just piecemeal in the unit suites.
    const abSrc: SourceRef = { source: 'acousticbrainz' };
    const richSeed: TrackRecord = {
      ...SEED,
      tempoBpm: { value: 120, source: { source: 'deezer' } },
      keySignature: { value: 'A minor', source: abSrc },
      tags: {
        value: [
          { name: 'post-punk', count: 8 },
          { name: 'new wave', count: 6 },
        ],
        source: { source: 'musicbrainz' },
      },
      features: {
        source: abSrc,
        danceability: 0.7,
        moodHappy: 0.4,
        moodSad: 0.55,
        moodAggressive: 0.15,
        moodRelaxed: 0.6,
        genreLabels: ['rock'],
        keyStrength: 0.8,
        loudness: 0.9,
        dynamicComplexity: 3,
        spectralCentroid: 1600,
        voiceInstrumental: 0.9,
      },
    };
    // A candidate that genuinely resembles the seed: near-identical tempo, same key, close
    // moods. The REAL scorer must find >=2 dimensions >=0.6 and a concrete (non-genre) trait.
    const richCand: TrackRecord = {
      ...richSeed,
      key: 'deezer:99',
      isrc: null,
      title: 'Cities in Dust',
      artist: 'Siouxsie and the Banshees',
      tempoBpm: { value: 122, source: { source: 'deezer' } },
      features: { ...richSeed.features!, moodSad: 0.5, moodRelaxed: 0.62 },
    };

    const { record } = await run({
      deps: {
        ...deps({
          channels: {
            A: async () => channelResult('A', { status: 'skipped', reason: 'no LASTFM_API_KEY' }),
            B: async () =>
              channelResult('B', {
                status: 'skipped',
                reason: 'fewer than 2 usable tags on the seed',
              }),
            C: async () =>
              channelResult('C', {
                candidates: [candidate('Siouxsie and the Banshees', 'Cities in Dust', 'C')],
              }),
          },
          resolveTrack: async () => richSeed,
          verifyMany: async (candidates, opts) => {
            const out: VerifiedCandidate[] = [];
            for (const c of candidates) {
              const verified = { candidate: c, track: richCand };
              out.push(verified);
              opts?.onVerified?.(verified);
            }
            return out;
          },
        }),
        // The real deterministic stages — no fakes.
        fingerprint: fingerprintTrack,
        score: scoreBatch,
      },
    });

    expect(record.stats.modelCalls).toBe(0);
    expect(record.fingerprint?.model).toBe('deterministic-v1');
    expect(record.results.length).toBeGreaterThan(0);

    const rec = record.results[0];
    // rule 4, actually cleared by the real scorer over the real feature profiles.
    const strongDims = rec.dimensions.filter((d) => d.score >= 0.6).length;
    expect(strongDims).toBeGreaterThanOrEqual(2);
    expect(rec.sharedTraits.some((t) => /bpm|minor|major|classified/i.test(t))).toBe(true);
    expect(rec.flags).not.toContain('weak-why-unfixed');
  });

  it('no credit on the account: the whole run degrades in words, never in JSON', async () => {
    const { labels, events, record } = await run({
      deps: deps({
        // The stable token `model.ts` classifies an HTTP 400 "credit balance" error as.
        fingerprint: async () => ({ ok: false, reason: 'billing' }),
        channels: {
          A: async () => {
            throw new Error('channels must not run without a fingerprint');
          },
        },
      }),
    });

    expect(labels).toEqual([
      'run:fresh',
      'stage:resolve:start',
      'seed',
      'stage:resolve:done',
      'stage:fingerprint:start',
      'stage:fingerprint:error',
      'final',
      'stage:done:done',
    ]);
    const stage = events.find((e) => e.type === 'stage' && e.status === 'error');
    expect(stage?.type === 'stage' && stage.message).toBe(BILLING_DEGRADED);
    expect(record.degraded).toContain(BILLING_DEGRADED);
    // Plain words, naming the account and the key it belongs to. What to DO about it is
    // the notice's job (`consequenceFor`), so the line does not repeat it.
    expect(record.degraded.join(' ')).toMatch(/ANTHROPIC_API_KEY/);
    expect(record.degraded.join(' ')).toMatch(/has no credit/);
    // Never the raw 400 body the SDK threw, and never the internal token either.
    expect(record.degraded.join(' ')).not.toMatch(/invalid_request_error|[{}]/);
    expect(record.degraded.join(' ')).not.toMatch(/\bbilling\b/);
    expect(record.results).toEqual([]);
    expect(record.fingerprint).toBeNull();
    // Not cached: the moment there is credit, the same seed must run for real.
    expect(runsRepo.count()).toBe(0);
  });

  it('a rejected key, a rate limit and an outage each get their own sentence', async () => {
    const cases: [string, string][] = [
      ['bad_api_key', BAD_API_KEY_DEGRADED],
      ['rate_limited', RATE_LIMITED_DEGRADED],
      ['overloaded', OVERLOADED_DEGRADED],
    ];
    for (const [reason, line] of cases) {
      closeDb();
      const { record } = await run({
        deps: deps({ fingerprint: async () => ({ ok: false, reason }) }),
      });
      expect(record.degraded).toContain(line);
      expect(record.degraded.join(' ')).not.toMatch(/fingerprint failed/);
      expect(record.results).toEqual([]);
      expect(runsRepo.count()).toBe(0);
    }
  });

  it('every reason model.ts calls an account failure has a sentence and a plain cause', () => {
    // The list lives in `model.ts` and the wording here; nothing but this locks them
    // together, so a fifth reason without a sentence would silently print its own token.
    for (const reason of ACCOUNT_FAILURE_REASONS) {
      expect(modelUnavailable(reason)).not.toBeNull();
      expect(plainReason(reason)).not.toBe(reason);
    }
  });

  it('a cached fingerprint carries the run PAST stage 2 — the later stages still say it in words', async () => {
    // The fingerprint cache is keyed on the track, model and prompt alone, so a seed read
    // while the account had credit replays for free and stage 2 never sees the failure.
    // Channel A survives on Last.fm, so this run has results AND an account wall.
    const { record } = await run({
      deps: deps({
        fingerprint: async () => ({ ok: true, fingerprint: FINGERPRINT, cached: true }),
        channels: {
          A: async () =>
            channelResult('A', {
              candidates: [candidate('Squirrel Nut Zippers', 'Hell', 'A')],
              notes: ['tag pivot skipped: pickTags billing'],
            }),
          C: async () => channelResult('C', { status: 'error', reason: 'billing' }),
        },
      }),
    });

    const lines = record.degraded.join('\n');
    expect(record.degraded).toContain(
      'Channel C failed: the Anthropic account behind ANTHROPIC_API_KEY has no credit',
    );
    expect(lines).toMatch(/tag pivot skipped: pickTags the Anthropic account behind/);
    // The listener never meets the internal token; the receipt still carries it.
    expect(lines).not.toMatch(/\bbilling\b/);
    expect(record.stats.perChannel.C.skipped).toBe('error: billing');
    // A run the ACCOUNT shortened is not this seed's answer, so it is never cached —
    // `runs` has no TTL and would replay the short list long after the credit is back.
    expect(record.results.length).toBeGreaterThan(0);
    expect(runsRepo.count()).toBe(0);
  });

  it('a scorer stopped by the account says which wall it hit, not just that candidates vanished', async () => {
    const { record } = await run({
      deps: deps({
        score: async (_seed, _fp, candidates) => ({
          scored: [],
          failed: candidates.map((c) => c.track.key),
          reason: 'rate_limited',
        }),
      }),
    });

    expect(record.results).toEqual([]);
    expect(record.degraded.join('\n')).toMatch(
      /candidate\(s\) came back unscored and were dropped: this account hit the Anthropic rate limit/,
    );
    expect(record.degraded.join('\n')).not.toMatch(/rate_limited/);
  });

  it('a scorer that fails for its own reasons keeps the line it always had', async () => {
    const { record } = await run({
      deps: deps({
        score: async (_seed, _fp, candidates) => ({
          scored: [],
          failed: candidates.map((c) => c.track.key),
        }),
      }),
    });
    // One line per channel batch, and byte-identical to the one it has always pushed.
    expect(record.degraded).toContain('1 candidate(s) came back unscored and were dropped');
  });

  it('any other fingerprint failure degrades the same way, with its own reason', async () => {
    const { labels, record } = await run({
      deps: deps({ fingerprint: async () => ({ ok: false, reason: 'refusal: no' }) }),
    });
    expect(labels).toContain('stage:fingerprint:error');
    expect(record.degraded.join('\n')).toMatch(/fingerprint failed: refusal: no/);
    expect(record.results).toEqual([]);
  });

  it('an unresolved seed ends with error + final + stage done, and is not cached', async () => {
    const { events, labels, record } = await run({
      seedKey: 'deezer:missing',
      deps: deps({ resolveTrack: async () => null }),
    });
    expect(labels).toEqual([
      'run:fresh',
      'stage:resolve:start',
      // The stand-in seed keeps the documented order intact: a client that waits for
      // `seed` before rendering is never left with nothing.
      'seed',
      'stage:resolve:error',
      'error',
      'final',
      'stage:done:done',
    ]);
    const seedEvent = events.find((e) => e.type === 'seed');
    expect(seedEvent?.type === 'seed' && seedEvent.track.degraded).toEqual(['not resolved']);
    expect(record.results).toEqual([]);
    expect(record.degraded.join('\n')).toMatch(/resolve it first/);
    expect(runsRepo.count()).toBe(0);
  });

  it('a scorer that throws drops that batch and keeps the run alive', async () => {
    const { record, labels } = await run({
      deps: deps({
        score: async () => {
          throw new Error('the model exploded');
        },
      }),
    });
    expect(record.results).toEqual([]);
    expect(record.degraded.join('\n')).toMatch(/scoring failed for 1 candidate\(s\): the model exploded/);
    expect(labels.at(-1)).toBe('stage:done:done');
  });

  it('candidates the scorer could not score are dropped with a degraded note', async () => {
    const { record } = await run({
      deps: deps({
        score: async (_seed, _fp, candidates) => ({
          scored: [],
          failed: candidates.map((c) => c.track.key),
        }),
      }),
    });
    expect(record.results).toEqual([]);
    expect(record.degraded.join('\n')).toMatch(/came back unscored and were dropped/);
  });

  it('a verifier that throws degrades to zero results', async () => {
    const { record, labels } = await run({
      deps: deps({
        verifyMany: async () => {
          throw new Error('verification exploded');
        },
      }),
    });
    expect(record.results).toEqual([]);
    expect(record.degraded.join('\n')).toMatch(/verification exploded/);
    expect(labels.at(-1)).toBe('stage:done:done');
  });

  it('a channel’s own notes and partial-degrade reason reach the run record', async () => {
    const { record } = await run({
      deps: deps({
        channels: {
          B: async () =>
            channelResult('B', {
              reason: 'musicbrainz cohort query failed',
              notes: ['one cohort query returned no rows'],
              candidates: [],
            }),
        },
      }),
    });
    expect(record.degraded).toContain('Channel B: one cohort query returned no rows');
    expect(record.degraded).toContain('Channel B: musicbrainz cohort query failed');
  });

  it('a run with no results is not cached — one bad afternoon is not a permanent answer', async () => {
    await run({ deps: deps({ verifyMany: async () => [] }) });
    expect(runsRepo.count()).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------ *
 * The run cache
 * ------------------------------------------------------------------------------------ */

describe('the run cache', () => {
  it('replays a stored run as the same sequence with cached: true', async () => {
    const first = await run();
    expect(runsRepo.count()).toBe(1);

    const verifyMany = vi.fn(async () => []);
    const second = await run({ deps: deps({ verifyMany }) });

    expect(verifyMany).not.toHaveBeenCalled();
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.results).toEqual(first.record.results);
    expect(second.labels).toEqual([
      'run:cached',
      'stage:resolve:start',
      'seed',
      'stage:resolve:done',
      'stage:fingerprint:start',
      'fingerprint',
      'stage:fingerprint:done',
      'stage:channels:start',
      'channel:A:start',
      'channel:A:done',
      'channel:B:start',
      'channel:B:skipped',
      'channel:C:start',
      'channel:C:done',
      'result:deezer:1',
      'result:deezer:2',
      'verified:A',
      'verified:C',
      'stage:channels:done',
      'stage:rank:start',
      'stage:rank:done',
      'final',
      'stage:done:done',
    ]);
    expect(runsRepo.count()).toBe(1);
  });

  it('replays a channel that errored as an error, not as a skip', async () => {
    const failing = deps({
      channels: {
        A: async () => channelResult('A', { status: 'error', reason: 'last.fm is down' }),
      },
    });
    await run({ deps: failing });
    const second = await run({ deps: failing });
    expect(second.labels[0]).toBe('run:cached');
    const errored = second.events.find((e) => e.type === 'channel' && e.status === 'error');
    expect(errored?.type === 'channel' && errored.reason).toBe('last.fm is down');
  });

  it('different options are a different run', async () => {
    await run();
    const second = await run({ includeSameArtist: true });
    expect(second.labels[0]).toBe('run:fresh');
    expect(runsRepo.count()).toBe(2);
  });

  it('`force` re-runs a seed that is already cached', async () => {
    const first = await run();
    const second = await run({ force: true });
    expect(second.labels[0]).toBe('run:fresh');
    expect(second.record.id).not.toBe(first.record.id);
  });

  it('a run stored under another engine version is not replayed', async () => {
    const { record } = await run();
    runsRepo.save({ ...record, id: 'run_old', engineVersion: 'engine-999' });
    const again = await run();
    expect(again.labels[0]).toBe('run:cached');
    expect(again.record.id).toBe(record.id);
  });

  it('the cache key covers the prompt versions, not just the options', async () => {
    const plain = runCacheHash({ includeSameArtist: false });
    const corrected = runCacheHash({
      includeSameArtist: false,
      corrections: { vocal_delivery: 'wrong' },
    });
    expect(plain).not.toBe(corrected);
  });

  it('never stores a signed Deezer preview URL', async () => {
    const DEEZER_PREVIEW = 'https://cdnt-preview.dzcdn.net/api/1/1/a.mp3?hdnea=exp=1~hmac=deadbeef';
    const withPreview = (t: TrackRecord): TrackRecord => ({
      ...t,
      preview: {
        url: DEEZER_PREVIEW,
        source: { source: 'deezer', id: '1143631', field: 'preview' },
        expiresAt: Date.now() + 840_000,
      },
    });

    const { events } = await run({
      deps: deps({
        resolveTrack: async () => withPreview(SEED),
        verifyMany: async (candidates) =>
          candidates
            .map((c) => DEFAULT_CATALOGUE.get(trackNormKey(c.artist, c.title)))
            .filter((t): t is TrackRecord => t !== undefined)
            .map((t, i) => ({ candidate: candidates[i], track: withPreview(t) })),
      }),
    });

    // The LIVE stream still carries a freshly minted URL — that is the point of minting.
    const seedEvent = events.find((e) => e.type === 'seed');
    expect(seedEvent?.type === 'seed' && seedEvent.track.preview?.url).toBe(DEEZER_PREVIEW);

    const stored = runsRepo.find(
      SEED.key,
      runCacheHash({ includeSameArtist: false }),
      ENGINE_VERSION,
    );
    const raw = JSON.stringify(stored);
    expect(stored).not.toBeNull();
    expect(raw).not.toContain('cdnt-preview');
    expect(raw).not.toContain('hmac');
    expect(stored?.seed.preview).toBeNull();
    expect(stored?.results[0]?.track.preview).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------ *
 * Abort
 * ------------------------------------------------------------------------------------ */

describe('abort', () => {
  it('rejects with an AbortError and stops emitting', async () => {
    const controller = new AbortController();
    const events: PipelineEvent[] = [];

    await expect(
      runPipeline({
        seedKey: SEED.key,
        options: { includeSameArtist: false },
        onEvent: (e) => events.push(e),
        signal: controller.signal,
        deps: deps({
          channels: {
            A: async () => {
              controller.abort();
              return channelResult('A', {
                candidates: [candidate('Squirrel Nut Zippers', 'Hell', 'A')],
              });
            },
          },
        }),
      }),
    ).rejects.toBeInstanceOf(PipelineAbortError);

    expect(events.map(label)).toEqual([
      'run:fresh',
      'stage:resolve:start',
      'seed',
      'stage:resolve:done',
      'stage:fingerprint:start',
      'fingerprint',
      'stage:fingerprint:done',
      'stage:channels:start',
      'channel:A:start',
      'channel:B:start',
      'channel:C:start',
    ]);
    expect(runsRepo.count()).toBe(0);
  });

  it('threads the signal INTO Stage 4, not merely around it', async () => {
    const controller = new AbortController();
    let signalSeen: AbortSignal | undefined;
    let abortedDuringBatch = false;

    const verifyMany: PipelineDeps['verifyMany'] = async (_candidates, opts) => {
      signalSeen = opts?.signal;
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 5));
      abortedDuringBatch = opts?.signal?.aborted === true;
      return [];
    };

    await expect(
      runPipeline({
        seedKey: SEED.key,
        options: { includeSameArtist: false },
        onEvent: () => {},
        signal: controller.signal,
        deps: deps({ verifyMany }),
      }),
    ).rejects.toBeInstanceOf(PipelineAbortError);

    expect(signalSeen).toBe(controller.signal);
    expect(abortedDuringBatch).toBe(true);
    expect(runsRepo.count()).toBe(0);
  });

  it('passes the signal and the run’s usage counter to every channel', async () => {
    const seen: ChannelContext[] = [];
    const controller = new AbortController();
    const capture = async (...args: unknown[]): Promise<ChannelOutcome> => {
      seen.push(args[args.length - 1] as ChannelContext);
      return channelResult('A', { candidates: [] });
    };
    await runPipeline({
      seedKey: SEED.key,
      options: { includeSameArtist: false },
      onEvent: () => {},
      signal: controller.signal,
      deps: deps({
        channels: {
          A: capture as PipelineDeps['channels']['A'],
          B: capture as PipelineDeps['channels']['B'],
          C: (async (_seed: TrackRecord, _fp: Fingerprint, ctx: ChannelContext) => {
            seen.push(ctx);
            return channelResult('C', { candidates: [] });
          }) as PipelineDeps['channels']['C'],
        },
      }),
    });
    expect(seen).toHaveLength(3);
    for (const ctx of seen) {
      expect(ctx.signal).toBe(controller.signal);
      expect(ctx.seedKey).toBe(SEED.key);
      expect(typeof ctx.usage.record).toBe('function');
    }
    // One accumulator for the whole run, so `stats.modelCalls` is the run's total.
    expect(new Set(seen.map((c) => c.usage)).size).toBe(1);
  });

  it('a signal aborted before the run emits nothing at all', async () => {
    const events: PipelineEvent[] = [];
    await expect(
      runPipeline({
        seedKey: SEED.key,
        options: { includeSameArtist: false },
        onEvent: (e) => events.push(e),
        signal: AbortSignal.abort(),
        deps: deps(),
      }),
    ).rejects.toHaveProperty('name', 'AbortError');
    expect(events).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Stage 5's cover verdict, the prompt versions, and what may be streamed
 * ------------------------------------------------------------------------------------ */

describe('a candidate the scorer calls the same song', () => {
  const coverDeps = () =>
    deps({
      score: async (_seed, _fp, candidates) => ({
        scored: candidates.map((c) =>
          scored(c.track.key, {
            isCoverOrSameSong: c.track.key === 'deezer:1',
          }),
        ),
        failed: [],
      }),
    });

  it('is cut with reason `same-song` and never reaches the results', async () => {
    const { record } = await run({ deps: coverDeps() });
    expect(record.results.some((r) => r.track.key === 'deezer:1')).toBe(false);
    expect(record.stats.cut?.find((c) => c.key === 'deezer:1')?.reason).toBe('same-song');
  });

  it('is not streamed as a provisional result either', async () => {
    const { labels } = await run({ deps: coverDeps() });
    expect(labels).not.toContain('result:deezer:1');
    expect(labels).toContain('result:deezer:2');
  });
});

describe('what may be streamed as provisional', () => {
  it('withholds a candidate whose traits rule 4 will certainly cut', async () => {
    const { labels, record } = await run({
      deps: deps({
        score: async (_seed, _fp, candidates) => ({
          scored: candidates.map((c) =>
            scored(c.track.key, {
              // Rule 4's traits arm, which rule 6 never relaxes: deterministic at publish
              // time, so showing the card and taking it away would be gratuitous.
              ...(c.track.key === 'deezer:1' ? { sharedTraits: ['jazz', '80s'] } : {}),
            }),
          ),
          failed: [],
        }),
      }),
    });
    expect(labels).not.toContain('result:deezer:1');
    expect(record.stats.cut?.find((c) => c.key === 'deezer:1')?.reason).toBe('genre-only');
  });
});

describe('the run cache key', () => {
  it('covers every prompt whose edit would change the answer', () => {
    const inputs = runCacheInputs({ includeSameArtist: false });
    const rendered = JSON.stringify(inputs);
    expect(rendered).toContain(ENGINE_VERSION);
    expect(rendered).toContain(SCORE_PROMPT_VERSION);
    expect(rendered).toContain(FINGERPRINT_PROMPT_VERSION);
    expect(rendered).toContain(CHANNEL_C_PROMPT_VERSION);
    expect(rendered).toContain(PICK_TAGS_PROMPT_VERSION);
    expect(rendered).toContain(CHANNEL_B_PROMPT_VERSION);
  });
});

describe('Stage 2 gets the options the caller gave the run', () => {
  it('forwards `force`, so a forced run re-fingerprints instead of replaying the cache', async () => {
    let seen: { force?: boolean } | undefined;
    await run({
      force: true,
      deps: deps({
        fingerprint: async (_track, opts) => {
          seen = opts;
          return { ok: true, fingerprint: FINGERPRINT, cached: false };
        },
      }),
    });
    expect(seen?.force).toBe(true);
  });

  it('does not force an ordinary run', async () => {
    let seen: { force?: boolean } | undefined;
    await run({
      deps: deps({
        fingerprint: async (_track, opts) => {
          seen = opts;
          return { ok: true, fingerprint: FINGERPRINT, cached: false };
        },
      }),
    });
    expect(seen?.force).toBeUndefined();
  });
});

describe('Channel C\'s measured spread', () => {
  it('is recorded in stats for the eval harness to flag', async () => {
    const { record } = await run({
      deps: deps({
        channels: {
          C: async () =>
            channelResult('C', {
              candidates: [],
              spread: {
                decades: ['1980s'],
                genres: ['new wave'],
                entries: 26,
                dated: 26,
                topDecadeShare: 1,
                ok: false,
              },
            }),
        },
      }),
    });
    expect(record.stats.channelCSpread?.ok).toBe(false);
    expect(record.stats.channelCSpread?.decades).toEqual(['1980s']);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Channel C never sees the seed's identity
 * ------------------------------------------------------------------------------------ */

describe('the seed identity reaches Channel C only as something to strip', () => {
  it('passes seedIdentity so the channel can scrub the fingerprint’s free text', async () => {
    let seen: unknown;
    await run({
      deps: deps({
        channels: {
          C: async (_seed, _fp, _ctx, opts) => {
            seen = opts?.seedIdentity;
            return channelResult('C', { candidates: [] });
          },
        },
      }),
    });
    expect(seen).toEqual({ artist: 'The Cure', title: 'The Lovecats' });
  });
});
