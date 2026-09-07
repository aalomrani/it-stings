/**
 * The pipeline: one run, one event stream, one persisted `RunRecord`.
 *
 * Stage 1 resolve → Stage 2 fingerprint → Stage 3 the three channels, concurrently →
 * Stage 4 verification of every new candidate → Stage 5 model scoring + `rank.ts` →
 * `final`. Every stage is injectable (`PipelineDeps`) so the tests exercise the whole
 * protocol with no network and no model.
 *
 * Two invariants this file exists to hold:
 *
 *   - THE EVENT ORDER (docs/architecture.md, "Streaming protocol") is the UI's contract:
 *     `run` → `stage resolve` → `seed` → `stage fingerprint` → `fingerprint` → per channel
 *     `channel start` → `channel done|skipped|error` → zero or more provisional `result` →
 *     `verified` → `stage rank` → `final` → `stage done`. A cache replay emits the same
 *     shape with `cached: true`.
 *   - EVERY FAILURE DEGRADES. The only exception this function throws is
 *     `PipelineAbortError` (the client went away). A dead channel, a refused model call, a
 *     verifier that explodes: each becomes a `degraded[]` line and a shorter list, because
 *     a partial answer beats an error page.
 *
 * Governing rule (docs/spec.md): APIs retrieve and verify, the model interprets and judges.
 * Nothing reaches `results` that was not verified in Stage 4 AND scored in Stage 5.
 */

import * as runsRepo from '@/lib/db/repos/runs';
import * as tracksRepo from '@/lib/db/repos/tracks';
import { channelA } from '@/lib/engine/channels/a';
import { channelB } from '@/lib/engine/channels/b';
import { PICK_TAGS_PROMPT_VERSION } from '@/lib/engine/channels/a';
import { CHANNEL_B_PROMPT_VERSION } from '@/lib/engine/channels/b';
import {
  CHANNEL_C_PROMPT_VERSION,
  CHANNEL_C_TIGHTEN_DROP_RATE,
  channelC,
  type ChannelCOptions,
  type SeedIdentity,
} from '@/lib/engine/channels/c';
import type { ChannelContext, ChannelResult } from '@/lib/engine/channels/types';
import {
  fingerprintPromptKey,
  fingerprintTrack,
  type FingerprintOptions,
  type FingerprintResult,
} from '@/lib/engine/fingerprint';
import {
  REASON,
  createUsageCounter,
  isAccountFailure,
  type ModelUsage,
} from '@/lib/engine/model';
import {
  FLAG_COVER_OR_SAME_SONG,
  FLAG_GENERIC_WHY,
  finalScore,
  genreOnlyReasons,
  isSameArtist,
  modelScore,
  rank,
} from '@/lib/engine/rank';
import {
  SCORE_PROMPT_VERSION,
  scoreBatch,
  type ScoreOutcome,
  type ScoredCandidate,
} from '@/lib/engine/score';
import { tierFromDimensionNote } from '@/lib/engine/similarity';
import { hydratePreview, stripVolatilePreview } from '@/lib/resolve/hydratePreview';
import {
  verificationKey,
  verifyMany as verifyManyCandidates,
} from '@/lib/resolve/verifyCandidate';
import {
  type Candidate,
  type Channel,
  type Evidence,
  type Fingerprint,
  type PipelineEvent,
  type Recommendation,
  type RunOptions,
  type RunRecord,
  type TrackRecord,
} from '@/lib/types';
import { newRunId, stableHash } from '@/lib/util/ids';
import { trackNormKey } from '@/lib/util/normalize';

/**
 * Part of the run cache key. Bump it whenever the engine's output would change.
 * `engine-3-keyless`: the whole engine is now deterministic and keyless — Stage 2
 * (fingerprint) and Stage 5 (score) make no model call, and the three channels generate
 * candidates from Deezer/MusicBrainz/Last.fm rather than an LLM. A run stored by the
 * LLM-era `engine-2` (there is a persisted Lovecats run) must never replay.
 * `engine-4-weights`: every run now persists the full scored candidate pool so a per-run
 * weights change re-ranks it instantly (no network, no model). A pre-engine-4 run has no
 * pool and would re-rank from `results`, so it is retired by this bump instead.
 */
export const ENGINE_VERSION = 'engine-11-genre-weights';

/** The channels, in the order their `start` events are emitted. */
export const CHANNELS: readonly Channel[] = ['A', 'B', 'C'] as const;

/** Stage 4 concurrency. Deezer allows 45 req/5 s (~9/s); the verifier is the run's long
 * pole now that candidates skip MusicBrainz, so run it wider — 8 in flight stays inside the
 * Deezer window while cutting the verify wall-clock. */
export const VERIFY_CONCURRENCY = 8;

/**
 * Cap on how many candidates a whole run sends to Stage 4. Candidates are verified on Deezer
 * ALONE (no MusicBrainz, no AcousticBrainz — those slow, serial, often-degraded sources are
 * spent only on the seed), so a candidate is cheap: ~3 Deezer calls at `VERIFY_CONCURRENCY`
 * = 6 in parallel. That lets the cap be generous — more candidates means more survive rule 4
 * and the results list fills out. Combined with the one-track-per-artist rule below, 18
 * verified candidates span 18 artists. Held at 18 (not higher) because every candidate is
 * still ~2-3 Deezer calls against a 45-req/5-s window, so the verify stage stays the run's
 * long pole — 18 keeps a fresh run comfortably under the 20 s target. `rank` keeps ~9-15.
 */
export const MAX_VERIFIED_CANDIDATES = 18;

/**
 * What the ACCOUNT behind the key did, in plain words — `isAccountFailure` in `model.ts`
 * classifies, the wording lives here. DEAD on the keyless recommendation path: no stage
 * calls a model any more, so a deterministic fingerprint never fails on an account reason.
 * Kept only so a future optional-model feature has the wording, and so the wording tests
 * that lock these strings to `model.ts`'s reason set still have something to check.
 * Never the API's raw error body: a listener cannot act on JSON.
 */
const ACCOUNT_CAUSE: Readonly<Record<string, string>> = {
  [REASON.billing]: 'the Anthropic account behind ANTHROPIC_API_KEY has no credit',
  [REASON.badApiKey]: 'ANTHROPIC_API_KEY was rejected by Anthropic',
  [REASON.rateLimited]: 'this account hit the Anthropic rate limit',
  [REASON.overloaded]: 'Anthropic did not answer',
};

/** The whole-run form, for a failure at Stage 2 that leaves nothing downstream to run. */
const unavailable = (reason: string): string =>
  `recommendations unavailable: ${ACCOUNT_CAUSE[reason]}`;

