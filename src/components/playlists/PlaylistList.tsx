'use client';

/**
 * `/playlists` — every playlist, with the four things you can do to one: open it, rename
 * it, delete it, or make another.
 *
 * Delete is a **two-click drawn confirm**, never `window.confirm()`: the button becomes
 * `sure? delete` in blood and the next click on it is the one that removes the playlist.
 * Any other click, Escape, or moving on cancels it. A native dialog would be the one
 * un-drawn rectangle in the whole app, and it would sit on top of the page's own words.
 *
 * Every mutation is optimistic and every failure is printed as the server phrased it —
 * this is the only user-authored data in the app, and a delete that silently did not
 * happen would be the worst possible lie for it to tell.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { Tear } from '@/components/Icons';
import {
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  notifyPlaylistsChanged,
  renamePlaylist,
  type PlaylistSummary,
} from '@/lib/client/playlists';

import { countLabel } from './PlaylistHeader';
import styles from './playlists.module.css';

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function PlaylistList() {
  const [items, setItems] = useState<PlaylistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    listPlaylists()
      .then(setItems)
      .catch((err: unknown) => {
        setItems([]);
        setError(err instanceof Error ? err.message : 'could not read the playlists');
      });
  }, []);

  useEffect(load, [load]);

  // Escape gets you out of an armed delete, wherever focus happens to be.
  useEffect(() => {
    if (confirming === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setConfirming(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirming]);

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
      notifyPlaylistsChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'could not create that playlist');
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string, next: string) {
    const trimmed = next.trim();
    setRenaming(null);
    if (!trimmed) return;
    const before = items;
    setItems((prev) => (prev ?? []).map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
    setError(null);
    try {
      await renamePlaylist(id, trimmed);
      notifyPlaylistsChanged();
    } catch (err: unknown) {
      setItems(before);
      setError(err instanceof Error ? err.message : 'could not rename that playlist');
    }
  }

  async function remove(id: string) {
    setConfirming(null);
    const before = items;
    setItems((prev) => (prev ?? []).filter((p) => p.id !== id));
    setError(null);
    try {
      await deletePlaylist(id);
      notifyPlaylistsChanged();
    } catch (err: unknown) {
      setItems(before);
      setError(err instanceof Error ? err.message : 'could not delete that playlist');
    }
  }

  const total = (items ?? []).reduce((sum, p) => sum + p.count, 0);

  return (
    <main className="sheet">
      <p className={styles.top}>
        <Link className={styles.back} href="/">
          back to the search
        </Link>
      </p>

      <div className={styles.heading}>
        <h1>Playlists</h1>
        <span className="tape">
          {(items ?? []).length} · {total} saved
        </span>
        <span className={styles.sub}>sqlite, on this machine · they survive a restart</span>
      </div>
      <Tear />

      {error ? (
        <p className={styles.err} role="status">
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p className={styles.note} role="status">
          reading playlists…
        </p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>
          no playlists yet — name one below, then <Link href="/">go get stung</Link>.
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((playlist, index) => {
            const editing = renaming?.id === playlist.id;
            return (
              <li
                key={playlist.id}
                className={index % 2 === 1 ? `${styles.plCard} ${styles.plCardAlt}` : styles.plCard}
              >
                {editing ? (
                  <form
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void rename(playlist.id, renaming.draft);
                    }}
                  >
                    {/* The field replaces the name the user just pressed `rename` on, so
                        focus belongs in it — this is not a page-load autofocus. */}
                    <input
                      autoFocus
                      className={styles.field}
                      value={renaming.draft}
                      maxLength={80}
                      aria-label={`Rename the playlist ${playlist.name}`}
                      onChange={(event) => setRenaming({ id: playlist.id, draft: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setRenaming(null);
                      }}
                    />
                    <button
                      className="btn"
                      type="submit"
                      disabled={renaming.draft.trim().length === 0}
                    >
                      save the name
                    </button>
                    <button className="btn bare" type="button" onClick={() => setRenaming(null)}>
                      cancel
                    </button>
                  </form>
                ) : (
                  <div>
                    <p className={styles.plName}>
                      <Link href={`/playlists/${playlist.id}`}>{playlist.name}</Link>
                    </p>
                    <p className={styles.plMeta}>
                      <b>{countLabel(playlist.count)}</b> · updated {day(playlist.updatedAt)} · made{' '}
                      {day(playlist.createdAt)}
                    </p>
                  </div>
                )}

                {editing ? null : (
                  <span className={styles.actions}>
                    <Link className={`btn ${styles.linkBtn}`} href={`/playlists/${playlist.id}`}>
                      open
                    </Link>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => setRenaming({ id: playlist.id, draft: playlist.name })}
                    >
                      rename
                    </button>
                    <button
                      className={confirming === playlist.id ? `btn ${styles.sure}` : 'btn'}
                      type="button"
                      onClick={() =>
                        confirming === playlist.id
                          ? void remove(playlist.id)
                          : setConfirming(playlist.id)
                      }
                      onBlur={() => setConfirming((id) => (id === playlist.id ? null : id))}
                      aria-label={
                        confirming === playlist.id
                          ? `Confirm deleting the playlist ${playlist.name} and its ${playlist.count} tracks`
                          : `Delete the playlist ${playlist.name}`
                      }
                    >
                      {confirming === playlist.id ? 'sure? delete' : 'delete'}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form className={styles.form} onSubmit={(event) => void make(event)}>
        <input
          className={styles.field}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="name a new playlist"
          aria-label="Name for a new playlist"
          maxLength={80}
        />
        <button className="btn" type="submit" disabled={busy || name.trim().length === 0}>
          {busy ? 'making it…' : 'make it'}
        </button>
      </form>
      <p className={styles.note}>
        two playlists may share a name — this is a single-user app, and “new playlist” twice in a
        row is not an error.
      </p>
    </main>
  );
}
