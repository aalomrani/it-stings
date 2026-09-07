/**
 * The playlist pages' whole network surface, plus the two pure helpers the reorder code
 * is built out of.
 *
 * `src/lib/client/api.ts` already owns the four calls the *search* page makes (list,
 * create, add). This file is the rest of it — read one, rename, reorder, delete, remove an
 * item, and the export URLs — and it is deliberately a separate module rather than a
 * bigger `api.ts`: Phase 4 owns this file, Phase 2 owns that one.
 *
 * Every mutation here is used optimistically by the caller: the UI moves first, the
 * request follows, and a failure puts the old array back and prints what the server said.
 * That is only safe because `move` is pure and the caller keeps the pre-move array.
 */

import type { PlaylistSummary } from '@/lib/client/api';
import type { TrackRecord } from '@/lib/types';

export type { PlaylistSummary };

/** One row of a playlist, exactly as `GET /api/playlists/[id]` serialises it. */
export interface PlaylistItemView {
  id: number;
  position: number;
  track: TrackRecord;
  /** The one-sentence reason from the run this track was saved out of, if there was one. */
  why: string | null;
  /** The seed that run started from — provenance survives into the playlist. */
  seedKey: string | null;
  addedAt: number;
}

export interface PlaylistDetail {
  playlist: PlaylistSummary;
  items: PlaylistItemView[];
  /** e.g. `2 item(s) reference a track no longer in the cache`. Printed, never swallowed. */
  degraded?: string[];
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body as T;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export async function listPlaylists(): Promise<PlaylistSummary[]> {
  const res = await call<{ playlists: PlaylistSummary[] }>('/api/playlists');
  return res.playlists ?? [];
}

export async function createPlaylist(name: string): Promise<PlaylistSummary> {
  const res = await call<{ playlist: PlaylistSummary }>('/api/playlists', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
  return res.playlist;
}

export async function getPlaylist(id: string): Promise<PlaylistDetail> {
  return call<PlaylistDetail>(`/api/playlists/${encodeURIComponent(id)}`);
}

export async function renamePlaylist(id: string, name: string): Promise<PlaylistSummary> {
  const res = await call<{ playlist: PlaylistSummary }>(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
  return res.playlist;
}

/** `order` is item ids, first to last. The route repacks positions to 0..n-1. */
export async function reorderPlaylist(id: string, order: number[]): Promise<void> {
  await call(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ order }),
  });
}

export async function deletePlaylist(id: string): Promise<void> {
  await call(`/api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function removePlaylistItem(id: string, itemId: number): Promise<void> {
  await call(`/api/playlists/${encodeURIComponent(id)}/items`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
    body: JSON.stringify({ itemId }),
  });
}

/**
 * The href behind `export text` / `export json`. A plain `<a download>` to our own route:
 * this is a local app and a download is the user's own click, not something the page does
 * behind their back.
 */
export function exportHref(id: string, format: 'txt' | 'json'): string {
  return `/api/playlists/${encodeURIComponent(id)}/export?format=${format}`;
}

/* ---------------------------------------------------------------------- *
 * pure helpers — the reorder arithmetic, testable without a DOM
 * ---------------------------------------------------------------------- */

/**
 * `from` out, `to` in, everything else closing up behind it. Out-of-range indices and a
 * no-op move both return the SAME array reference, so a caller can use identity to decide
 * whether anything needs saving.
 */
export function move<T>(items: readonly T[], from: number, to: number): T[] | readonly T[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length) return items;
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (target === from) return items;
  const next = items.slice();
  const [lifted] = next.splice(from, 1);
  next.splice(target, 0, lifted);
  return next;
}

/** The `order` array `PATCH /api/playlists/[id]` wants: item ids, first to last. */
export function orderOf(items: readonly { id: number }[]): number[] {
  return items.map((item) => item.id);
}

/** True when two orders differ — the guard that stops a pointerup saving nothing. */
export function orderChanged(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((id, i) => id !== b[i]);
}

/* ---------------------------------------------------------------------- *
 * "something changed" — how the header count stays true
 * ---------------------------------------------------------------------- */

/**
 * The header link shows how many tracks are saved. It is mounted next to the search bar,
 * far away from the save popover and from these pages, and React state does not cross a
 * route boundary — so the count is kept honest by one window event rather than by lifting
 * playlist state into the app shell for the sake of one number.
 */
export const PLAYLISTS_CHANGED = 'itstings:playlists-changed';

export function notifyPlaylistsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PLAYLISTS_CHANGED));
}

export function onPlaylistsChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(PLAYLISTS_CHANGED, listener);
  return () => window.removeEventListener(PLAYLISTS_CHANGED, listener);
}
