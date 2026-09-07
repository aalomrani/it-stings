'use client';

/**
 * The search strip — the hero on the empty state, the seed-holder on the results page.
 * The paper IS the field: the input has no background and no border of its own, and the
 * dropdown is the same sheet of paper grown downward (no shadow, no gap, no floating
 * panel). Submit is Enter or a typeahead row; there is no `Find` button.
 *
 * ARIA combobox + listbox: the input keeps DOM focus and drives the list with
 * `aria-activedescendant`. ↑/↓ move, Enter selects, Escape closes, click selects.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { PaperStrip, StingerMark } from '@/components/Icons';
import type { TypeaheadHit } from '@/lib/client/api';
import type { TypeaheadState } from '@/lib/client/useTypeahead';
import { MIN_CHARS } from '@/lib/client/useTypeahead';

/**
 * The message the list prints instead of rows, or null when it has rows to print.
 * Exported with `showsTypeahead` so the empty state can hide the hint patch the open
 * panel would otherwise slice into disconnected words (docs/design.md §6: nothing is
 * ever allowed to overlap a glyph).
 */
export function typeaheadMessage(state: TypeaheadState, value: string): string | null {
  const long = value.trim().length >= MIN_CHARS;
  if (state.pending) return 'searching itunes';
  if (state.error) return `itunes did not answer — ${state.error}`;
  if (state.hits.length === 0 && long && state.answered.length > 0) {
    return 'nothing on itunes for that';
  }
  return null;
}

/** True exactly when the dropdown is on screen. */
export function showsTypeahead(state: TypeaheadState, value: string, open: boolean): boolean {
  const long = value.trim().length >= MIN_CHARS;
  return open && long && (state.hits.length > 0 || typeaheadMessage(state, value) !== null);
}

export interface SearchBarProps {
  variant: 'hero' | 'bar';
  value: string;
  onChange: (value: string) => void;
  onSelect: (hit: TypeaheadHit) => void;
  onClear?: () => void;
  typeahead: TypeaheadState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoFocus?: boolean;
}

function Thumb({ hit }: { hit: TypeaheadHit }) {
  return (
    <svg className="th" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="0" y="0" width="100" height="100" fill="#17140F" />
      {hit.artworkSmall ? (
        <image
          href={hit.artworkSmall}
          x="0"
          y="0"
          width="100"
          height="100"
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <path
          d="M22 30 L78 30 M22 52 L64 52 M22 74 L72 74"
          fill="none"
          stroke="#EDE9DD"
          strokeWidth="8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function SearchBar({
  variant,
  value,
  onChange,
  onSelect,
  onClear,
  typeahead,
  open,
  onOpenChange,
  autoFocus = false,
}: SearchBarProps) {
  const listId = useId();
  const inputId = useId();
  // The highlight is stored WITH the query it belongs to, so a new answer invalidates it
  // by derivation instead of by an effect writing state back during a render.
  const [marked, setMarked] = useState<{ answered: string; index: number }>({
    answered: '',
    index: -1,
  });
  const [hovered, setHovered] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = typeahead.hits;
  const message = typeaheadMessage(typeahead, value);
  const showList = showsTypeahead(typeahead, value, open);
  const active =
    marked.answered === typeahead.answered && marked.index < hits.length ? marked.index : -1;

  function setActive(next: number | ((prev: number) => number)) {
    const index = typeof next === 'function' ? next(active) : next;
    setMarked({ answered: typeahead.answered, index });
  }

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function pick(index: number) {
    const hit = hits[index];
    if (!hit) return;
    onOpenChange(false);
    setActive(-1);
    onSelect(hit);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // WAI-ARIA combobox: Down Arrow re-opens a popup the user closed with Escape. The
      // hook keeps the answer it already had, so this costs no second iTunes request.
      if (!open) {
        onOpenChange(true);
        return;
      }
      if (hits.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((prev) => {
        const next = prev + step;
        if (next < 0) return hits.length - 1;
        if (next >= hits.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (hits.length === 0) return;
      pick(active >= 0 ? active : 0);
      return;
    }
    if (event.key === 'Escape') {
      if (showList) {
        event.preventDefault();
        onOpenChange(false);
        setActive(-1);
      }
    }
  }

  const hero = variant === 'hero';
  const activeId = active >= 0 && hits[active] ? `${listId}-opt-${active}` : undefined;

  return (
    <form
      className={hero ? 'slot' : 'bar'}
      role="search"
      autoComplete="off"
      onSubmit={(event) => event.preventDefault()}
    >
      <PaperStrip variant={hero ? 'hero' : 'bar'} />
      <label className="sr" htmlFor={inputId}>
        Search for a song
      </label>
      <input
        id={inputId}
        ref={inputRef}
        name="q"
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-describedby={undefined}
        enterKeyHint="search"
        placeholder={hero ? 'a song that got you — title, artist' : undefined}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          onOpenChange(true);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (value.trim().length >= MIN_CHARS) onOpenChange(true);
        }}
        onBlur={(event) => {
          // A click on a row is a mousedown inside the list, so only close when focus has
          // actually left the whole strip.
          const next = event.relatedTarget as Node | null;
          if (next && event.currentTarget.parentElement?.contains(next)) return;
          onOpenChange(false);
        }}
      />
      <span className={hero ? 'rule' : 'bar-rule'} />
      {hero ? <StingerMark /> : null}
      {!hero && onClear ? (
        <button className="bar-clear" type="button" onClick={onClear}>
          clear
        </button>
      ) : null}

      {showList ? (
        <div className="ta">
          <ul id={listId} role="listbox" aria-label="Matching tracks">
            {hits.map((hit, index) => (
              <li
                key={hit.itunesId}
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={index === active}
                className={`${index === active ? 'on' : ''} ${index === hovered ? 'hov' : ''}`.trim()}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(-1)}
                onMouseDown={(event) => {
                  // Keep DOM focus on the input; the list is driven by aria-activedescendant.
                  event.preventDefault();
                  pick(index);
                }}
              >
                <Thumb hit={hit} />
                <div>
                  <p className="tt">{hit.title}</p>
                  <p className="tb">{hit.artist}</p>
                </div>
                <span className="ty">{hit.releaseYear ?? 'year unknown'}</span>
              </li>
            ))}
          </ul>
          {message ? (
            <p className="msg" role="status">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
