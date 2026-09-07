/**
 * The run reduced to a bee-bar fill and one plain-word caption.
 *
 * The pipeline is not linear — three channels resolve independently — so the old receipt
 * refused a progress bar. This module keeps that honesty in the numbers (the fill is a
 * count of the stages that actually finished, never a timer) while giving the page a single
 * moving thing to read: how far the sting has travelled, and the current phase in words a
 * listener uses. No "web search", no "model prior" — the keyless engine's phases are
 * `resolving → reading the song → browsing for candidates → checking they’re real → scoring
 * the matches → ranking → done`.
 *
 * Kept a pure module (no React, no DOM) so it unit-tests like `weights.ts`; `StageLine`
 * renders what it returns.
 */

import { STAGE_LABEL, STAGE_ORDER, type RunState, type StageStatus } from '@/lib/client/useRecommendStream';
import type { Channel, PipelineStage } from '@/lib/types';

const CHANNELS: Channel[] = ['A', 'B', 'C'];

/** The current phase, spoken the way a listener would, not the way the pipeline is coded. */
export const PHASE_LABEL: Record<PipelineStage, string> = {
  resolve: 'resolving',
  fingerprint: 'reading the song',
  channels: 'browsing for candidates',
  verify: 'checking they’re real',
  score: 'scoring the matches',
  rank: 'ranking',
  done: 'done',
};

export interface Progress {
  /** 0..1 fill for the bee bar — the share of stages that have finished. */
  fraction: number;
  /** The stage the bar is parked at: the running one, the one it broke at, or `done`. */
  stage: PipelineStage;
  /** The visible one-word phase, e.g. `scoring the matches`. Empty before the stream opens. */
  caption: string;
  /** A run that ended in an error did not finish — the sting stops where it stuck, in blood. */
  failed: boolean;
  /** The ranked list landed and nothing failed. */
  done: boolean;
  /** One sentence for the polite live region, matching the old receipt's wording exactly. */
  announcement: string;
}

/**
 * The effective status of one stage, resolving the two cases the raw `run.stages` map cannot
 * express on its own: `verify` runs while candidates land but only emits its `stage` event at
 * the end, and a run refused before Stage 1 arrives as a bare `error` with no `stage` events.
 * Same derivation the receipt used, kept here so the bar and any future view agree.
 */
export function runProgress(run: RunState): Progress {
  const foundTotal = CHANNELS.reduce((sum, c) => sum + (run.channels[c].found ?? 0), 0);

  const brokeAt = STAGE_ORDER.find((stage) => run.stages[stage] === 'error') ?? null;
  const failed = run.error !== null || brokeAt !== null;

  const verifying =
    run.stages.verify === 'todo' &&
    !failed &&
    foundTotal > 0 &&
    CHANNELS.every((c) => run.channels[c].kept === null);

  const neverStarted = STAGE_ORDER.every((stage) => run.stages[stage] === 'todo');

  const status = (stage: PipelineStage): StageStatus => {
    if (stage === 'verify' && verifying) return 'now';
    if (stage === 'done' && failed && (run.stages.done === 'done' || neverStarted)) return 'error';
    return run.stages[stage];
  };

  const current = STAGE_ORDER.find((stage) => status(stage) === 'now') ?? null;
  const doneCount = STAGE_ORDER.filter((stage) => status(stage) === 'done').length;
  const done = !failed && run.final !== null;

  // The stage the bar is parked at. A finished run reads `done`; a failed one the stage it
  // broke at (or, for a pre-Stage-1 refusal, whatever was running / `done` as the terminal).
  const lastReached = [...STAGE_ORDER].reverse().find((stage) => status(stage) === 'done') ?? 'resolve';
  const stage: PipelineStage = done
    ? 'done'
    : failed
      ? (brokeAt ?? current ?? lastReached)
      : (current ?? (neverStarted ? 'resolve' : lastReached));

  // The fill counts finished stages, plus half a slot for the one now running, so the bar
  // moves within a stage instead of jumping only on completion. Done pins it full; a failure
  // leaves it where it stuck. Never below a sliver once the stream is open, so the sting is
  // always visible on the bar.
  const raw = done ? 1 : (doneCount + (current ? 0.5 : 0)) / STAGE_ORDER.length;
  const fraction = run.streaming || done || failed ? Math.max(0.04, Math.min(1, raw)) : Math.min(1, raw);

  const caption = failed
    ? 'stopped'
    : done
      ? 'done'
      : current
        ? PHASE_LABEL[current]
        : run.streaming
          ? PHASE_LABEL[stage]
          : '';

  // Byte-for-byte the receipt's old announcement, so the screen-reader contract is unchanged.
  const announcement = failed
    ? `run stopped — ${run.error ?? `${brokeAt ? STAGE_LABEL[brokeAt] : 'a stage'} failed`}`
    : run.final
      ? `finished — ${run.final.length} tracks, sorted by final score`
      : current
        ? `${STAGE_LABEL[current]} — running`
        : run.streaming
          ? 'starting'
          : '';

  return { fraction, stage, caption, failed, done, announcement };
}
