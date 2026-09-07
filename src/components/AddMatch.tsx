'use client';

/**
 * "add a song you think matches" — teach the engine a match it didn't surface.
 *
 * A shut disclosure by the "What it found" header; opening it reveals the same paper
 * search strip the page uses everywhere else (`SearchBar` in its `bar` variant, driven by
 * the shared `useTypeahead`). Picking a track hands it up to `onPick`, which resolves it and
 * records a `match` / `added` vote against the current seed — the list then re-ranks to the
 * re-learned weights like any other feedback.
 *
 * Self-contained: it owns its query, its open state and its own typeahead, so it never
 * touches the seed search strip at the top of the page. `onPick` is awaited so this can show
 * a pending line while the track resolves and a one-line confirmation when it lands.
 */

import { useId, useState } from 'react';

import { SearchBar } from '@/components/SearchBar';
import type { TypeaheadHit } from '@/lib/client/api';
import { typeaheadHint, useTypeahead } from '@/lib/client/useTypeahead';

export interface AddMatchProps {
  /** Resolve the picked track and record the `match` vote. Rejects with a message on failure. */
  onPick: (hit: TypeaheadHit) => Promise<void>;
  /** No seed, no target for the vote — the control hides itself. */
  disabled?: boolean;
}

export function AddMatch({ onPick, disabled = false }: AddMatchProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const typeahead = useTypeahead(query, open && expanded);

  if (disabled) return null;

  function pick(hit: TypeaheadHit) {
    setOpen(false);
    setBusy(true);
    setError(null);
    setNote(null);
    onPick(hit)
      .then(() => {
        setNote(`added ${hit.title} — ${hit.artist} as a match`);
        setQuery('');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'could not add that track');
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="addm">
      <button
        type="button"
        className={expanded ? 'btn bare addm-toggle on' : 'btn bare addm-toggle'}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => {
          setExpanded((was) => !was);
          setError(null);
        }}
      >
        {expanded ? 'close' : '+ add a song you think matches'}
      </button>

      <div id={panelId} className="addm-panel" hidden={!expanded}>
        <SearchBar
          variant="bar"
          value={query}
          onChange={setQuery}
          onSelect={pick}
          typeahead={typeahead}
          open={open}
          onOpenChange={setOpen}
        />
        <p className="addm-hint" role="status">
          {busy
            ? 'resolving that track…'
            : error
              ? error
              : note
                ? note
                : typeaheadHint(typeahead, query, open && expanded)}
        </p>
      </div>
    </div>
  );
}
