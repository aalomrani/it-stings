/**
 * `playlists` + `playlist_items` — the only user-authored data in the app, so it is the
 * only data that must survive everything else being deleted.
 *
 * Positions are 0-based and contiguous; every mutation repacks them and touches the
 * playlist's `updated_at`. A track must already exist in `tracks` before it can be added
 * (enforced by the foreign key, checked here so callers get `null` instead of an
 * SQLITE_CONSTRAINT throw).
 */

import { getDb } from '@/lib/db';
import { newPlaylistId } from '@/lib/util/ids';

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistSummary extends Playlist {
  count: number;
}

export interface PlaylistItem {
  id: number;
  playlistId: string;
  trackKey: string;
  position: number;
  why: string | null;
  seedKey: string | null;
  addedAt: number;
}

interface RawPlaylist {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

interface RawItem {
  id: number;
  playlist_id: string;
  track_key: string;
  position: number;
  why: string | null;
  seed_key: string | null;
  added_at: number;
}

const toPlaylist = (r: RawPlaylist): Playlist => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toItem = (r: RawItem): PlaylistItem => ({
  id: r.id,
  playlistId: r.playlist_id,
  trackKey: r.track_key,
  position: r.position,
  why: r.why,
  seedKey: r.seed_key,
  addedAt: r.added_at,
});

function touch(id: string, at: number = Date.now()): void {
  getDb().prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(at, id);
}

/** Rewrites positions to 0..n-1 in current order. Call inside a transaction. */
function repack(playlistId: string): void {
  const db = getDb();
  const ids = (
    db
      .prepare('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC, id ASC')
      .all(playlistId) as { id: number }[]
  ).map((r) => r.id);
  const stmt = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?');
  ids.forEach((id, i) => stmt.run(i, id));
}

export function list(): PlaylistSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS count
         FROM playlists p
        ORDER BY p.updated_at DESC, p.created_at DESC`,
    )
    .all() as (RawPlaylist & { count: number })[];
  return rows.map((r) => ({ ...toPlaylist(r), count: r.count }));
}

export function create(name: string, now: number = Date.now()): Playlist {
  const playlist: Playlist = { id: newPlaylistId(), name, createdAt: now, updatedAt: now };
  getDb()
    .prepare('INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(playlist.id, playlist.name, playlist.createdAt, playlist.updatedAt);
  return playlist;
}

export function get(id: string): Playlist | null {
  const row = getDb().prepare('SELECT * FROM playlists WHERE id = ?').get(id) as
    | RawPlaylist
    | undefined;
  return row ? toPlaylist(row) : null;
}

export function rename(id: string, name: string): Playlist | null {
  const info = getDb()
    .prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?')
    .run(name, Date.now(), id);
  return info.changes > 0 ? get(id) : null;
}

/** Exported as `playlists.delete`; items cascade. */
function remove(id: string): boolean {
  return getDb().prepare('DELETE FROM playlists WHERE id = ?').run(id).changes > 0;
}

export { remove as delete, remove };

export function items(playlistId: string): PlaylistItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC, id ASC')
    .all(playlistId) as RawItem[];
  return rows.map(toItem);
}

/**
 * Appends a track. Returns null if the playlist or the track does not exist; returns the
 * EXISTING item (unchanged) if the track is already in the playlist.
 */
export function addItem(
  playlistId: string,
  input: { trackKey: string; why?: string | null; seedKey?: string | null },
): PlaylistItem | null {
  const db = getDb();
  if (!get(playlistId)) return null;
  const track = db.prepare('SELECT key FROM tracks WHERE key = ?').get(input.trackKey);
  if (!track) return null;

  const existing = db
    .prepare('SELECT * FROM playlist_items WHERE playlist_id = ? AND track_key = ?')
    .get(playlistId, input.trackKey) as RawItem | undefined;
  if (existing) return toItem(existing);

  const now = Date.now();
  const next = (
    db
      .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS n FROM playlist_items WHERE playlist_id = ?')
      .get(playlistId) as { n: number }
  ).n;
  const info = db
    .prepare(
      `INSERT INTO playlist_items (playlist_id, track_key, position, why, seed_key, added_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(playlistId, input.trackKey, next, input.why ?? null, input.seedKey ?? null, now);
  touch(playlistId, now);
  const row = db.prepare('SELECT * FROM playlist_items WHERE id = ?').get(info.lastInsertRowid) as
    | RawItem
    | undefined;
  return row ? toItem(row) : null;
}

/** Removes one item and repacks the remaining positions. */
export function removeItem(playlistId: string, itemId: number): boolean {
  const db = getDb();
  const done = db.transaction(() => {
    const info = db
      .prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?')
      .run(itemId, playlistId);
    if (info.changes === 0) return false;
    repack(playlistId);
    return true;
  })();
  if (done) touch(playlistId);
  return done;
}

/**
 * Reorders by item id. Ids not listed keep their relative order after the listed ones;
 * ids that do not belong to this playlist are ignored. Returns the new item list.
 */
export function reorder(playlistId: string, itemIds: number[]): PlaylistItem[] {
  const db = getDb();
  db.transaction(() => {
    const current = items(playlistId);
    const byId = new Map(current.map((i) => [i.id, i]));
    const ordered: number[] = [];
    for (const id of itemIds) {
      if (byId.has(id) && !ordered.includes(id)) ordered.push(id);
    }
    for (const item of current) {
      if (!ordered.includes(item.id)) ordered.push(item.id);
    }
    const stmt = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?');
    ordered.forEach((id, i) => stmt.run(i, id, playlistId));
  })();
  touch(playlistId);
  return items(playlistId);
}
