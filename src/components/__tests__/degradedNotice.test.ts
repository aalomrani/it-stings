/**
 * The wording contract between `pipeline.ts` and the notice.
 *
 * The failure lines are constants in the engine; the sentences that turn them into a
 * CONSEQUENCE are regexes in `DegradedNotice.tsx`. Nothing a compiler checks joins the
 * two, and the failure is silent: reword a constant and the notice quietly falls back to
 * the generic sentence — which is the exact non-actionable outcome the account-failure
 * wording exists to remove. So every constant is pinned to its own entry here.
 */

import { describe, expect, it } from 'vitest';

import {
  CONSEQUENCE,
  FALLBACK_CONSEQUENCE,
  consequenceFor,
  degradedBadgeLabel,
} from '@/components/DegradedNotice';
import { CHANNEL_LABEL } from '@/lib/client/useRecommendStream';
import {
  BAD_API_KEY_DEGRADED,
  BILLING_DEGRADED,
  OVERLOADED_DEGRADED,
  RATE_LIMITED_DEGRADED,
  plainReason,
} from '@/lib/engine/pipeline';
import { ACCOUNT_FAILURE_REASONS } from '@/lib/engine/model';

// The no-key whole-run degrade is gone with the LLM: the keyless engine never emits it.
// The account-failure wordings stay as a dead safety net (see `pipeline.ts`) and are still
// pinned here so a reworded constant cannot silently fall through to the generic sentence.
const WHOLE_RUN: [string, string][] = [
  ['no credit', BILLING_DEGRADED],
  ['a rejected key', BAD_API_KEY_DEGRADED],
  ['a rate limit', RATE_LIMITED_DEGRADED],
  ['an outage', OVERLOADED_DEGRADED],
];

describe('consequenceFor', () => {
  it('gives each whole-run degrade its own sentence, never the generic one', () => {
    const said = new Set<string>();
    for (const [what, line] of WHOLE_RUN) {
      const say = consequenceFor(line);
      expect(say, `${what} fell through to the fallback`).not.toBe(FALLBACK_CONSEQUENCE);
      said.add(say);
    }
    // Each failure gets a distinct sentence: two matching the same entry would mean one
    // of the causes is unreachable.
    expect(said.size).toBe(WHOLE_RUN.length);
  });

  it('carries the one action, which the degraded line itself never repeats', () => {
    expect(consequenceFor(BILLING_DEGRADED)).toMatch(/console\.anthropic\.com/);
    expect(BILLING_DEGRADED).not.toMatch(/console\.anthropic\.com/);

    expect(consequenceFor(RATE_LIMITED_DEGRADED)).toMatch(/Wait a minute/);
    expect(consequenceFor(BAD_API_KEY_DEGRADED)).toMatch(/Check the ANTHROPIC_API_KEY/);
    // The deployed app has no `.env.local` — the Dockerfile excludes `.env*` and the key
    // arrives as a Fly secret — so no sentence may send the reader to that file.
    for (const [, line] of WHOLE_RUN) {
      expect(line).not.toMatch(/env\.local/);
      expect(consequenceFor(line)).not.toMatch(/env\.local/);
    }
  });

  it('says the same thing for the same cause mid-run, when a cached fingerprint got past stage 2', () => {
    // `plainReason` puts the cause into a line that names the stage instead of the run;
    // the notice has to recognise it there too, or a channel failure prints the generic
    // sentence while the identical failure at stage 2 prints the useful one.
    for (const reason of ACCOUNT_FAILURE_REASONS) {
      const line = `Channel C failed: ${plainReason(reason)}`;
      expect(consequenceFor(line), line).not.toBe(FALLBACK_CONSEQUENCE);
    }
  });

  it('falls back for a line it does not know, rather than saying nothing', () => {
    expect(consequenceFor('Channel B skipped: no TAVILY_API_KEY')).toBe(FALLBACK_CONSEQUENCE);
  });

  it('keeps the catch-all last: order is what makes the specific entries reachable', () => {
    const generic = CONSEQUENCE.findIndex((c) => c.match.source === 'recommendations unavailable');
    expect(generic).toBeGreaterThan(-1);
    for (const [, line] of WHOLE_RUN) {
      const first = CONSEQUENCE.findIndex((c) => c.match.test(line));
      expect(first, line).toBeLessThan(generic);
    }
  });
});

describe('degradedBadgeLabel', () => {
  // The soft skip list is now a silent "!" dot; its meaning lives entirely in the summary's
  // label and title, so the label has to say how many there are and that opening it explains
  // the cost. A wrong count here is a lie the glyph cannot correct.
  it('names the count and singular/plural, and points at the consequence', () => {
    expect(degradedBadgeLabel(['a'])).toContain('1 thing');
    expect(degradedBadgeLabel(['a'])).not.toContain('1 things');
    expect(degradedBadgeLabel(['a', 'b'])).toContain('2 things');
    expect(degradedBadgeLabel(['a', 'b', 'c'])).toMatch(/what each one cost|cost/);
  });
});

describe('CHANNEL_LABEL', () => {
  // The detail line names each channel; the LLM-era "web search" / "model prior" were retired
  // when the engine went keyless (Channel B is MusicBrainz tag cohorts, Channel C is Deezer
  // related-artists). A stale label here would describe a pipeline that no longer exists.
  it('has no LLM-era wording', () => {
    const all = Object.values(CHANNEL_LABEL).join(' ').toLowerCase();
    expect(all).not.toContain('web search');
    expect(all).not.toContain('model prior');
  });

  it('names the keyless sources', () => {
    expect(CHANNEL_LABEL.B).toContain('musicbrainz');
    expect(CHANNEL_LABEL.C).toContain('deezer');
  });
});
