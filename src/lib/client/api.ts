/**
 * The browser's whole API surface. Every call goes to one of our own `/api/*` routes —
 * the app never fetches a third-party host from the client (spec.md, "Standing rules"),
 * because Deezer blocks browser origins and no key may ever reach the browser.
 */

import type { TypeaheadHit } from '@/lib/sources/itunes';
import type { TrackRecord } from '@/lib/types';

export type { TypeaheadHit };

export interface PlaylistSummary {
  id: string;
  name: string;
  count: number;
  createdAt: number;
  updatedAt: number;
}

export interface HealthKeys {
  anthropic: boolean;
  lastfm: boolean;
  websearch: 'tavily' | 'brave' | null;
  spotify: boolean;
  getsongbpm: boolean;
}

/**
 * How this instance is fenced. `gate` is whether `ITSTINGS_ACCESS_TOKEN` is set — never
 * the token — and the caps are the run budgets it enforces, `null` for uncapped.
 */
export interface HealthCaps {
  perDay: number | null;
  perIpPerHour: number | null;
}

export interface Health {
  ok: boolean;
  keys: HealthKeys;
  /** True when this instance is invite-only. The provenance foot says so. */
  gate: boolean;
  caps: HealthCaps;
  sources: { name: string; needsKey: boolean; configured: boolean }[];
  version: string;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
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

/** Typeahead. Fewer than two characters never reaches the network (the route agrees). */
export async function search(q: string, signal?: AbortSignal): Promise<TypeaheadHit[]> {
  const res = await getJson<{ hits: TypeaheadHit[] }>(
    `/api/search?q=${encodeURIComponent(q)}`,
    signal ? { signal } : undefined,
  );
  return res.hits ?? [];
}

/** Selecting a typeahead row: join the sources into one `TrackRecord`. */
export async function resolve(hit: TypeaheadHit): Promise<TrackRecord> {
  const res = await getJson<{ track: TrackRecord }>('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itunesId: hit.itunesId,
      artist: hit.artist,
      title: hit.title,
      ...(hit.durationMs ? { durationMs: hit.durationMs } : {}),
    }),
  });
  return res.track;
}

/** Re-mint a preview. Deezer URLs are HMAC-signed and dead 900 s after minting. */
export async function preview(
  key: string,
): Promise<{ url: string | null; source?: { source: string }; expiresAt?: number | null }> {
  return getJson(`/api/preview?key=${encodeURIComponent(key)}`);
}

export async function health(): Promise<Health> {
  return getJson<Health>('/api/health');
}

export async function playlists(): Promise<PlaylistSummary[]> {
  const res = await getJson<{ playlists: PlaylistSummary[] }>('/api/playlists');
  return res.playlists ?? [];
}

export async function createPlaylist(name: string): Promise<PlaylistSummary> {
  const res = await getJson<{ playlist: PlaylistSummary }>('/api/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.playlist;
}

export async function addToPlaylist(
  playlistId: string,
  item: { trackKey: string; why?: string; seedKey?: string },
): Promise<void> {
  await getJson(`/api/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
}
