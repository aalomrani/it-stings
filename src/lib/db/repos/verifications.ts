/**
 * `verifications` — the Stage 4 cache. A row means "we looked this (artist, title) up";
 * `trackKey: null` is a VERIFIED MISS and is just as valuable as a hit, because it stops
 * the verifier re-querying Deezer and iTunes for a track the model invented.
 */

import { getDb } from '@/lib/db';
import { normArtist, normTitle } from '@/lib/util/normalize';

export interface VerificationRow {
  normArtist: string;
  normTitle: string;
  trackKey: string | null;
  checkedAt: number;
}

interface Raw {
  norm_artist: string;
  norm_title: string;
  track_key: string | null;
  checked_at: number;
}

/** Takes RAW artist/title; normalisation happens here so callers cannot disagree. */
export function get(artist: string, title: string): VerificationRow | null {
  const row = getDb()
    .prepare('SELECT * FROM verifications WHERE norm_artist = ? AND norm_title = ?')
    .get(normArtist(artist), normTitle(title)) as Raw | undefined;
  if (!row) return null;
  return {
    normArtist: row.norm_artist,
    normTitle: row.norm_title,
    trackKey: row.track_key,
    checkedAt: row.checked_at,
  };
}

/** `trackKey === null` records a verified miss. */
export function set(
  artist: string,
  title: string,
  trackKey: string | null,
  checkedAt: number = Date.now(),
): void {
  getDb()
    .prepare(
      `INSERT INTO verifications (norm_artist, norm_title, track_key, checked_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(norm_artist, norm_title) DO UPDATE SET
         track_key = excluded.track_key, checked_at = excluded.checked_at`,
    )
    .run(normArtist(artist), normTitle(title), trackKey, checkedAt);
}
