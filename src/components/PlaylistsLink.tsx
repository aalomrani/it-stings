'use client';

/**
 * `playlists · 7` — the way from the search page to `/playlists`, and the running count of
 * everything saved on this machine.
 *
 * The number is **tracks, not playlists**: saving is the thing that has to be seen to have
 * worked, and saving into a playlist that already exists does not change how many
 * playlists there are. It is refreshed on the `itstings:playlists-changed` event the save
 * popover and the playlist pages fire, so the count is right the moment a save lands
 * without lifting playlist state into the app shell for the sake of one number.
 *
 * Nothing above the search bar, ever (docs/design.md §9.1): this sits under it, in the
 * same quiet mono register as the receipt line.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { listPlaylists, onPlaylistsChanged } from '@/lib/client/playlists';

export interface PlaylistsLinkProps {
  className?: string;
  /** Render as a `<span>` rather than a `<p>`: the empty state's credits line is already a
   *  paragraph, and a `<p>` inside a `<p>` is markup the browser silently rewrites. */
  inline?: boolean;
}

export function PlaylistsLink({ className, inline = false }: PlaylistsLinkProps) {
  const [count, setCount] = useState<number | null>(null);

  const read = useCallback(() => {
    listPlaylists()
      .then((playlists) => setCount(playlists.reduce((sum, p) => sum + p.count, 0)))
      // A dead /api/playlists leaves the link honest and shorter: it still goes there.
      .catch(() => setCount(null));
  }, []);

  useEffect(() => {
    read();
    return onPlaylistsChanged(read);
  }, [read]);

  const link = (
    <Link className="btn bare" href="/playlists">
      playlists{count === null ? '' : ` · ${count}`}
    </Link>
  );

  return inline ? (
    <span className={className}>{link}</span>
  ) : (
    <p className={className ?? 'keyhint'}>{link}</p>
  );
}
