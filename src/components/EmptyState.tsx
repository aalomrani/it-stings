'use client';

/**
 * The empty state: one object, huge, bleeding off every edge, with the search strip cut
 * into it. **Nothing above the search bar, ever.** The wordmark sits below the strip on
 * its own torn opaque patch (the texture law: acid text may not sit directly on the
 * drawing), with a flat blood second pull between them — a printing error, not a shadow.
 *
 * The hint patch carries the live search status, so the one mono line on the page says
 * what the field is doing: `searching itunes`, `nothing on itunes for that`.
 */

import { RegMark, TornEdge } from '@/components/Icons';
import { SearchBar, showsTypeahead, type SearchBarProps } from '@/components/SearchBar';
import { Wasp } from '@/components/Wasp';

export interface EmptyStateProps extends Omit<SearchBarProps, 'variant' | 'onClear'> {
  hint: string;
  /** True while `POST /api/resolve` is out on a selected row. */
  resolving: boolean;
  credits: React.ReactNode;
}

export function EmptyState({ hint, resolving, credits, ...bar }: EmptyStateProps) {
  // The dropdown grows down over the hint's patch. §6: nothing overlaps a glyph — and the
  // hint's whole job is to say "pick from the list", which is now on screen saying it.
  const listOpen = showsTypeahead(bar.typeahead, bar.value, bar.open);

  return (
    <main className="plate">
      <Wasp />
      <TornEdge />
      <RegMark />

      <SearchBar {...bar} variant="hero" autoFocus />

      {listOpen && !resolving ? null : (
        <p className={resolving || bar.typeahead.pending ? 'hint searching' : 'hint'} role="status">
          {resolving ? 'resolving that track — itunes, deezer, musicbrainz' : hint}
        </p>
      )}

      <h1 className="wordmark">
        <span className="ghost" aria-hidden="true">
          It Stings
        </span>
        It Stings
      </h1>

      <p className="credits">{credits}</p>
    </main>
  );
}
