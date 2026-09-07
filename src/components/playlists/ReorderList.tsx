'use client';

/**
 * The reorderable column of saved tracks. Two ways to move a row, and they are the same
 * operation underneath:
 *
 *   pointer   — press the grip, drag; the list re-slots live as the pointer crosses each
 *               row's box, and the release is what saves.
 *   keyboard  — focus a row (↑/↓ or j/k walk the list, roving tabindex) and press
 *               **Alt+↑ / Alt+↓**. Every move saves, and is announced.
 *
 * Alt is required so that ↑/↓ can keep doing the ordinary thing — moving focus — which is
 * what a keyboard user reaches for first and what a screen reader's browse mode expects.
 *
 * The move/up listeners live on the **window**, not on the grip: React moves the `<li>`
 * DOM nodes as the preview re-slots, and moving a node that holds a pointer capture can
 * drop that capture mid-drag. The window never moves.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { PlaylistRow } from '@/components/playlists/PlaylistRow';
import { move, type PlaylistItemView } from '@/lib/client/playlists';

import styles from './playlists.module.css';

export interface ReorderListProps {
  items: PlaylistItemView[];
  /** A drag in progress: re-slot the list, save nothing. */
  onPreview: (next: PlaylistItemView[]) => void;
  /** A finished move: persist this order (the parent diffs it against the saved one). */
  onCommit: (next: PlaylistItemView[]) => void;
  onRemove: (itemId: number) => void;
  /** The item whose removal request is out. */
  busyId: number | null;
  /** The track key the "play all" sequence is on, so the row can carry the acid edge. */
  sequencedKey: string | null;
  /** Play or pause the focused row — Space, without scrolling the page. */
  onToggleRow: (item: PlaylistItemView) => void;
}

export function ReorderList({
  items,
  onPreview,
  onCommit,
  onRemove,
  busyId,
  sequencedKey,
  onToggleRow,
}: ReorderListProps) {
  const hintId = useId();
  const [dragId, setDragId] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [said, setSaid] = useState('');
  const els = useRef<(HTMLLIElement | null)[]>([]);

  const focusIndex = Math.max(
    0,
    items.findIndex((item) => item.id === focusedId),
  );

  /** Which row's box the pointer is inside, clamped to the ends of the list. */
  const indexAt = useCallback((clientY: number): number => {
    const rects = els.current
      .map((el, index) => ({ index, rect: el?.getBoundingClientRect() }))
      .filter((r): r is { index: number; rect: DOMRect } => Boolean(r.rect));
    if (rects.length === 0) return -1;
    for (const { index, rect } of rects) {
      if (clientY >= rect.top && clientY <= rect.bottom) return index;
    }
    return clientY < rects[0].rect.top ? rects[0].index : rects[rects.length - 1].index;
  }, []);

  useEffect(() => {
    if (dragId === null) return;

    function onMove(event: PointerEvent) {
      const from = items.findIndex((item) => item.id === dragId);
      if (from < 0) return;
      const to = indexAt(event.clientY);
      if (to < 0 || to === from) return;
      const next = move(items, from, to);
      if (next !== items) onPreview(next as PlaylistItemView[]);
    }

    function onUp() {
      setDragId(null);
      onCommit(items);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // Re-installed on every re-slot rather than reading a ref written during render: the
    // listeners must see the array the rows are currently drawn from, and adding and
    // removing two window listeners costs nothing next to the reflow that just happened.
  }, [dragId, indexAt, items, onPreview, onCommit]);

  const shift = useCallback(
    (from: number, delta: number) => {
      const to = from + delta;
      if (to < 0 || to >= items.length) return;
      const next = move(items, from, to);
      if (next === items) return;
      onCommit(next as PlaylistItemView[]);
      setSaid(`Moved ${items[from].track.title} to position ${to + 1} of ${items.length}.`);
    },
    [items, onCommit],
  );

  const moveFocus = useCallback(
    (from: number, delta: number) => {
      const to = Math.max(0, Math.min(items.length - 1, from + delta));
      if (to === from) return;
      setFocusedId(items[to].id);
      els.current[to]?.focus();
    },
    [items],
  );

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLLIElement>) {
    const key = event.key;

    // Alt+↑/↓ reorders, and it works from anywhere inside the row — including the grip,
    // which is where a keyboard user who read its label will be standing.
    if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      event.preventDefault();
      shift(index, key === 'ArrowUp' ? -1 : 1);
      return;
    }

    // Everything below belongs to the ROW. A Space on the remove button is a click, not a
    // play, and it must not be stolen on its way up.
    if (event.target !== event.currentTarget) return;

    if (key === 'ArrowUp' || key === 'k') {
      event.preventDefault();
      moveFocus(index, -1);
    } else if (key === 'ArrowDown' || key === 'j') {
      event.preventDefault();
      moveFocus(index, 1);
    } else if (key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      onToggleRow(items[index]);
    }
  }

  return (
    <>
      {/* Printed BEFORE the rows and pointed at by every row's `aria-describedby`: a hint
          you only meet after tabbing past the whole list is a hint you no longer need. */}
      <p className={styles.note} id={hintId}>
        ↑ ↓ or j k move between rows · space plays the focused row · <b>alt + ↑ ↓</b> moves the
        row itself, and saves · drag the grip to the same effect
      </p>

      <ul className={styles.rows} aria-label={`${items.length} saved tracks, in play order`}>
        {items.map((item, index) => (
          <PlaylistRow
            key={item.id}
            item={item}
            index={index}
            total={items.length}
            alt={index % 2 === 1}
            focused={index === Math.min(focusIndex, items.length - 1)}
            dragging={item.id === dragId}
            sequenced={item.track.key === sequencedKey}
            describedBy={hintId}
            busy={busyId === item.id}
            onFocus={() => setFocusedId(item.id)}
            onKeyDown={(event) => onKeyDown(index, event)}
            onRemove={() => onRemove(item.id)}
            onGripDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              setFocusedId(item.id);
              setDragId(item.id);
            }}
            elRef={(el) => {
              els.current[index] = el;
            }}
          />
        ))}
      </ul>

      {/* "Moved it up" means nothing without the number it moved to. */}
      <p className="sr" role="status" aria-live="polite">
        {said}
      </p>
    </>
  );
}
