'use client';

/**
 * Save-to-playlist. A lowercase mono `save` inside a drawn chip edge; pressing it opens a
 * small drawn popover with the existing playlists and one inline "new playlist" field.
 * Once the track is in, the label becomes `saved · <playlist>` and both the label and the
 * edge go acid — **no state colour without a word** (docs/design.md §9.16).
 *
 * The playlist pages themselves are Phase 4; this is the minimum that makes the spec's
 * "Save on any card, including the seed" true today.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { addToPlaylist, createPlaylist, playlists as listPlaylists, type PlaylistSummary } from '@/lib/client/api';
import { notifyPlaylistsChanged } from '@/lib/client/playlists';

export interface SavePopoverProps {
  trackKey: string;
  /** The `why` travels with the track, so provenance survives into the playlist. */
  why?: string;
  seedKey?: string;
  /** `save` on a result, `save the seed` on the seed card. */
  label?: string;
  /** Set by the parent so `s` on a focused card can open this popover. */
  openSignal?: number;
  /** The track's title, so the popover has a NAME for assistive technology. */
  title?: string;
  /** Where focus belongs when a keyboard-opened popover closes: the owning card. */
  onReturnFocus?: () => void;
}

export function SavePopover({
  trackKey,
  why,
  seedKey,
  label = 'save',
  openSignal = 0,
  title,
  onReturnFocus,
}: SavePopoverProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PlaylistSummary[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  /** Did the keyboard open this? Then the keyboard gets its place in the list back. */
  const fromKey = useRef(false);
  /** Set while open to move focus into the popover once its first control exists. */
  const grab = useRef(false);
  // The signal this instance mounted with. Comparing against the VALUE rather than
  // flipping a "have I run yet" flag is what makes this idempotent: React's development
  // double-invocation of effects would trip a flag and open every popover on the page.
  const mountedAt = useRef(openSignal);

  /** Escape, an outside click, or a finished save. */
  const dismiss = useCallback(() => {
    setOpen(false);
    if (fromKey.current && onReturnFocus) onReturnFocus();
    else button.current?.focus();
    fromKey.current = false;
  }, [onReturnFocus]);

  // The card's `s` key. The popover — not the trigger behind it — takes focus, so it is
  // announced, and it is one keystroke away rather than two Tabs.
  useEffect(() => {
    if (openSignal === mountedAt.current) return;
    fromKey.current = true;
    grab.current = true;
    setOpen(true);
  }, [openSignal]);

  // Focus the first thing inside the popover once it has rendered. `items === null` on the
  // first pass, so the "new playlist" field is what catches it until the list arrives.
  useEffect(() => {
    if (!open || !grab.current) return;
    const first = pop.current?.querySelector<HTMLElement>('button:not([disabled]),input');
    if (!first) return;
    grab.current = false;
    first.focus();
  }, [open, items]);

  useEffect(() => {
    if (!open || items !== null) return;
    let live = true;
    listPlaylists()
      .then((res) => {
        if (live) setItems(res);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'could not read playlists');
      });
    return () => {
      live = false;
    };
  }, [open, items]);

  // Escape closes, and a click outside closes. Both return focus to the button.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss();
    }
    function onDown(event: MouseEvent) {
      // Focus may be INSIDE the popover by now, so closing has to place it somewhere.
      if (!wrap.current?.contains(event.target as Node)) dismiss();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, dismiss]);

  async function put(playlist: PlaylistSummary) {
    setBusy(true);
    setError(null);
    try {
      await addToPlaylist(playlist.id, {
        trackKey,
        ...(why ? { why } : {}),
        ...(seedKey ? { seedKey } : {}),
      });
      setSaved(playlist.name);
      // Phase 4, additive: the header's `playlists · n` is on the other side of the page
      // and cannot see this state. One event keeps its count true the moment a save lands.
      notifyPlaylistsChanged();
      dismiss();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'could not save');
    } finally {
      setBusy(false);
    }
  }

  async function make(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const playlist = await createPlaylist(trimmed);
      setItems((prev) => [...(prev ?? []), playlist]);
      setName('');
      await put(playlist);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'could not create that playlist');
      setBusy(false);
    }
  }

  return (
    <span className="popwrap" ref={wrap}>
      <button
        ref={button}
        className={saved ? 'btn saved' : 'btn'}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          fromKey.current = false;
          setOpen((was) => !was);
        }}
      >
        {saved ? `saved · ${saved}` : label}
      </button>

      {open ? (
        <div
          className="pop"
          id={listId}
          ref={pop}
          role="dialog"
          aria-label={title ? `save ${title} to a playlist` : 'save to a playlist'}
        >
          <h6>save to</h6>
          {items === null ? (
            <p className="plpick" aria-live="polite">
              reading playlists…
            </p>
          ) : (
            <ul>
              {items.map((playlist) => (
                <li key={playlist.id}>
                  <button className="plpick" type="button" disabled={busy} onClick={() => void put(playlist)}>
                    {playlist.name} <span className="ct">{playlist.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(event) => void make(event)}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="new playlist"
              aria-label="Name for a new playlist"
              maxLength={80}
            />
            <button className="btn" type="submit" disabled={busy || name.trim().length === 0}>
              make it
            </button>
          </form>
          {error ? <p className="err">{error}</p> : null}
        </div>
      ) : null}
    </span>
  );
}
