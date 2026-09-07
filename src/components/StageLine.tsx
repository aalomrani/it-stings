'use client';

/**
 * The stage indicator: the bee bar and one plain-word phase caption, with the detailed
 * per-channel funnel demoted behind a disclosure.
 *
 * The pipeline is not linear — three channels resolve independently — so the fill is never a
 * timer: `runProgress` counts the stages that actually finished, and the caption names the
 * current phase in keyless words (no "web search", no "model prior"; Channel B is MusicBrainz
 * tag cohorts and Channel C is Deezer related-artists). The numbers the old receipt showed
 * inline — the per-channel found/verified funnel and the Stage-4 drop-rate warning — are all
 * still here, one click down, so nothing is lost, only quietened.
 */

import { BeeProgress } from '@/components/BeeProgress';
import { Caret } from '@/components/Icons';
import { pct1 } from '@/lib/client/format';
import { runProgress } from '@/lib/client/progress';
import { CHANNEL_LABEL, type RunState } from '@/lib/client/useRecommendStream';
import type { Channel } from '@/lib/types';

const CHANNELS: Channel[] = ['A', 'B', 'C'];
/** spec.md Stage 4: over this share of a channel's candidates failing to resolve is a bug. */
export const DROP_WARN = 0.2;

export function StageLine({ run }: { run: RunState }) {
  const progress = runProgress(run);

  const verifiedTotal = CHANNELS.reduce((sum, c) => sum + (run.channels[c].kept ?? 0), 0);
  const foundTotal = CHANNELS.reduce((sum, c) => sum + (run.channels[c].found ?? 0), 0);
  const shown = run.final ? run.final.length : run.provisional.length;

  const drops = CHANNELS.map((channel) => {
    const state = run.channels[channel];
    if (state.dropped === null) return null;
    const found = state.found ?? (state.kept ?? 0) + state.dropped;
    if (found <= 0) return null;
    return { channel, dropped: state.dropped, found, rate: state.dropped / found };
  }).filter((d): d is { channel: Channel; dropped: number; found: number; rate: number } => d !== null);

  // Only worth a disclosure once there is a number to show behind it — before the channels
  // report, the bar and caption are the whole story.
  const hasDetail = foundTotal > 0 || verifiedTotal > 0 || run.cached || drops.length > 0;

  return (
    <section className="beeprog" aria-label="Pipeline progress">
      <BeeProgress
        fraction={progress.fraction}
        caption={progress.caption}
        failed={progress.failed}
        done={progress.done}
        announcement={progress.announcement}
      />

      {hasDetail ? (
        <details className="beedet">
          <summary>
            <Caret />
            <span className="lbl-shut">run detail — per channel</span>
            <span className="lbl-open">hide the detail</span>
          </summary>

          <div className="beedet-body">
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
                        {pct1(drop.dropped, drop.found)} — over the 20% threshold, tighten the
                        Channel {drop.channel} query
                      </span>
                    ) : (
                      pct1(drop.dropped, drop.found)
                    )}
                    )
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
