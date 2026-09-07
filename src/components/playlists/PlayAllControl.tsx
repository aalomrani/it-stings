'use client';

/**
 * "Play all": row 1 → 2 → … through the global player, one clip at a time.
 *
 * There is no second audio element and no second source of truth. The sequence drives the
 * SAME `PlayerStore` every card and every row uses, and it **subscribes** to that store to
 * know when a clip is over — the store pauses and resets `position` to 0 at 30 s or at the
 * clip's end, while a pause part-way through leaves the position where it was. That
 * difference is the whole state machine: a paused clip stalls the sequence (press play and
 * it carries on), a finished clip advances it.
 *
 * The sequence's own position is kept in a ref as well as in state, and the ref is what the
 * subscription reads. `PlayerStore.set` notifies its listeners synchronously, so starting
 * the next clip from inside a notification re-enters this listener before React has
 * re-rendered; a listener reading the React value would see the PREVIOUS track key, decide
 * someone else had grabbed the player, and abandon the sequence on its second row.
 *
 * A row with no preview is **skipped with a mono note naming it**, not silently dropped:
 * the playlist is a receipt, and a track that never played may not look like one that did.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { previewMode } from '@/components/PlayButton';
import { usePlayerStore } from '@/lib/client/player';
import type { PlaylistItemView } from '@/lib/client/playlists';

import styles from './playlists.module.css';

interface SequenceState {
  active: boolean;
  /** The track key the sequence is currently on. */
  key: string | null;
}

const IDLE: SequenceState = { active: false, key: null };

export interface PlayAll {
  active: boolean;
  /** The track key the sequence is on, so its row can carry the acid edge. */
  currentKey: string | null;
  /** 1-based, for the status line. 0 when the sequence is not running. */
  position: number;
  notes: string[];
  start: () => void;
  stop: () => void;
}

function skipNote(index: number, item: PlaylistItemView, why: string): string {
  return `row ${index + 1} · ${item.track.artist} — ${item.track.title}: ${why}`;
}

/**
 * The sequence itself. A hook rather than component state so the page can hand the current
 * key to the row list and end the sequence when someone plays a row by hand.
 */
export function usePlayAll(items: PlaylistItemView[]): PlayAll {
  const store = usePlayerStore();
  const [state, setState] = useState<SequenceState>(IDLE);
  const [notes, setNotes] = useState<string[]>([]);

  /** The same two facts as `state`, readable synchronously from the store's listener. */
  const seq = useRef<SequenceState>(IDLE);
  /**
   * Has the current clip actually been heard? Nothing renders from it, and the moment it
   * flips is not a moment the page needs to redraw — but without it the `position 0` a
   * clip starts on looks exactly like the `position 0` a finished clip ends on, and the
   * sequence would skip every row the instant it started it.
   */
  const heard = useRef(false);

  const settle = useCallback((next: SequenceState) => {
    seq.current = next;
    heard.current = false;
    setState(next);
  }, []);

  const advance = useCallback(
    (fromIndex: number) => {
      const { fallback } = store.getSnapshot();
      const skipped: string[] = [];
      for (let i = fromIndex; i < items.length; i += 1) {
        const item = items[i];
        if (previewMode(item.track, fallback[item.track.key]) === 'audio') {
          if (skipped.length > 0) setNotes((prev) => [...prev, ...skipped]);
          settle({ active: true, key: item.track.key });
          void store.toggle(item.track);
          return;
        }
        skipped.push(skipNote(i, item, 'no preview — skipped'));
      }
      settle(IDLE);
      setNotes((prev) => [
        ...prev,
        ...skipped,
        fromIndex === 0 && skipped.length === items.length
          ? 'no row in this playlist has a preview to play.'
          : 'end of the playlist.',
      ]);
    },
    [items, store, settle],
  );

  // The player store is an external system; this is the subscription to it. Everything it
  // decides goes through `advance` or `settle`, which is also what keeps "the clip ended"
  // and "the user pressed pause" from being the same event.
  useEffect(() => {
    if (!state.active) return;
    return store.subscribe(() => {
      const key = seq.current.key;
      if (!seq.current.active || key === null) return;
      const snap = store.getSnapshot();
      const index = items.findIndex((item) => item.track.key === key);

      if (snap.key === key) {
        if (snap.playing) heard.current = true;
        else if (heard.current && snap.position === 0) advance(index + 1);
        return;
      }

      // The store dropped the track: it re-minted once and the URL still would not load.
      if (snap.key === null && snap.fallback[key]) {
        if (index >= 0) {
          const item = items[index];
          setNotes((prev) => [...prev, skipNote(index, item, 'the preview would not load — skipped')]);
        }
        advance(index + 1);
        return;
      }

      // Someone pressed play on a different row. Their click wins; the sequence is over.
      if (snap.key !== null) settle(IDLE);
    });
  }, [store, state.active, items, advance, settle]);

  const start = useCallback(() => {
    setNotes([]);
    advance(0);
  }, [advance]);

  const stop = useCallback(() => {
    store.stop();
    settle(IDLE);
  }, [store, settle]);

  const position = state.key ? items.findIndex((item) => item.track.key === state.key) + 1 : 0;
  return { active: state.active, currentKey: state.key, position, notes, start, stop };
}

export function PlayAllControl({ seq, total }: { seq: PlayAll; total: number }) {
  const current = seq.position > 0 ? seq.position : null;
  return (
    <>
      <div className={styles.strip}>
        <button className="btn" type="button" onClick={seq.active ? seq.stop : seq.start}>
          {seq.active ? 'stop' : 'play all'}
        </button>
        <span className={`${styles.note} ${styles.noteTight}`} role="status">
          {seq.active && current
            ? `playing row ${current} of ${total} · 30 seconds each, in order`
            : `previews play in order, row 1 to ${total}, 30 seconds each`}
        </span>
      </div>

      {seq.notes.length > 0 ? (
        <ul className={styles.noteList} aria-label="what the sequence skipped">
          {seq.notes.map((note) => (
            <li key={note} className={styles.noteItem}>
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
