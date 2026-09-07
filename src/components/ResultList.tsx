'use client';

/**
 * The result list. One column, cards of different heights, alternating nine-slice edge
 * geometries so no two neighbours share a frame — never a card grid.
 *
 * It is a roving-tabindex list: exactly one card is in the tab order, ↑/↓ and j/k move
 * focus between them, and the per-card shortcuts (Space, Enter, `s`) live on the card.
 *
 * Provisional results render in arrival order as they stream in. When `final` lands the
 * list re-sorts to its order in ONE step — no eased reflow: this direction has exactly one
 * moving thing per page and it is the scoring blot on the receipt line.
 */

import { useEffect, useId, useRef, useState } from 'react';

import type { ReactNode } from 'react';

import { ResultCard } from '@/components/ResultCard';
import { Tear } from '@/components/Icons';
import type { FeedbackLabel, FeedbackSource } from '@/lib/client/train';
import type { Channel, Recommendation } from '@/lib/types';

export interface ResultListProps {
  results: Recommendation[];
  seedKey: string;
  liveChannels: Channel[];
  /** True until `final` lands: the heading says these are provisional and unsorted. */
  provisional: boolean;
  scored: number;
  verified: number;
  /** This browser's standing votes for the current seed, keyed by candidate track key. */
  feedback: Record<string, FeedbackLabel>;
  onFeedback: (candidateKey: string, label: FeedbackLabel, source: FeedbackSource) => void;
  /** The "add a song you think matches" control, dropped into the header. */
  addControl?: ReactNode;
}

export function ResultList({
  results,
  seedKey,
  liveChannels,
  provisional,
  scored,
  verified,
  feedback,
  onFeedback,
  addControl,
}: ResultListProps) {
  const hintId = useId();
  const [focus, setFocus] = useState(0);
  const els = useRef<(HTMLElement | null)[]>([]);
  const wanted = useRef<number | null>(null);

  // Focus is moved after the render that changed the tabindex, never during it.
  useEffect(() => {
    if (wanted.current === null) return;
    els.current[wanted.current]?.focus();
    wanted.current = null;
  });

  function move(from: number, delta: number) {
    const next = Math.max(0, Math.min(results.length - 1, from + delta));
    if (next === from) return;
    setFocus(next);
    wanted.current = next;
  }

  return (
    <>
      <div className="sec">
        <h2>What it found</h2>
        <span className="tape">
          {results.length} of {verified || scored} scored
        </span>
        <span>
          {provisional
            ? 'streaming as batches land · arrival order until the ranked list arrives'
            : 'sorted by final score · one track per artist'}
        </span>
        {addControl}
      </div>
      <Tear />

      {/* The shortcuts are printed BEFORE the cards and pointed at by every card's
          `aria-describedby`: a hint a user only meets after tabbing past fifteen cards is
          a hint they no longer need. */}
      <p className="keyhint" id={hintId}>
        ↑ ↓ or j k move between cards · space plays the focused card · enter opens the working ·
        s saves it
      </p>

      {/* The roving-tabindex column is a list, and a screen reader is told how long it is
          and where in it each card sits. */}
      <div role="list" aria-label={`${results.length} recommendations`}>
        {results.map((rec, index) => (
          <ResultCard
            key={rec.track.key}
            rec={rec}
            index={index}
            setSize={results.length}
            seedKey={seedKey}
            alt={index % 2 === 1}
            focused={index === Math.min(focus, results.length - 1)}
            onFocus={() => setFocus(index)}
            onMove={(delta) => move(index, delta)}
            describedBy={hintId}
            elRef={(el) => {
              els.current[index] = el;
            }}
            liveChannels={liveChannels}
            feedback={feedback[rec.track.key] ?? null}
            onFeedback={onFeedback}
          />
        ))}
      </div>
    </>
  );
}
