'use client';

/**
 * The header line above a playlist's rows (docs/design.md §9.15): the playlist name, the
 * count as a pasted tape block, and `export as txt or json`.
 *
 * Renaming is inline and drawn — the heading is replaced by the same bone field the create
 * form uses, never a browser prompt. Escape abandons it, Enter saves it.
 *
 * The two export controls are plain `<a download>` straight at the export route. This is a
 * local app; a download is the user's own click, and the file it saves is the same bytes
 * `curl` would get from that URL.
 */

import { useEffect, useRef, useState } from 'react';

import { exportHref, type PlaylistSummary } from '@/lib/client/playlists';

import styles from './playlists.module.css';

export interface PlaylistHeaderProps {
  playlist: PlaylistSummary;
  onRename: (name: string) => void;
  /** Set while a rename request is out. */
  busy: boolean;
}

/** `4 tracks`, `1 track`, `nothing saved`. */
export function countLabel(count: number): string {
  if (count === 0) return 'nothing saved';
  return `${count} track${count === 1 ? '' : 's'}`;
}

export function PlaylistHeader({ playlist, onRename, busy }: PlaylistHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(playlist.name);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);

  function open() {
    setDraft(playlist.name);
    setEditing(true);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed.length === 0 || trimmed === playlist.name) return;
    onRename(trimmed);
  }

  return (
    <>
      {editing ? (
        <form className={styles.renameForm} onSubmit={submit}>
          <input
            ref={field}
            className={styles.field}
            value={draft}
            maxLength={80}
            aria-label={`Rename the playlist ${playlist.name}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false);
            }}
          />
          <button className="btn" type="submit" disabled={busy || draft.trim().length === 0}>
            save the name
          </button>
          <button className="btn bare" type="button" onClick={() => setEditing(false)}>
            cancel
          </button>
        </form>
      ) : (
        <div className={styles.heading}>
          <h1>{playlist.name}</h1>
          <span className="tape">{countLabel(playlist.count)}</span>
          <span className={styles.sub}>
            updated {new Date(playlist.updatedAt).toISOString().slice(0, 10)}
          </span>
        </div>
      )}

      <div className={styles.strip}>
        {editing ? null : (
          <button className="btn" type="button" onClick={open} disabled={busy}>
            {busy ? 'renaming…' : 'rename'}
          </button>
        )}
        <a
          className={`btn ${styles.linkBtn}`}
          href={exportHref(playlist.id, 'txt')}
          download={`${playlist.name}.txt`}
        >
          export text
        </a>
        <a
          className={`btn ${styles.linkBtn}`}
          href={exportHref(playlist.id, 'json')}
          download={`${playlist.name}.json`}
        >
          export json
        </a>
      </div>
    </>
  );
}