export const BILLING_DEGRADED = unavailable(REASON.billing);
export const BAD_API_KEY_DEGRADED = unavailable(REASON.badApiKey);
export const RATE_LIMITED_DEGRADED = unavailable(REASON.rateLimited);
export const OVERLOADED_DEGRADED = unavailable(REASON.overloaded);

const ACCOUNT_DEGRADED: Readonly<Record<string, string>> = {
  [REASON.billing]: BILLING_DEGRADED,
  [REASON.badApiKey]: BAD_API_KEY_DEGRADED,
  [REASON.rateLimited]: RATE_LIMITED_DEGRADED,
  [REASON.overloaded]: OVERLOADED_DEGRADED,
};

/**
 * The plain sentence for a model failure no stage of this run could have survived, or
 * `null` when the reason belongs to one call and the stage says so in its own line.
 */
export function modelUnavailable(reason: string): string | null {
  if (!isAccountFailure(reason)) return null;
  return ACCOUNT_DEGRADED[reason] ?? null;
}

/**
 * Every account-level token, wherever a stage buried it in a reason of its own: Channel C
 * answers the bare `billing`, Channel A answers `tag pivot skipped: pickTags billing`.
 * Word boundaries, so a reason that merely contains the letters is untouched.
 */
const ACCOUNT_TOKEN = new RegExp(`\\b(?:${Object.keys(ACCOUNT_CAUSE).join('|')})\\b`, 'g');

/**
 * A stage's own reason with any account-level token swapped for plain words.
 *
 * Stage 2 is not the only stage that calls the model, and it is the only one that can be
 * served from cache (`fingerprint.ts` keys its rows on the track, model and prompt alone).
 * So a seed fingerprinted while the account had credit sails past the whole-run degrade
 * above and every LATER stage meets the same wall — and `Channel C failed: billing` is
 * jargon to the listener the notice is written for. Everything else is returned byte for
 * byte, so unrelated lines read exactly as they did.
 */
export function plainReason(reason: string): string {
  return reason.replace(ACCOUNT_TOKEN, (token) => ACCOUNT_CAUSE[token] ?? token);
}

/** `stats.perChannel[x].skipped` prefix for a channel that ERRORED rather than skipped. */
const ERROR_PREFIX = 'error: ';

export interface VerifiedCandidate {
  candidate: Candidate;
  track: TrackRecord;
}

/* ------------------------------------------------------------------------------------ *
 * Dependencies
 * ------------------------------------------------------------------------------------ */

/**
 * What a channel hands back. The three channels return supersets of `ChannelResult`;
 * the pipeline only needs the envelope plus whatever evidence index the channel offers
 * (`evidence` keyed by `trackNormKey` from Channel A, `evidenceByKey` from Channel B).
 * Anything missing is rebuilt from the candidate's own hints, so a channel that returns
 * the bare envelope still produces an evidence trail.
 */
export type ChannelOutcome = ChannelResult & {
  evidence?: Record<string, Evidence[]> | Evidence[];
  evidenceByKey?: Record<string, Evidence[]>;
  notes?: string[];
};

export type ChannelAFn = (
  seed: TrackRecord,
  fingerprint: Fingerprint,
  ctx: ChannelContext,
) => Promise<ChannelOutcome>;

export type ChannelBFn = ChannelAFn;

export type ChannelCFn = (
  seed: TrackRecord,
  fingerprint: Fingerprint,
  ctx: ChannelContext,
  opts?: ChannelCOptions,
) => Promise<ChannelOutcome>;

/**
 * Everything the pipeline touches that is not pure. Tests inject fakes; production uses
 * the defaults below. No test in this repo may reach the network or the model.
 */
export interface PipelineDeps {
  /** Stage 1. The UI has already resolved the seed, so this is a cache read. */
  resolveTrack: (seedKey: string) => Promise<TrackRecord | null>;
  /** Stage 2. */
  fingerprint: (track: TrackRecord, opts: FingerprintOptions) => Promise<FingerprintResult>;
  /** Stage 3. Each channel is independent and never sees another's output. */
  channels: { A: ChannelAFn; B: ChannelBFn; C: ChannelCFn };
  /**
   * Stage 4. Every candidate must resolve to a real, findable track or it is dropped.
   *
   * `signal` is threaded all the way down because verification is by far the longest phase
   * of a run (70 s of a 73 s cold run, measured): checking the signal only around it lets
   * an abandoned run keep spending the global MusicBrainz budget the NEXT run needs.
   */
  verifyMany: (
    candidates: Candidate[],
    opts?: {
      concurrency?: number;
      signal?: AbortSignal;
      onVerified?: (verified: VerifiedCandidate) => void;
    },
  ) => Promise<VerifiedCandidate[]>;
  /** Stage 5, the model half. `rank.ts` owns the code half and is not injectable. */
  score: (
    seed: TrackRecord,
    fingerprint: Fingerprint,
    candidates: VerifiedCandidate[],
    ctx: ChannelContext,
  ) => Promise<ScoreOutcome>;
}

export function defaultDeps(): PipelineDeps {
  return {
    resolveTrack: async (seedKey) => {
      const track = tracksRepo.get(seedKey);
      if (!track) return null;
      try {
        return await hydratePreview(track);
      } catch {
        return { ...track, preview: null };
      }
    },
    fingerprint: fingerprintTrack,
    channels: { A: channelA, B: channelB, C: channelC },
    verifyMany: async (candidates, opts) => {
      // The verifier dedupes internally and answers by `trackNormKey`; index the
      // candidates the same way so each surviving one keeps its channel and hints, and
      // report each hit the moment it lands rather than after the whole batch.
      const byKey = new Map<string, Candidate>();
      for (const candidate of candidates) {
        const key = verificationKey(candidate.artist, candidate.title);
        if (!byKey.has(key)) byKey.set(key, candidate);
      }
      const out: VerifiedCandidate[] = [];
      await verifyManyCandidates(
        [...byKey.values()].map((c) => ({ artist: c.artist, title: c.title })),
        {
          concurrency: opts?.concurrency ?? VERIFY_CONCURRENCY,
          ...(opts?.signal ? { signal: opts.signal } : {}),
          onVerified: (key, result) => {
            const candidate = byKey.get(key);
            if (!candidate || !result.ok) return;
            const verified: VerifiedCandidate = { candidate, track: result.track };
            out.push(verified);
            opts?.onVerified?.(verified);
          },
        },
      );
      return out;
    },
    score: scoreBatch,
  };
}

