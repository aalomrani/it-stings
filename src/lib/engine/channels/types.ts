/**
 * Shared shapes for the three candidate channels (A, B, C) and for the Stage-5 scorer.
 *
 * This file is deliberately tiny and dependency-free: it exists so `channels/a.ts`,
 * `channels/b.ts`, `channels/c.ts`, `score.ts` and `pipeline.ts` agree on one context
 * object and one result envelope without importing each other.
 *
 * Extend it ADDITIVELY (new optional fields, new exported types). Anything that belongs
 * to the app rather than to the engine's internals belongs in `src/lib/types.ts`.
 */

import type { Candidate, Channel } from '@/lib/types';
import type { ModelUsage } from '@/lib/engine/model';

/**
 * What every channel hands back. `live` says whether the channel actually reached its
 * upstream this run (as opposed to replaying a cache or being skipped) — `rank.ts` only
 * grants the enthusiasm bonus to channels that ran live.
 */
export interface ChannelResult {
  channel: Channel;
  status: 'done' | 'skipped' | 'error';
  /** Human-readable, shown in `degraded[]` / the `channel` event. */
  reason?: string;
  candidates: Candidate[];
  live: boolean;
  /**
   * Channel C only: the spread its answer ACTUALLY has, measured in code from the years it
   * returned rather than taken from the arrays it filled in about itself. docs/spec.md asks
   * that channel for "25-40 candidates spanning >=3 decades and >=3 genre labels"; a list
   * from one decade is "generic 1980s alternative rock sharing nothing but the decade" one
   * stage early, so the pipeline records it and the eval harness raises a flag.
   */
  spread?: ChannelSpread;
}

/** Measured, not self-reported. `ok` is false when the spec's spread ask was not met. */
export interface ChannelSpread {
  /** Distinct decades among the entries that carried a year, e.g. ["1950s", "1980s"]. */
  decades: string[];
  /** The model's own genre families, as it stated them (bookkeeping only). */
  genres: string[];
  /** Entries the channel kept. */
  entries: number;
  /** How many of them carried a usable year — the base `topDecadeShare` is computed on. */
  dated: number;
  /** The share of dated entries sitting in the single most-represented decade, 0-1. */
  topDecadeShare: number;
  ok: boolean;
}

/**
 * The per-run context threaded into every channel and into `scoreBatch`.
 *
 * `usage` is the run's model-call accumulator (`createUsageCounter()` in `engine/model.ts`);
 * `signal` is the client's AbortSignal, checked at every await; `log` is the pipeline's
 * line logger, used for stage timings and degrade notes.
 */
export interface ChannelContext {
  seedKey: string;
  usage: ModelUsage;
  signal?: AbortSignal;
  log: (line: string) => void;
}
