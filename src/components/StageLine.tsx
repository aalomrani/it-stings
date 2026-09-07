'use client';

/**
 * The stage indicator: a pasted receipt whose band is rotated −0.5°, never a progress bar.
 * The pipeline is not linear — three channels resolve independently and results stream in
 * — so a bar would be a lie. Three lines of mono instead: the stages, the per-channel
 * funnel as its numbers arrive, and the drop-rate line.
 *
 * The drop-rate line is not optional: it surfaces spec.md Stage 4's own rule ("if Channel
 * C's drop rate exceeds ~20%, tighten its prompt") the moment the run breaks it.
 */

import { Blot, Cross, Hollow, Tick } from '@/components/Icons';
import { pct1 } from '@/lib/client/format';
import {
  CHANNEL_LABEL,
  STAGE_LABEL,
  STAGE_ORDER,
  type RunState,
  type StageStatus,
} from '@/lib/client/useRecommendStream';
import type { Channel } from '@/lib/types';

const CHANNELS: Channel[] = ['A', 'B', 'C'];
/** spec.md Stage 4: over this share of a channel's candidates failing to resolve is a bug. */
export const DROP_WARN = 0.2;

export function StageLine({ run }: { run: RunState }) {
  const verifiedTotal = CHANNELS.reduce((sum, c) => sum + (run.channels[c].kept ?? 0), 0);
  const foundTotal = CHANNELS.reduce((sum, c) => sum + (run.channels[c].found ?? 0), 0);
  const shown = run.final ? run.final.length : run.provisional.length;

  // A run that ended in an error did not finish; the terminal step says so in a WORD as
  // well as in colour (design.md §2 rule 2), because that line is the one a user scans
  // for "did this work".
  const brokeAt = STAGE_ORDER.find((stage) => run.stages[stage] === 'error') ?? null;
  const failed = run.error !== null || brokeAt !== null;

  // `verify` runs for as long as candidates are landing, but the route only emits its
  // `stage` event at the end, so the receipt would print `verify ○ todo` beside its own
  // funnel line saying "15 found verifying". Derive it: anything found and nothing kept
  // yet means verification is what is happening right now.
  const verifying =
    run.stages.verify === 'todo' &&
    !failed &&
    foundTotal > 0 &&
    CHANNELS.every((c) => run.channels[c].kept === null);

  // A run refused before Stage 1 — the day's budget, the hourly cap — arrives as a bare
  // `error` event with no `stage` events at all. Nothing then contradicts the trailing pip,
  // so it would read a grey `done` beside a run that never started.
  const neverStarted = STAGE_ORDER.every((stage) => run.stages[stage] === 'todo');

  const status = (stage: (typeof STAGE_ORDER)[number]): StageStatus => {
    if (stage === 'verify' && verifying) return 'now';
    if (stage === 'done' && failed && (run.stages.done === 'done' || neverStarted)) return 'error';
    return run.stages[stage];
  };

  // One polite region for the whole run, one sentence per state change — enough for a
  // screen reader to know the stream progressed and finished, not enough to chatter as
  // each batch lands.
  const current = STAGE_ORDER.find((stage) => status(stage) === 'now');
  const announcement = failed
    ? `run stopped — ${run.error ?? `${brokeAt ? STAGE_LABEL[brokeAt] : 'a stage'} failed`}`
    : run.final
      ? `finished — ${run.final.length} tracks, sorted by final score`
      : current
        ? `${STAGE_LABEL[current]} — running`
        : run.streaming
          ? 'starting'
          : '';

  // `aria-current="step"` names ONE step; when verify runs alongside the channels, the
  // earliest running stage is the one the pipeline is nominally at.
  const currentStep = current ?? null;

  const drops = CHANNELS.map((channel) => {
    const state = run.channels[channel];
    if (state.dropped === null) return null;
    const found = state.found ?? (state.kept ?? 0) + state.dropped;
    if (found <= 0) return null;
    return { channel, dropped: state.dropped, found, rate: state.dropped / found };
  }).filter((d): d is { channel: Channel; dropped: number; found: number; rate: number } => d !== null);

  return (
    <section className="stages" aria-label="Pipeline progress">
      <p className="sr" role="status">
        {announcement}
      </p>

      <ol className="steps">
        {STAGE_ORDER.map((stage) => {
          const state = status(stage);
          const cls =
            state === 'done' ? 'done' : state === 'now' ? 'now' : state === 'error' ? 'err' : 'todo';
          const word = stage === 'done' && state === 'error' ? 'stopped' : STAGE_LABEL[stage];
          return (
            <li
              key={stage}
              className={cls}
              {...(stage === currentStep ? { 'aria-current': 'step' as const } : {})}
            >
              {state === 'done' ? (
                <Tick />
              ) : state === 'now' ? (
                <Blot />
              ) : state === 'error' ? (
                <Cross />
              ) : (
                <Hollow />
              )}
              {word}
            </li>
          );
        })}
      </ol>

      {run.cached ? (
        <p className="chan cachedrun">
          <span>
            <b>cached run</b> — replayed from the run cache, nothing was fetched today
          </span>
        </p>
      ) : null}

      <p className="chan">
        {CHANNELS.map((channel) => {
          const state = run.channels[channel];
          const name = CHANNEL_LABEL[channel];
          return (
            <span key={channel} className={state.status === 'skipped' ? 'skip' : undefined}>
              {state.status === 'skipped' ? (
                <>
                  channel <b>{channel}</b> {name} — skipped
                </>
              ) : state.status === 'idle' ? (
                <>
                  channel <b>{channel}</b> {name} — waiting
                </>
              ) : state.status === 'error' ? (
                <>
                  channel <b>{channel}</b> {name} — failed
                </>
              ) : (
                <>
                  channel <b>{channel}</b> {name}{' '}
                  {state.found !== null ? <b>{state.found}</b> : <b>…</b>} found{' '}
                  {state.kept !== null ? (
                    <>
                      <b>{state.kept}</b> verified
                    </>
                  ) : (
                    'verifying'
                  )}
                </>
              )}
              <span className="sep"> · </span>
            </span>
          );
        })}
        <span>
          <b>{verifiedTotal}</b> verified of <b>{foundTotal}</b> found
        </span>
        <span className="sep">·</span>
        <span>
          {run.final ? (
            <>
              ranked <b>{shown}</b> of <b>{verifiedTotal}</b>
            </>
          ) : (
            <>
              scoring <b>{shown}</b> of <b>{verifiedTotal || foundTotal}</b>
            </>
          )}
        </span>
      </p>

      {drops.length > 0 ? (
        <p className="drops">
          dropped in verify — did not resolve to a real track:{' '}
          {drops.map((drop, index) => (
            <span key={drop.channel}>
              {index > 0 ? ' · ' : ''}
              {drop.channel}{' '}
              <b>
                {drop.dropped} of {drop.found}
              </b>{' '}
              (
              {drop.rate > DROP_WARN ? (
                <span className="warn">
                  {pct1(drop.dropped, drop.found)} — over the 20% threshold, tighten the Channel{' '}
                  {drop.channel} prompt
                </span>
              ) : (
                pct1(drop.dropped, drop.found)
              )}
              )
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
