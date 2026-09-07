'use client';

/**
 * Debounced iTunes typeahead, 200 ms, minimum two characters (spec.md Stage 1, and the
 * route agrees: a one-character prefix never reaches iTunes because it would burn the
 * 20-requests-per-minute budget on every keystroke).
 *
 * The in-flight request is aborted whenever the query changes, so the list can never be
 * overwritten by a slower answer to an older query.
 */

import { useEffect, useRef, useState } from 'react';

import { search, type TypeaheadHit } from '@/lib/client/api';

export const DEBOUNCE_MS = 200;
export const MIN_CHARS = 2;

export interface TypeaheadState {
  hits: TypeaheadHit[];
  /** A request is out, or one is waiting on the debounce. */
  pending: boolean;
  error: string | null;
  /** The query the hits actually answer. */
  answered: string;
}

const IDLE: TypeaheadState = { hits: [], pending: false, error: null, answered: '' };

/** Waiting on the debounce, or on iTunes. Derived, never stored. */
const PENDING: TypeaheadState = { hits: [], pending: true, error: null, answered: '' };

export function useTypeahead(query: string, enabled: boolean): TypeaheadState {
  const [state, setState] = useState<TypeaheadState>(IDLE);
  const abort = useRef<AbortController | null>(null);
  const term = query.trim();
  const on = enabled && term.length >= MIN_CHARS;
  const answered = state.answered;

  useEffect(() => {
    abort.current?.abort();
    if (!on) return;
    // Already answered — re-opening a list closed with Escape must not spend a second
    // request out of the 20-per-minute iTunes budget on a query iTunes already answered.
    if (answered === term) return;

    const controller = new AbortController();
    abort.current = controller;

    const timer = setTimeout(() => {
      search(term, controller.signal)
        .then((hits) => {
          if (controller.signal.aborted) return;
          setState({ hits, pending: false, error: null, answered: term });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            hits: [],
            pending: false,
            error: err instanceof Error ? err.message : 'search failed',
            answered: term,
          });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, on, answered]);

  // The state is only ever an ANSWER. Whether the field is idle or waiting is derived from
  // the query on screen, so no effect has to write state synchronously to say so.
  //
  // A CLOSED list does not discard the answer it already has. Only the effect is gated by
  // `on`, so nothing is fetched while the list is shut — but the hits survive, which is
  // what lets ArrowDown re-open the popup after Escape (the WAI-ARIA combobox rule)
  // without spending another request out of the 20-per-minute iTunes budget.
  if (term.length < MIN_CHARS) return IDLE;
  if (state.answered === term) return state;
  return enabled ? PENDING : IDLE;
}

/** The mono line under the field: what the search is doing, in words. */
export function typeaheadHint(state: TypeaheadState, query: string, enabled: boolean): string {
  if (!enabled || query.trim().length < MIN_CHARS) {
    return 'type it, then pick the exact track from the list';
  }
  if (state.pending) return 'searching itunes';
  if (state.error) return `itunes did not answer — ${state.error}`;
  if (state.hits.length === 0) return 'nothing on itunes for that';
  return 'type it, then pick the exact track from the list';
}
