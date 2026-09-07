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

import { CONSEQUENCE, FALLBACK_CONSEQUENCE, consequenceFor } from '@/components/DegradedNotice';
import {
  BAD_API_KEY_DEGRADED,
  BILLING_DEGRADED,
  NO_MODEL_DEGRADED,
  OVERLOADED_DEGRADED,
  RATE_LIMITED_DEGRADED,
  plainReason,
} from '@/lib/engine/pipeline';
import { ACCOUNT_FAILURE_REASONS } from '@/lib/engine/model';

const WHOLE_RUN: [string, string][] = [
  ['no key', NO_MODEL_DEGRADED],
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
    // Five different failures, five different sentences: two of them matching the same
    // entry would mean one of the causes is unreachable.
    expect(said.size).toBe(WHOLE_RUN.length);
  });

  it('carries the one action, which the degraded line itself never repeats', () => {
    expect(consequenceFor(BILLING_DEGRADED)).toMatch(/console\.anthropic\.com/);
    expect(BILLING_DEGRADED).not.toMatch(/console\.anthropic\.com/);

    expect(consequenceFor(NO_MODEL_DEGRADED)).toMatch(/Set ANTHROPIC_API_KEY/);
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
