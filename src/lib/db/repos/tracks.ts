/**
 * `tracks` — the resolved-TrackRecord cache. The JSON column is the whole record; the
 * scalar columns exist only so we can look one up by key, ISRC or normalised name.
 */

import { getDb } from '@/lib/db';
import { TrackRecordSchema, type TrackRecord } from '@/lib/types';
import { normArtist, normTitle } from '@/lib/util/normalize';

interface Row {
  json: string;
}

function parse(row: Row | undefined): TrackRecord | null {
  if (!row) return null;
  const parsed = TrackRecordSchema.safeParse(JSON.parse(row.json));
  // A row that no longer matches the schema is a stale cache entry, not a crash.
  return parsed.success ? parsed.data : null;
}

export function upsert(track: TrackRecord): void {
  getDb()
    .prepare(
      `INSERT INTO tracks (key, isrc, title, artist, norm_artist, norm_title, json, resolved_at)
       VALUES (@key, @isrc, @title, @artist, @norm_artist, @norm_title, @json, @resolved_at)
       ON CONFLICT(key) DO UPDATE SET
         isrc = excluded.isrc, title = excluded.title, artist = excluded.artist,
         norm_artist = excluded.norm_artist, norm_title = excluded.norm_title,
         json = excluded.json, resolved_at = excluded.resolved_at`,
    )
    .run({
      key: track.key,
      isrc: track.isrc,
      title: track.title,
      artist: track.artist,
      norm_artist: normArtist(track.artist),
      norm_title: normTitle(track.title),
      json: JSON.stringify(track),
      resolved_at: track.resolvedAt,
    });
}

export function get(key: string): TrackRecord | null {
  return parse(getDb().prepare('SELECT json FROM tracks WHERE key = ?').get(key) as Row | undefined);
}

export function getMany(keys: string[]): TrackRecord[] {
  if (keys.length === 0) return [];
  const placeholders = keys.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT json FROM tracks WHERE key IN (${placeholders})`)
    .all(...keys) as Row[];
  return rows.map((r) => parse(r)).filter((t): t is TrackRecord => t !== null);
}

/** Takes RAW artist/title — normalisation happens here so callers cannot disagree. */
export function findByNorm(artist: string, title: string): TrackRecord | null {
  const row = getDb()
    .prepare(
      'SELECT json FROM tracks WHERE norm_artist = ? AND norm_title = ? ORDER BY resolved_at DESC LIMIT 1',
    )
    .get(normArtist(artist), normTitle(title)) as Row | undefined;
  return parse(row);
}

export function findByIsrc(isrc: string): TrackRecord | null {
  const row = getDb()
    .prepare('SELECT json FROM tracks WHERE isrc = ? ORDER BY resolved_at DESC LIMIT 1')
    .get(isrc) as Row | undefined;
  return parse(row);
}

export function count(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n;
}