/** Thrown when the client disconnects; the SSE route swallows it and closes the stream. */
export class PipelineAbortError extends Error {
  override readonly name = 'AbortError';
  constructor(message = 'run aborted') {
    super(message);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PipelineAbortError();
}

/* ------------------------------------------------------------------------------------ *
 * The candidate pool
 * ------------------------------------------------------------------------------------ */

/**
 * One candidate track as the run accumulates it. A track found by two channels is ONE
 * entry: it gains a channel chip and its evidence, and is never verified or scored twice
 * (docs/architecture.md, "Pipeline behaviour" step 4).
 */
interface PoolEntry {
  /** `trackNormKey` of the spelling that created the entry. */
  key: string;
  candidate: Candidate;
  evidence: Evidence[];
  /** Set once Stage 4 says the track is real. */
  track?: TrackRecord;
  /** Set once Stage 5 has scored it; a later channel updates and re-emits it. */
  rec?: Recommendation;
}

/** The evidence index a channel supplied, normalised to one shape. */
function evidenceIndex(outcome: ChannelOutcome): Record<string, Evidence[]> {
  if (outcome.evidenceByKey) return outcome.evidenceByKey;
  if (outcome.evidence && !Array.isArray(outcome.evidence)) return outcome.evidence;
  return {};
}

/**
 * The fallback evidence trail, built from the candidate's own hints. Used when a channel
 * supplied no index for this key — and it is the ONLY source of Channel C's rows, whose
 * evidence is the model's note and nothing else.
 */
function evidenceFromHints(channel: Channel, candidate: Candidate): Evidence[] {
  const out: Evidence[] = [];
  for (const hint of candidate.hints) {
    if (channel === 'A' && typeof hint.lastfmMatch === 'number') {
      out.push({
        channel,
        kind: 'lastfm_similar',
        detail: `Last.fm match ${hint.lastfmMatch.toFixed(2)}`,
      });
    }
    if (channel === 'A' && hint.tag) {
      out.push({ channel, kind: 'lastfm_tag', detail: `tag: ${hint.tag}` });
    }
    if (channel === 'B' && (hint.sourceUrl || hint.sentence)) {
      out.push({
        channel,
        kind: 'forum',
        ...(hint.sourceUrl ? { url: hint.sourceUrl } : {}),
        ...(hint.sentence ? { sentence: hint.sentence } : {}),
        ...(hint.enthusiasm ? { enthusiasm: hint.enthusiasm } : {}),
      });
    }
    if (channel === 'C' && hint.modelNote) {
      out.push({ channel, kind: 'model_prior', detail: hint.modelNote });
    }
  }
  return out;
}

/** Evidence rows are deduped on their whole content: two channels can report one URL. */
function mergeEvidence(into: Evidence[], rows: Evidence[]): void {
  const seen = new Set(into.map((e) => JSON.stringify(e)));
  for (const row of rows) {
    const id = JSON.stringify(row);
    if (seen.has(id)) continue;
    seen.add(id);
    into.push(row);
  }
}

/* ------------------------------------------------------------------------------------ *
 * runPipeline
 * ------------------------------------------------------------------------------------ */

export interface RunPipelineArgs {
  seedKey: string;
  options: RunOptions;
  onEvent: (event: PipelineEvent) => void;
  signal?: AbortSignal;
  deps?: Partial<PipelineDeps>;
  /**
   * Skip the RUN cache read (the run is still stored). `npm run eval` sets it so a seed is
   * re-run against the current prompts; the fingerprint's own cache is keyed by prompt
   * version and needs no bypass.
   */
  force?: boolean;
  /**
   * The fingerprint the listener was looking at when they rejected a field. Forwarded to
   * Stage 2 so the correction prompt can quote the rejected value back; without it Task
   * F falls back to the stored uncorrected row, which a cold database does not have.
   */
  previous?: Fingerprint | null;
  /** Per-stage timings and degrade notes. Silent unless given (or `ITSTINGS_DEBUG`). */
  onLog?: (line: string) => void;
}

/**
 * The run cache key. `runs` is keyed by (seed, options hash, engine version); the two
 * prompt versions ride in the options hash so that editing a prompt invalidates every
 * stored run without needing an ENGINE_VERSION bump.
 */
export function runCacheHash(options: RunOptions): string {
  return stableHash(runCacheInputs(options));
}

/**
 * Everything the run cache key is made of, as data. Exported so a test can read the list
 * rather than compare opaque hashes: the failure this guards against is a prompt version
 * quietly falling OUT of the key, which no hash comparison would show.
 */
export function runCacheInputs(options: RunOptions): Record<string, unknown> {
  // `weights` is deliberately NOT in the key: the same (seed, sameArtist, corrections)
  // must replay the SAME scored pool no matter the weights, so a weight change re-ranks
  // that pool instantly instead of re-browsing. `replay` applies the requested weights.
  const { weights: _weights, ...cacheableOptions } = options;
  void _weights;
  return {
    options: cacheableOptions,
    engine: ENGINE_VERSION,
    fingerprint: fingerprintPromptKey(options.corrections),
    score: SCORE_PROMPT_VERSION,
    // Every prompt the run's answer depends on, not just the two the task contract named:
    // editing Channel C's prompt (or the tag picker's, or the mention extractor's) has to
    // invalidate stored runs too, or the prompt-tuning phase reads yesterday's answers.
    channels: [
      CHANNEL_C_PROMPT_VERSION,
      PICK_TAGS_PROMPT_VERSION,
      CHANNEL_B_PROMPT_VERSION,
    ].join('|'),
  };
}

/**
 * Runs (or replays) one recommendation run, emitting the `PipelineEvent` sequence
 * docs/architecture.md fixes, and returns the persisted `RunRecord`.
 *
 * Throws only `PipelineAbortError`.
 */
export async function runPipeline(args: RunPipelineArgs): Promise<RunRecord> {
  const { seedKey, options, onEvent, signal } = args;
  const deps: PipelineDeps = { ...defaultDeps(), ...args.deps };
  const startedAt = Date.now();
  const usage: ModelUsage = createUsageCounter();
  const log = makeLogger(args.onLog, startedAt);

  const emit = (event: PipelineEvent): void => {
    throwIfAborted(signal);
    onEvent(event);
  };

  // --- cache: same seed + same options + same engine + same prompts -> replay.
  const hash = runCacheHash(options);
  if (!args.force) {
    const cached = runsRepo.find(seedKey, hash, ENGINE_VERSION);
    if (cached) return replay(cached, emit, options);
  }

  const runId = newRunId();
  emit({ type: 'run', runId, cached: false });

  const degraded: string[] = [];
  const stats = emptyStats();

  /**
   * Set the moment any stage past Stage 2 dies of the ACCOUNT rather than of itself. Such
   * a run is short through no fault of the seed, so it is never cached: the whole point of
   * the "one bad afternoon is not a permanent answer" rule below.
   */
  let accountFailed = false;

  /** A stage's reason, as a listener should read it. See `plainReason`. */
  function noteReason(reason: string): string {
    const plain = plainReason(reason);
    if (plain !== reason) accountFailed = true;
    return plain;
  }

  /* --- Stage 1: resolve. ----------------------------------------------------------- */

  emit({ type: 'stage', stage: 'resolve', status: 'start' });
  const resolveStarted = Date.now();
  const resolved = await deps.resolveTrack(seedKey);
  throwIfAborted(signal);
  log(`resolve: ${Date.now() - resolveStarted}ms`);

  if (!resolved) {
    // The documented order promises a `seed` before anything else can be rendered, so the
    // error path emits the honest stand-in (degraded: ['not resolved']) rather than leaving
    // a client that waits for `seed` with nothing at all.
    emit({ type: 'seed', track: unresolvedSeed(seedKey) });
    emit({
      type: 'stage',
      stage: 'resolve',
      status: 'error',
      message: `no resolved track for ${seedKey}`,
    });
    degraded.push(`seed ${seedKey} is not in the track cache — resolve it first (POST /api/resolve)`);
    stats.durationMs = Date.now() - startedAt;
    emit({ type: 'error', message: `seed ${seedKey} is not resolved` });
    emit({ type: 'final', results: [], degraded, stats });
    emit({ type: 'stage', stage: 'done', status: 'done' });
    // Not cached: a run that resolved nothing must never be replayed.
    return {
      id: runId,
      seed: unresolvedSeed(seedKey),
      options,
      fingerprint: null,
      results: [],
      scoredPool: [],
      degraded,
      stats,
      engineVersion: ENGINE_VERSION,
      createdAt: Date.now(),
    };
  }
  // Bound to a non-nullable local: the nested helpers below are function declarations,
  // so TypeScript will not carry the null-check's narrowing into them.
  const seed: TrackRecord = resolved;
  emit({ type: 'seed', track: seed });
  emit({ type: 'stage', stage: 'resolve', status: 'done' });

  /* --- Stage 2: fingerprint. ------------------------------------------------------- */

  emit({ type: 'stage', stage: 'fingerprint', status: 'start' });
  const fpStarted = Date.now();
  const fp = await deps.fingerprint(seed, {
    ...(options.corrections ? { corrections: options.corrections } : {}),
    usage,
    // A forced run (eval, and the UI's re-run after the listener rejects a field a second
    // time) must reach Stage 2 as well: the fingerprint cache is keyed by the corrections
    // hash, so an identical corrections set would otherwise replay the same reading and
    // the "this is wrong" control would silently do nothing.
    ...(args.force ? { force: true } : {}),
    ...(args.previous !== undefined ? { previous: args.previous } : {}),
    ...(signal ? { signal } : {}),
  });
  throwIfAborted(signal);
  log(`fingerprint: ${Date.now() - fpStarted}ms`);

  if (!fp.ok) {
    // Nothing downstream can run without a fingerprint: the channels take it as input and
    // the scorer judges against it. So this is the whole run degrading, honestly, rather
    // than three channels each failing for the same reason.
    // The deterministic fingerprint never fails on a key or an account — it only returns
    // `{ok:false}` on a pre-aborted signal (already thrown above) — so `modelUnavailable`
    // is a dead safety net here, kept for the shape of the branch, not a live path.
    const message = modelUnavailable(fp.reason) ?? `fingerprint failed: ${fp.reason}`;
    emit({ type: 'stage', stage: 'fingerprint', status: 'error', message });
    degraded.push(message);
    log(message);
    stats.durationMs = Date.now() - startedAt;
    stats.modelCalls = usage.calls;
    stats.tokens = tokenStats(usage);
    emit({ type: 'final', results: [], degraded, stats });
    emit({ type: 'stage', stage: 'done', status: 'done' });
    return {
      id: runId,
      seed,
      options,
      fingerprint: null,
      results: [],
      scoredPool: [],
      degraded,
      stats,
      engineVersion: ENGINE_VERSION,
      createdAt: Date.now(),
    };
  }

  const fingerprint = fp.fingerprint;
  emit({ type: 'fingerprint', fingerprint });
  emit({
    type: 'stage',
    stage: 'fingerprint',
    status: 'done',
    ...(fp.cached ? { message: 'from cache' } : {}),
  });

  /* --- Stages 3-5: channels, verification, scoring. -------------------------------- */

  const ctx: ChannelContext = {
    seedKey: seed.key,
    usage,
    ...(signal ? { signal } : {}),
    log,
  };

  const byNormKey = new Map<string, PoolEntry>();
  // Candidates sent to Stage 4 so far this run — the pool cap (MAX_VERIFIED_CANDIDATES),
  // persisting across channels so verification stays fast.
  let verifiedCount = 0;
  // Artists already sent to Stage 4. Deezer related->top returns many tracks per popular
  // artist and `rank` keeps only ONE per artist, so verifying several tracks of the same
  // artist wastes the cap and starves other artists. Verify at most one track per artist so
  // the capped budget spans many artists — that is what fills the results list out.
  const verifiedArtists = new Set<string>();
  const artistKey = (name: string): string => name.toLowerCase().replace(/\s+/g, ' ').trim();
  // One track per new artist, up to the remaining run cap. Marks (and counts) ONLY the
  // entries it actually returns, so an artist dropped for lack of budget is not falsely
  // recorded as verified. Used for BOTH a channel's first pass and Channel C's retry, so the
  // stricter re-ask cannot flood the cap with more tracks of artists already covered.
  const takeDiverse = (entries: PoolEntry[]): PoolEntry[] => {
    const picked: PoolEntry[] = [];
    for (const e of entries) {
      if (verifiedCount + picked.length >= MAX_VERIFIED_CANDIDATES) break;
      const a = artistKey(e.candidate.artist);
      if (!a || verifiedArtists.has(a)) continue;
      verifiedArtists.add(a);
      picked.push(e);
    }
    verifiedCount += picked.length;
    return picked;
  };
  const byTrackKey = new Map<string, PoolEntry>();
  const recommendations: Recommendation[] = [];
  const liveChannels = new Set<Channel>();
  const seedKeyNorm = trackNormKey(seed.artist, seed.title);

  emit({ type: 'stage', stage: 'channels', status: 'start' });
  for (const channel of CHANNELS) emit({ type: 'channel', channel, status: 'start' });

  const pending = new Map<Channel, Promise<{ channel: Channel; outcome: ChannelOutcome }>>();
  pending.set('A', settle('A', () => deps.channels.A(seed, fingerprint, ctx)));
  pending.set('B', settle('B', () => deps.channels.B(seed, fingerprint, ctx)));
  pending.set(
    'C',
    settle('C', () =>
      deps.channels.C(seed, fingerprint, ctx, {
        tightness: 'normal',
        seedIdentity: seedIdentity(seed),
      }),
    ),
  );

  // Channels run CONCURRENTLY but are HANDLED one at a time, in completion order: Stage 4
  // and Stage 5 for one channel finish before the next channel's are started. That keeps
  // the pool free of races (two channels verifying the same track) and the event stream
  // readable, and it is what makes "a candidate from A and C is scored once" true.
  while (pending.size > 0) {
    throwIfAborted(signal);
    const settled = await Promise.race(pending.values());
    pending.delete(settled.channel);
    await handleChannel(settled.channel, settled.outcome);
  }

  emit({ type: 'stage', stage: 'channels', status: 'done' });

  /* --- Stage 5b: rank. ------------------------------------------------------------- */

  emit({ type: 'stage', stage: 'rank', status: 'start' });
  const ranked = rank(recommendations, seed, {
    ...options,
    liveChannels: [...liveChannels],
  });
  emit({
    type: 'stage',
    stage: 'rank',
    status: 'done',
    message: `${ranked.results.length} kept, ${ranked.cut.length} cut`,
  });

  stats.cut = ranked.cut.map(({ rec, reason }) => ({
    key: rec.track.key,
    artist: rec.track.artist,
    title: rec.track.title,
    reason,
  }));

  // Signal-strength honesty: when the shipped list rests mostly on tags alone (no tempo,
  // no AcousticBrainz profile on one side), say so, so the listener knows the judgement is
  // coarser than a "both around 92 BPM"-grade match. The tier rides in each dimension note
  // (scorePair); here we only lift the count of tags-only recommendations into degraded[].
  const tagsOnly = ranked.results.filter(
    (rec) => tierFromDimensionNote(rec.dimensions[0]?.note) === 'tags-only',
  ).length;
  if (ranked.results.length > 0 && tagsOnly * 2 >= ranked.results.length) {
    degraded.push(
      `${tagsOnly} of ${ranked.results.length} recommendation(s) were judged on shared tags `
        + 'alone (no tempo or acoustic profile) — similarity is coarser for those',
    );
  }

  stats.durationMs = Date.now() - startedAt;
  stats.modelCalls = usage.calls;
  stats.tokens = tokenStats(usage);

  log(
    `done: ${ranked.results.length} results in ${stats.durationMs}ms · `
      + `${usage.calls} model call(s), ${usage.inputTokens} in / ${usage.outputTokens} out `
      + `(${usage.cacheReadTokens} cache read)`,
  );

  const run: RunRecord = {
    id: runId,
    seed,
    options,
    fingerprint,
    results: ranked.results,
    // The FULL scored candidate list, exactly as it was handed to `rank()` — every
    // verified+scored candidate with its dimensions, before any ranking rule ran. A replay
    // re-ranks THIS with the requested weights, so re-tuning is instant and keyless.
    scoredPool: [...recommendations],
    degraded,
    stats,
    engineVersion: ENGINE_VERSION,
    createdAt: Date.now(),
  };

  // An empty run is never cached: it is a run that went wrong, and replaying it for days
  // would turn one bad afternoon into a permanent answer. Neither is a run the ACCOUNT
  // crippled — a rate limit or an empty balance shortens the list for reasons that have
  // nothing to do with this seed, and `runs` has no TTL to expire the evidence.
  if (run.results.length > 0 && !accountFailed) {
    try {
      runsRepo.save(persistable(run), hash);
    } catch (error) {
      degraded.push(`run not cached: ${describeError(error)}`);
    }
  }

  emit({ type: 'final', results: run.results, degraded: run.degraded, stats: run.stats });
  emit({ type: 'stage', stage: 'done', status: 'done' });
  return run;

  /* --- the per-channel worker ------------------------------------------------------ */

  async function settle(
    channel: Channel,
    fn: () => Promise<ChannelOutcome>,
  ): Promise<{ channel: Channel; outcome: ChannelOutcome }> {
    try {
      return { channel, outcome: await fn() };
    } catch (error) {
      // A channel is not allowed to take the run down. The three real ones already catch
      // everything; this covers an injected fake and any future channel that forgets.
      return {
        channel,
        outcome: {
          channel,
          status: 'error',
          reason: describeError(error),
          candidates: [],
          live: false,
        },
      };
    }
  }

  /**
   * One channel's whole tail: the terminal `channel` event, dedupe against the pool,
   * Stage 4, the Channel-C tightening guard, Stage 5, the provisional `result`s and the
   * `verified` tally — in that order, which is the documented one.
   */
  async function handleChannel(channel: Channel, outcome: ChannelOutcome): Promise<void> {
    const started = Date.now();
    if (outcome.live) liveChannels.add(channel);
    // `stats` and the `channel` event keep the stage's own token — they are the receipt a
    // reviewer reads. `degraded[]` is read by a listener, so it gets `noteReason`'s words.
    for (const note of outcome.notes ?? []) degraded.push(`Channel ${channel}: ${noteReason(note)}`);

    if (outcome.status === 'skipped') {
      const reason = outcome.reason ?? 'skipped';
      stats.perChannel[channel].skipped = reason;
      degraded.push(`Channel ${channel} skipped: ${noteReason(reason)}`);
      emit({ type: 'channel', channel, status: 'skipped', reason });
      return;
    }
    if (outcome.status === 'error') {
      const reason = outcome.reason ?? 'unknown error';
      stats.perChannel[channel].skipped = `${ERROR_PREFIX}${reason}`;
      degraded.push(`Channel ${channel} failed: ${noteReason(reason)}`);
      emit({ type: 'channel', channel, status: 'error', reason });
      return;
    }

    if (outcome.reason) degraded.push(`Channel ${channel}: ${noteReason(outcome.reason)}`);
    // The spread Channel C actually delivered (measured from its own years), recorded once
    // for the first attempt: a narrow list is the "generic 1980s alternative rock sharing
    // nothing but the decade" failure arriving one stage early, and `eval/run.ts` flags it.
    if (channel === 'C' && outcome.spread && !stats.channelCSpread) {
      stats.channelCSpread = outcome.spread;
    }
    emit({ type: 'channel', channel, status: 'done', found: outcome.candidates.length });

    let found = 0;
    const fresh = ingest(channel, outcome);
    found += outcome.candidates.length;
    // One track per artist (diversity), then the run cap — so the verify budget covers many
    // artists instead of several tracks of the same few. Extra candidates stay in the pool,
    // unscored; they were going to be cut as duplicate-artist or over the cap anyway.
    const toVerify = takeDiverse(fresh);
    if (fresh.length > toVerify.length) {
      log(
        `pool cap: Channel ${channel} verifying ${toVerify.length} of ${fresh.length} new ` +
          `candidate(s) (one per artist, run cap ${MAX_VERIFIED_CANDIDATES})`,
      );
    }
    let verified = await verify(toVerify);
    throwIfAborted(signal);

    // Step 5 — the Channel-C guard. `channelC` is asked once more, with the stricter
    // prompt, when too much of what it named turned out not to exist.
    if (channel === 'C' && found > 0) {
      const dropRate = dropRateFor(outcome.candidates);
      stats.channelCRetry = { firstDropRate: round3(dropRate), retryDropRate: null, added: 0 };
      if (dropRate > CHANNEL_C_TIGHTEN_DROP_RATE) {
        log(`channel C drop rate ${(dropRate * 100).toFixed(0)}% — retrying with tightness=tight`);
        degraded.push(
          `Channel C drop rate ${(dropRate * 100).toFixed(0)}% (> ${
            CHANNEL_C_TIGHTEN_DROP_RATE * 100
          }%) — re-ran with the stricter prompt`,
        );
        const retry = await settle('C', () =>
          deps.channels.C(seed, fingerprint, ctx, {
            tightness: 'tight',
            seedIdentity: seedIdentity(seed),
          }),
        );
        throwIfAborted(signal);
        if (retry.outcome.status === 'done') {
          if (retry.outcome.live) liveChannels.add('C');
          const retryFresh = takeDiverse(ingest('C', retry.outcome));
          found += retry.outcome.candidates.length;
          const retryVerified = await verify(retryFresh);
          verified = [...verified, ...retryVerified];
          stats.channelCRetry = {
            firstDropRate: round3(dropRate),
            retryDropRate: round3(dropRateFor(retry.outcome.candidates)),
            added: retryVerified.length,
          };
        } else {
          degraded.push(
            `Channel C retry failed: ${retry.outcome.reason ?? retry.outcome.status}`,
          );
        }
      }
    }

    // Stage 5 — score only what this channel newly verified.
    await score(verified);
    throwIfAborted(signal);

    // The tally is last: `kept` counts every candidate this channel named that ended up
    // with a real track, including ones another channel had already verified.
    let kept = 0;
    const counted = new Set<PoolEntry>();
    for (const key of channelKeys(channel)) {
      const entry = byNormKey.get(key);
      if (!entry?.track || counted.has(entry)) continue;
      counted.add(entry);
      kept += 1;
    }
    const stat = stats.perChannel[channel];
    stat.found = found;
    stat.verified = kept;
    stat.dropped = Math.max(0, found - kept);
    emit({ type: 'verified', channel, kept, dropped: stat.dropped });
    log(`channel ${channel}: ${found} found, ${kept} verified in ${Date.now() - started}ms`);
  }

  /**
   * The share of a channel's candidates that did not survive Stage 4 — how many of the
   * names it produced the pool now holds WITHOUT a verified track (a name that verified
   * back to the seed, or to a track another channel already owns, counts as kept). Called
   * after Stage 4 for that channel; this is the number the spec's "if Channel C's drop
   * rate exceeds ~20%, tighten its prompt" is about.
   */
  function dropRateFor(candidates: Candidate[]): number {
    let seen = 0;
    let lost = 0;
    for (const raw of candidates) {
      const artist = raw.artist?.trim() ?? '';
      const title = raw.title?.trim() ?? '';
      if (!artist || !title) continue;
      seen += 1;
      const key = trackNormKey(artist, title);
      if (key === seedKeyNorm) {
        lost += 1;
        continue;
      }
      if (!byNormKey.get(key)?.track) lost += 1;
    }
    return seen === 0 ? 0 : lost / seen;
  }

  /** Every pool key this channel contributed to. */
  function channelKeys(channel: Channel): string[] {
    const out: string[] = [];
    for (const [key, entry] of byNormKey) {
      if (entry.candidate.channels.includes(channel)) out.push(key);
    }
    return out;
  }

  /**
   * Dedupe against the pool, drop the seed, attach evidence. Returns the entries that are
   * NEW to the pool — the only ones Stage 4 has to look at. An entry that was already
   * there gains a channel chip and, if it has already been scored, re-emits its `result`
   * so the UI can show the new chip immediately.
   */
  function ingest(channel: Channel, outcome: ChannelOutcome): PoolEntry[] {
    const index = evidenceIndex(outcome);
    const fresh: PoolEntry[] = [];

    for (const raw of outcome.candidates) {
      const artist = raw.artist?.trim() ?? '';
      const title = raw.title?.trim() ?? '';
      if (!artist || !title) continue;
      const key = trackNormKey(artist, title);
      if (key === seedKeyNorm) continue; // the seed is not a recommendation

      const rows = index[key]?.length ? index[key] : evidenceFromHints(channel, raw);
      const existing = byNormKey.get(key);
      if (existing) {
        if (!existing.candidate.channels.includes(channel)) {
          existing.candidate = {
            ...existing.candidate,
            channels: [...existing.candidate.channels, channel],
          };
        }
        existing.candidate = {
          ...existing.candidate,
          hints: [...existing.candidate.hints, ...raw.hints],
        };
        mergeEvidence(existing.evidence, rows);
        if (existing.rec) refresh(existing);
        continue;
      }

      const entry: PoolEntry = {
        key,
        candidate: { artist, title, channels: [channel], hints: [...raw.hints] },
        evidence: [...rows],
      };
      byNormKey.set(key, entry);
      fresh.push(entry);
    }
    return fresh;
  }

  /** Stage 4 for the entries a channel just added. Never throws. */
  async function verify(fresh: PoolEntry[]): Promise<VerifiedCandidate[]> {
    if (fresh.length === 0) return [];
    let results: VerifiedCandidate[] = [];
    try {
      results = await deps.verifyMany(
        fresh.map((e) => e.candidate),
        { concurrency: VERIFY_CONCURRENCY, ...(signal ? { signal } : {}) },
      );
    } catch (error) {
      if (error instanceof PipelineAbortError) throw error;
      degraded.push(`verification failed: ${describeError(error)}`);
      return [];
    }
    throwIfAborted(signal);

    const out: VerifiedCandidate[] = [];
    for (const item of results) {
      const key = trackNormKey(item.candidate.artist, item.candidate.title);
      const entry = byNormKey.get(key);
      if (!entry || entry.track) continue;

      // A candidate that verifies back to the SEED's own recording (a different spelling
      // of the same track) is not an answer. `normalize` keeps "The Lovecats" and "The
      // Love Cats" as different keys on purpose, so this is the only place it is caught.
      if (item.track.key === seed.key) continue;

      // Two spellings, one recording: fold this entry into the one that owns the track.
      const owner = byTrackKey.get(item.track.key);
      if (owner && owner !== entry) {
        owner.candidate = {
          ...owner.candidate,
          channels: [...new Set([...owner.candidate.channels, ...entry.candidate.channels])],
          hints: [...owner.candidate.hints, ...entry.candidate.hints],
        };
        mergeEvidence(owner.evidence, entry.evidence);
        byNormKey.set(key, owner);
        if (owner.rec) refresh(owner);
        continue;
      }

      entry.track = item.track;
      byTrackKey.set(item.track.key, entry);
      out.push({ candidate: entry.candidate, track: item.track });
    }
    return out;
  }

  /** Stage 5, the model half, plus the provisional `result` events. Never throws. */
  async function score(verified: VerifiedCandidate[]): Promise<void> {
    if (verified.length === 0) return;
    let outcome: ScoreOutcome;
    try {
      outcome = await deps.score(seed, fingerprint, verified, ctx);
    } catch (error) {
      if (error instanceof PipelineAbortError) throw error;
      degraded.push(`scoring failed for ${verified.length} candidate(s): ${describeError(error)}`);
      return;
    }
    throwIfAborted(signal);

    for (const item of outcome.scored) {
      const entry = byTrackKey.get(item.key);
      if (!entry?.track) continue;
      const rec = buildRecommendation(entry, entry.track, item);
      entry.rec = rec;
      recommendations.push(rec);
      publish(rec);
    }

    if (outcome.failed.length > 0) {
      // "unscored and dropped" is what happened; when the scorer knows it was the account
      // that stopped it, the line says which wall it hit rather than leaving the listener
      // to guess that the candidates were somehow at fault.
      const cause = outcome.reason ? noteReason(outcome.reason) : null;
      degraded.push(
        `${outcome.failed.length} candidate(s) came back unscored and were dropped`
          + (cause ? `: ${cause}` : ''),
      );
    }
  }

  function buildRecommendation(
    entry: PoolEntry,
    track: TrackRecord,
    scored: ScoredCandidate,
  ): Recommendation {
    const rec: Recommendation = {
      track,
      channels: [...entry.candidate.channels],
      evidence: [...entry.evidence],
      dimensions: scored.dimensions,
      modelScore: modelScore(scored.dimensions),
      finalScore: 0,
      why: scored.why,
      ...(scored.whyDiscriminates ? { whyDiscriminates: scored.whyDiscriminates } : {}),
      sharedTraits: scored.sharedTraits,
      sameArtist: isSameArtist(track.artist, seed.artist),
      // Stage 5's `is_cover_or_same_song` was collected at model cost and then dropped on
      // the floor. It rides here as a flag so `rank.ts` (rule 0) can cut it and the cut
      // shows up in `stats.cut` and in eval's report like every other one.
      flags: scored.isCoverOrSameSong
        ? [...scored.flags, FLAG_COVER_OR_SAME_SONG]
        : [...scored.flags],
    };
    return { ...rec, finalScore: finalScore(rec, { liveChannels: [...liveChannels] }) };
  }

  /** Re-emit a scored result whose channels or evidence just changed. */
  function refresh(entry: PoolEntry): void {
    if (!entry.rec) return;
    const next: Recommendation = {
      ...entry.rec,
      channels: [...entry.candidate.channels],
      evidence: [...entry.evidence],
    };
    const updated = { ...next, finalScore: finalScore(next, { liveChannels: [...liveChannels] }) };
    const at = recommendations.indexOf(entry.rec);
    if (at >= 0) recommendations[at] = updated;
    entry.rec = updated;
    publish(updated);
  }

  /**
   * A card that appears and then vanishes is the failure the spec calls out, so anything
   * `rank()` is CERTAIN to cut is never streamed as a provisional result. Certain means
   * the rules that depend on nothing but this candidate and that rule 6 never relaxes:
   * rule 0 (the seed's own song), rule 1 (same artist), rule 4's traits arm and rule 4b.
   * Spread, one-per-artist and over-length genuinely are not knowable until every channel
   * is in, so those stay in `final` where they belong.
   */
  function publish(rec: Recommendation): void {
    if (rec.flags.includes(FLAG_COVER_OR_SAME_SONG)) return;
    if (rec.sameArtist && !options.includeSameArtist) return;
    if (rec.flags.includes(FLAG_GENERIC_WHY)) return;
    const reasons = genreOnlyReasons(rec);
    if (reasons.includes('no-traits') || reasons.includes('blocklisted-traits')) return;
    emit({ type: 'result', item: rec, provisional: true });
  }
}

/* ------------------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------------------ */

/**
 * What Channel C is allowed to SCRUB ITSELF AGAINST. None of it is ever serialised into
 * that call: `channelCPayload` uses it to take the seed's own name back out of the
 * fingerprint's free text. The album is here because a fingerprint that says "the
 * Japanese Whispers-era joke" hands the channel the answer it is being kept from.
 */
function seedIdentity(seed: TrackRecord): SeedIdentity {
  return {
    artist: seed.artist,
    title: seed.title,
    ...(seed.album ? { album: seed.album } : {}),
  };
}

function emptyStats(): RunRecord['stats'] {
  return {
    perChannel: {
      A: { found: 0, verified: 0, dropped: 0 },
      B: { found: 0, verified: 0, dropped: 0 },
      C: { found: 0, verified: 0, dropped: 0 },
    },
    durationMs: 0,
    modelCalls: 0,
  };
}

function tokenStats(usage: ModelUsage): NonNullable<RunRecord['stats']['tokens']> {
  const snapshot = usage.snapshot();
  return {
    input: snapshot.inputTokens,
    output: snapshot.outputTokens,
    cacheRead: snapshot.cacheReadTokens,
    cacheCreation: snapshot.cacheCreationTokens,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function makeLogger(onLog: ((line: string) => void) | undefined, startedAt: number) {
  const debug = process.env.ITSTINGS_DEBUG === '1';
  return (line: string): void => {
    const stamped = `[pipeline +${Date.now() - startedAt}ms] ${line}`;
    if (onLog) {
      onLog(line);
      return;
    }
    if (debug) console.debug(stamped);
  };
}

/**
 * The stored form of a run. A Deezer preview URL is HMAC-signed and dead 15 minutes after
 * it was minted (docs/architecture.md, "Preview audio": never persist them), so the run
 * cache — which is read back days later — holds track ids and lets `replay` mint fresh
 * ones.
 */
export function persistable(run: RunRecord): RunRecord {
  const stripPreview = (rec: Recommendation): Recommendation => ({
    ...rec,
    track: stripVolatilePreview(rec.track),
  });
  return {
    ...run,
    seed: stripVolatilePreview(run.seed),
    results: run.results.map(stripPreview),
    // The pool holds the same tracks with their own signed preview URLs — strip them too,
    // or a replay days later would try to play a dead 15-minute Deezer link.
    scoredPool: run.scoredPool.map(stripPreview),
  };
}

/**
 * The per-channel block of the event sequence on REPLAY, identical in shape to the live
 * one so the UI has a single code path: `start` then the terminal status for each channel,
 * then the results, then the tallies.
 */
function channelOpenEvents(stats: RunRecord['stats']): PipelineEvent[] {
  const events: PipelineEvent[] = [];
  for (const channel of CHANNELS) {
    events.push({ type: 'channel', channel, status: 'start' });
    const s = stats.perChannel[channel];
    if (s.skipped?.startsWith(ERROR_PREFIX)) {
      events.push({
        type: 'channel',
        channel,
        status: 'error',
        reason: s.skipped.slice(ERROR_PREFIX.length),
      });
      continue;
    }
    if (s.skipped) {
      events.push({ type: 'channel', channel, status: 'skipped', reason: s.skipped });
      continue;
    }
    events.push({ type: 'channel', channel, status: 'done', found: s.found });
  }
  return events;
}

function channelVerifiedEvents(stats: RunRecord['stats']): PipelineEvent[] {
  const events: PipelineEvent[] = [];
  for (const channel of CHANNELS) {
    const s = stats.perChannel[channel];
    if (s.skipped) continue;
    events.push({ type: 'verified', channel, kept: s.verified, dropped: s.dropped });
  }
  return events;
}

/**
 * Replays a stored run as the SAME event sequence, with `cached: true` — including the
 * audio: every track goes back through `hydratePreview`, so a replayed card plays as well
 * as a live one.
 */
async function replay(
  stored: RunRecord,
  emit: (event: PipelineEvent) => void,
  options: RunOptions,
): Promise<RunRecord> {
  const seed = await freshPreview(stored.seed);

  // Re-rank the stored pool under the REQUESTED weights, so changing a weight is a free
  // cache hit that re-orders the same candidates with no network and no model. `weights`
  // is not in the cache key, so the stored run's own weights may differ from these; the
  // pool is identical either way. A pre-engine-4 run has no pool — fall back to its
  // stored results, which are already ranked.
  const reRanked = stored.scoredPool.length > 0
    ? rank(stored.scoredPool, stored.seed, {
        ...stored.options,
        // Pass the REQUESTED weights unconditionally so an absent param resolves to
        // DEFAULT_DIMENSION_WEIGHTS inside rank (opts.weights ?? DEFAULT) rather than
        // silently inheriting the weights the stored run was originally created with.
        weights: options.weights,
        liveChannels: liveChannelsFromStats(stored.stats),
      }).results
    : stored.results;

  const results: Recommendation[] = [];
  for (const item of reRanked) {
    results.push({ ...item, track: await freshPreview(item.track) });
  }
  const run: RunRecord = { ...stored, seed, results };

  emit({ type: 'run', runId: run.id, cached: true });
  emit({ type: 'stage', stage: 'resolve', status: 'start' });
  emit({ type: 'seed', track: run.seed });
  emit({ type: 'stage', stage: 'resolve', status: 'done' });
  emit({ type: 'stage', stage: 'fingerprint', status: 'start' });
  if (run.fingerprint) emit({ type: 'fingerprint', fingerprint: run.fingerprint });
  emit({ type: 'stage', stage: 'fingerprint', status: 'done' });
  emit({ type: 'stage', stage: 'channels', status: 'start' });
  for (const event of channelOpenEvents(run.stats)) emit(event);
  for (const item of run.results) emit({ type: 'result', item, provisional: true });
  for (const event of channelVerifiedEvents(run.stats)) emit(event);
  emit({ type: 'stage', stage: 'channels', status: 'done' });
  emit({ type: 'stage', stage: 'rank', status: 'start' });
  emit({ type: 'stage', stage: 'rank', status: 'done' });
  emit({ type: 'final', results: run.results, degraded: run.degraded, stats: run.stats });
  emit({ type: 'stage', stage: 'done', status: 'done' });
  return run;
}

/**
 * The channels that ran (were not skipped) in the stored run — the set `rank`'s enthusiasm
 * bonus is scoped to. Reconstructed from the persisted per-channel stats because the live
 * flag is not stored on its own; a channel served entirely from cache counts as run here,
 * which at most restores a 0.05 forum-enthusiasm bonus and never reorders a keyless run
 * (no channel returns forum evidence without a key).
 */
function liveChannelsFromStats(stats: RunRecord['stats']): Channel[] {
  return CHANNELS.filter((channel) => !stats.perChannel[channel].skipped);
}

/** Never lets a dead preview (or a dead Deezer) take a replay down. */
async function freshPreview(track: TrackRecord): Promise<TrackRecord> {
  try {
    return await hydratePreview(track);
  } catch {
    return { ...track, preview: null };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A minimal, honest stand-in seed for the RunRecord returned when the key resolved to
 * nothing. It is never persisted and never reaches `tracks`.
 */
function unresolvedSeed(seedKey: string): TrackRecord {
  return {
    key: seedKey,
    isrc: null,
    title: seedKey,
    artist: '',
    album: null,
    year: null,
    durationMs: null,
    artwork: null,
    preview: null,
    tempoBpm: null,
    keySignature: null,
    links: {},
    ids: {},
    tags: null,
    features: null,
    resolvedAt: 0,
    degraded: ['not resolved'],
  };
}
