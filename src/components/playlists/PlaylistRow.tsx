'use client';

/**
 * One saved track, per the playlist-row specimen in docs/design.md §9.15: a shallow
 * `--card` strip with the chip edge, and across it — drag grip (three wobbly bone lines) |
 * position | 44px artwork at −1.6° | title over a mono line naming the artist, the year
 * **and the seed the track came from** | play + ✕. At ≤520px the buttons drop to their own
 * full-width row.
 *
 * The saved `why` is printed under that when the run that produced this track wrote one.
 * It is the same sentence the result card showed, kept with the row rather than recomputed:
 * a playlist that quietly reworded its reasons would be lying about which run it came from.
 *
 * The row itself is the keyboard target (see `ReorderList`): Space plays it, Alt+↑/↓ moves
 * it. The grip is a real button as well as a pointer handle, so the reorder affordance is
 * reachable and announced rather than mouse-only.
 */

import { PlayButton, PlayTime, previewMode } from '@/components/PlayButton';
import { ArtTile } from '@/components/ArtTile';
import { rank2 } from '@/lib/client/format';
import { usePlayerSnapshot } from '@/lib/client/player';
import type { PlaylistItemView } from '@/lib/client/playlists';

import styles from './playlists.module.css';

/** Three wobbly bone lines. Hand-authored, no two the same length. */
function Grip() {
  return (
    <svg viewBox="0 0 20 30" aria-hidden="true">
      <path
        d="M4.4 8.2 C8 7.6 12.4 8.6 15.8 8.0 M4.0 14.8 C7.8 15.4 12.2 14.2 16.2 14.9 M4.6 21.4 C8.2 20.8 12.0 21.8 15.4 21.2"
        fill="none"
        stroke="#A8A296"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface PlaylistRowProps {
  item: PlaylistItemView;
  index: number;
  total: number;
  /** Alternates the chip edge geometry down the list, so no two neighbours match. */
  alt: boolean;
  /** Roving tabindex: exactly one row in the list is in the tab order. */
  focused: boolean;
  dragging: boolean;
  /** True while the "play all" sequence is on this row. */
  sequenced: boolean;
  /** The id of the shortcut hint printed above the list. */
  describedBy: string;
  onFocus: () => void;
  /** Space plays, Alt+↑/↓ reorders, ↑/↓ move focus. Bubbles up from the row's controls. */
  onKeyDown: (event: React.KeyboardEvent<HTMLLIElement>) => void;
  onRemove: () => void;
  /** Pointer drag starts here; the move and up listeners live on the window. */
  onGripDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  elRef: (el: HTMLLIElement | null) => void;
  /** Set while its removal request is out. */
  busy: boolean;
}

export function PlaylistRow({
  item,
  index,
  total,
  alt,
  focused,
  dragging,
  sequenced,
  describedBy,
  onFocus,
  onKeyDown,
  onRemove,
  onGripDown,
  elRef,
  busy,
}: PlaylistRowProps) {
  const snap = usePlayerSnapshot();
  const { track } = item;
  const mode = previewMode(track, snap.fallback[track.key]);
  const fallback = snap.fallback[track.key];
  const year = track.year?.value ?? null;

  const classes = [styles.row];
  if (alt) classes.push(styles.rowAlt);
  if (dragging) classes.push(styles.dragging);
  if (sequenced) classes.push(styles.playingRow);

  return (
    <li
      ref={elRef}
      className={classes.join(' ')}
      // A list of reorderable rows is a list; the position and the length are said out
      // loud, because "moved it up" means nothing without them.
      aria-posinset={index + 1}
      aria-setsize={total}
      aria-describedby={describedBy}
      aria-label={`${index + 1}. ${track.title} by ${track.artist}`}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      <button
        className={styles.grip}
        type="button"
        aria-label={`Reorder ${track.title} — position ${index + 1} of ${total}. Hold and drag, or press alt with the up and down arrows.`}
        onPointerDown={onGripDown}
      >
        <Grip />
      </button>

      <span className={styles.pos} aria-hidden="true">
        {rank2(index + 1)}
      </span>

      <span className={styles.rowArt}>
        <ArtTile
          src={track.artwork?.small ?? null}
          title={track.title}
          artist={track.artist}
          trackKey={track.key}
        />
      </span>

      <div className={styles.rowText}>
        <p className={styles.rowTitle}>{track.title}</p>
        <p className={styles.rowMeta}>
          {track.artist}
          {' · '}
          {year ? (
            <span className={styles.yr}>{year}</span>
          ) : (
            <span className={styles.unk}>year unknown</span>
          )}
          {/* A track saved off the seed card carries its own key as the seed key; printing
              "from the run seeded with <itself>" would read as circular. */}
          {item.seedKey !== null && item.seedKey === track.key ? (
            <span className={styles.seed}> · the seed of its own run</span>
          ) : item.seedKey ? (
            <span className={styles.seed}>
              {' · from the run seeded with '}
              <b>{item.seedKey}</b>
            </span>
          ) : (
            <span className={styles.seed}> · saved without a seed</span>
          )}
        </p>
      </div>

      <span className={styles.rowTools}>
        <PlayButton track={track} mode={mode} />
        {mode === 'audio' ? <PlayTime track={track} /> : null}
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Remove ${track.title} from this playlist`}
        >
          {busy ? 'removing…' : 'remove'}
        </button>
      </span>

      {item.why ? <p className={styles.rowWhy}>{item.why}</p> : null}

      {/* No preview is a delivery problem, not a match problem: the row stays, at full
          size, and says which source had nothing. */}
      {mode !== 'audio' ? (
        <p className={styles.rowNote}>
          no preview —{' '}
          {fallback?.note ?? 'deezer: no preview · itunes: no previewUrl · no spotify id to embed.'}
        </p>
      ) : null}
    </li>
  );
}
