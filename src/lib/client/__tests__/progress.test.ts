/**
 * The bee bar's fill and phase caption.
 *
 * The receipt's ✓-row became a single bar and one plain-word phase, but the derivation
 * underneath — how `verify` is known to be running before its `stage` event, how a pre-Stage-1
 * refusal is a failure with no stage events — is the same, and load-bearing. So it is pulled
 * into `runProgress` (pure) and pinned here, the way the receipt never could be while it was
 * tangled into JSX.
 */

import { describe, expect, it } from 'vitest';

import { PHASE_LABEL, runProgress } from '@/lib/client/progress';
import { emptyRun, type RunState } from '@/lib/client/useRecommendStream';
import type { Recommendation } from '@/lib/types';

function run(patch: (r: RunState) => void): RunState {
  const r = emptyRun();
  patch(r);
  return r;
}

const rec = { track: { key: 'k' } } as unknown as Recommendation;

describe('runProgress', () => {
  it('is idle and captionless before the stream opens', () => {
    const p = runProgress(emptyRun());
    expect(p.caption).toBe('');
    expect(p.failed).toBe(false);
    expect(p.done).toBe(false);
    expect(p.fraction).toBeLessThan(0.1);
  });

  it('names the running phase in keyless words and moves the bar within it', () => {
    const p = runProgress(
      run((r) => {
        r.streaming = true;
        r.stages.resolve = 'now';
      }),
    );
    expect(p.stage).toBe('resolve');
    expect(p.caption).toBe(PHASE_LABEL.resolve);
    expect(p.caption).toBe('resolving');
    expect(p.fraction).toBeGreaterThan(0.04);
    expect(p.fraction).toBeLessThan(0.5);
  });

  it('reads verify as running while candidates land, before its own stage event', () => {
    const p = runProgress(
      run((r) => {
        r.streaming = true;
        r.stages.resolve = 'done';
        r.stages.fingerprint = 'done';
        r.stages.channels = 'done';
        r.channels.A = { status: 'done', found: 10, reason: null, kept: null, dropped: null };
      }),
    );
    expect(p.stage).toBe('verify');
    expect(p.caption).toBe(PHASE_LABEL.verify);
    // three of seven stages finished plus half a slot for the running one
    expect(p.fraction).toBeCloseTo(0.5, 5);
  });

  it('fills to the top and reads "done" once the ranked list lands', () => {
    const p = runProgress(
      run((r) => {
        r.final = [rec];
        (Object.keys(r.stages) as (keyof typeof r.stages)[]).forEach((s) => (r.stages[s] = 'done'));
      }),
    );
    expect(p.done).toBe(true);
    expect(p.failed).toBe(false);
    expect(p.caption).toBe('done');
    expect(p.fraction).toBe(1);
    expect(p.announcement).toContain('finished — 1 tracks');
  });

  it('a pre-Stage-1 refusal is a failure with no stage events — the sting stops in blood', () => {
    const p = runProgress(run((r) => (r.error = 'the daily run budget is spent')));
    expect(p.failed).toBe(true);
    expect(p.done).toBe(false);
    expect(p.caption).toBe('stopped');
    expect(p.fraction).toBeLessThan(1);
    expect(p.announcement).toContain('the daily run budget is spent');
  });

  it('a mid-run stage error parks the bar at the stage that broke', () => {
    const p = runProgress(
      run((r) => {
        r.streaming = true;
        r.stages.resolve = 'done';
        r.stages.fingerprint = 'done';
        r.stages.channels = 'error';
      }),
    );
    expect(p.failed).toBe(true);
    expect(p.stage).toBe('channels');
    expect(p.caption).toBe('stopped');
  });
});

describe('PHASE_LABEL', () => {
  it('carries no LLM-era wording — the keyless engine never says web search or model prior', () => {
    const all = Object.values(PHASE_LABEL).join(' ').toLowerCase();
    expect(all).not.toContain('web search');
    expect(all).not.toContain('model');
  });
});
