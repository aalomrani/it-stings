/**
 * The evidence stamp — the sentence under every row of a card's evidence trail.
 *
 * It is the page's claim about how fresh the thing it is quoting is, so it is decided by
 * the ROW (`Evidence.live`, `Evidence.fetchedAt`), not by whether its channel happened to
 * run: a live Channel B can and does quote a thread it read out of the 30-day evidence
 * cache, and that row must say `cached <date>`.
 */

import { describe, expect, it } from 'vitest';

import { day, evidenceStamp } from '@/lib/client/format';
import type { Evidence } from '@/lib/types';

const forum = (over: Partial<Evidence> = {}): Evidence => ({
  channel: 'B',
  kind: 'forum',
  url: 'https://www.reddit.com/r/ifyoulikeblank/comments/aaa/lovecats',
  sentence: 'closest thing I have found',
  ...over,
});

/** 2026-08-14T09:00:00Z */
const AUGUST = Date.UTC(2026, 7, 14, 9);

describe('day', () => {
  it('is the UTC calendar day, and null for anything unusable', () => {
    expect(day(AUGUST)).toBe('2026-08-14');
    expect(day(undefined)).toBeNull();
    expect(day(null)).toBeNull();
    expect(day(0)).toBeNull();
    expect(day(Number.NaN)).toBeNull();
  });
});

describe('evidenceStamp', () => {
  it('stamps a row this run fetched as live', () => {
    expect(evidenceStamp(forum({ live: true, fetchedAt: Date.now() }), ['A', 'B'])).toEqual({
      cls: 'live',
      text: 'live',
    });
  });

  it('stamps a cached row with its own date even when its channel ran live', () => {
    // The regression this exists for: Channel B ran, but THIS thread came out of the
    // evidence cache, and the old channel-derived stamp called it live.
    expect(evidenceStamp(forum({ live: false, fetchedAt: AUGUST }), ['A', 'B'])).toEqual({
      cls: 'cached',
      text: 'cached 2026-08-14 · not refreshed this run',
    });
  });

  it('never says live on a replayed run, whatever the row remembers', () => {
    // A cached run replays rows stored as `live: true` by the original run. The App
    // passes no live channels for one, and that is what the stamp obeys.
    expect(evidenceStamp(forum({ live: true, fetchedAt: AUGUST }), [])).toEqual({
      cls: 'cached',
      text: 'cached 2026-08-14 · not refreshed this run',
    });
  });

  it('falls back to the channel for a row with no stamp of its own', () => {
    // Channel C's model priors, and every row stored before `live`/`fetchedAt` existed.
    const prior: Evidence = { channel: 'C', kind: 'model_prior', detail: 'a model note' };
    expect(evidenceStamp(prior, ['C'])).toEqual({ cls: 'live', text: 'live' });
    expect(evidenceStamp(prior, [])).toEqual({
      cls: 'cached',
      text: 'cached · not refreshed this run',
    });
  });

  it('still reads a date out of `detail` when the row carries no fetchedAt', () => {
    const row: Evidence = { channel: 'A', kind: 'lastfm_tag', detail: 'tag: lounge · 2026-07-01' };
    expect(evidenceStamp(row, [])).toEqual({
      cls: 'cached',
      text: 'cached 2026-07-01 · not refreshed this run',
    });
  });
});
