'use client';

/**
 * `/playlists/[id]` — the playlist itself.
 *
 * Order is the whole point of this page, so it is the thing the page is most careful
 * about. The rows move first and the `PATCH` follows; the array as the **server** last
 * confirmed it is kept in a ref, and a failed save puts that array back on screen and
 * prints what the server said. The alternative — leaving a moved row where the user
 * dropped it after the save failed — would make the page a picture of an order that does
 * not exist, and a reload would silently undo it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { Tear } from '@/components/Icons';
import { PlayAllControl, usePlayAll } from '@/components/playlists/PlayAllControl';
import { PlaylistHeader } from '@/components/playlists/PlaylistHeader';
import { ReorderList } from '@/components/playlists/ReorderList';
import { SpotifyPush } from '@/components/playlists/SpotifyPush';
import { usePlayerStore } from '@/lib/client/player';
import {
  getPlaylist,
  notifyPlaylistsChanged,
  orderChanged,
  orderOf,
  removePlaylistItem,
  renamePlaylist,
  reorderPlaylist,
  type PlaylistItemView,
  type PlaylistSummary,
} from '@/lib/client/playlists';

import styles from './playlists.module.css';

export function PlaylistView({ id }: { id: string }) {
  const store = usePlayerStore();
  const [playlist, setPlaylist] = useState<PlaylistSummary | null>(null);
  const [items, setItems] = useState<PlaylistItemView[]>([]);
  const [degraded, setDegraded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  /** The rows as the server last confirmed them: what a failed save reverts to. */
  const saved = useRef<PlaylistItemView[]>([]);

  useEffect(() => {
    let live = true;
    getPlaylist(id)
      .then((detail) => {
        if (!live) return;
        setPlaylist(detail.playlist);
        setItems(detail.items);
        saved.current = detail.items;
        setDegraded(detail.degraded ?? []);
      })
      .catch((err: unknown) => {
        if (!live) return;
        const message = err instanceof Error ? err.message : 'could not read that playlist';
        setMissing(message.includes('not found'));
        setError(message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id]);

  const seq = usePlayAll(items);

  const commit = useCallback(
    (next: PlaylistItemView[]) => {
      const order = orderOf(next);
      setItems(next);
      if (!orderChanged(orderOf(saved.current), order)) return;
      setError(null);
      reorderPlaylist(id, order)
        .then(() => {
          saved.current = next;
        })
        .catch((err: unknown) => {
          setItems(saved.current);
          setError(
            `the new order was not saved — ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        });
    },
    [id],
  );

  const remove = useCallback(
    (itemId: number) => {
      const before = items;
      setBusyId(itemId);
      setError(null);
      removePlaylistItem(id, itemId)
        .then(() => {
          const next = before.filter((item) => item.id !== itemId);
          saved.current = next;
          setItems(next);
          setPlaylist((prev) => (prev ? { ...prev, count: next.length } : prev));
          notifyPlaylistsChanged();
        })
        .catch((err: unknown) => {
          setItems(saved.current);
          setError(err instanceof Error ? err.message : 'could not remove that track');
        })
        .finally(() => setBusyId(null));
    },
    [id, items],
  );

  const rename = useCallback(
    (name: string) => {
      setRenameBusy(true);
      setError(null);
      renamePlaylist(id, name)
        .then((next) => {
          setPlaylist((prev) => (prev ? { ...prev, ...next } : next));
          notifyPlaylistsChanged();
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'could not rename that playlist');
        })
        .finally(() => setRenameBusy(false));
    },
    [id],
  );

  /** Space on a focused row. A hand-played row ends the sequence — their click wins. */
  const toggleRow = useCallback(
    (item: PlaylistItemView) => {
      if (seq.active) seq.stop();
      void store.toggle(item.track);
    },
    [seq, store],
  );

  const back = (
    <p className={styles.top}>
      <Link className={styles.back} href="/playlists">
        back to the playlists
      </Link>{' '}
      <Link className={styles.back} href="/">
        back to the search
      </Link>
    </p>
  );

  if (loading) {
    return (
      <main className="sheet">
        {back}
        <p className={styles.note} role="status">
          reading the playlist…
        </p>
      </main>
    );
  }

  if (!playlist) {
    return (
      <main className="sheet">
        {back}
        <p className={styles.err} role="status">
          {missing ? 'there is no playlist at this address.' : error}
        </p>
      </main>
    );
  }

  return (
    <main className="sheet">
      {back}

      <PlaylistHeader playlist={playlist} onRename={rename} busy={renameBusy} />
      <Tear />

      {error ? (
        <p className={styles.err} role="status">
          {error}
        </p>
      ) : null}

      {degraded.map((line) => (
        <p key={line} className={styles.noteItem}>
          {line}
        </p>
      ))}

      {/* Phase 6. Renders nothing until `/api/spotify/status` answers, and renders one
          mono line instead of a button when SPOTIFY_CLIENT_ID is unset. */}
      <SpotifyPush playlistId={id} itemCount={items.length} />

      {items.length === 0 ? (
        <p className={styles.empty}>
          nothing saved yet — <Link href="/">go get stung</Link>.
        </p>
      ) : (
        <>
          <PlayAllControl seq={seq} total={items.length} />
          <ReorderList
            items={items}
            onPreview={setItems}
            onCommit={commit}
            onRemove={remove}
            busyId={busyId}
            sequencedKey={seq.currentKey}
            onToggleRow={toggleRow}
          />
        </>
      )}
    </main>
  );
}
