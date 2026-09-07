/**
 * Helpers shared by the four playlist route handlers. Not a route itself (only
 * `route.ts` files are), just the code all four would otherwise duplicate: JSON body
 * validation, error shapes, preview hydration and the export filename slug.
 */

import { NextResponse } from 'next/server';
import type { z } from 'zod';

import * as playlistsRepo from '@/lib/db/repos/playlists';
import * as tracksRepo from '@/lib/db/repos/tracks';
import { hydratePreview } from '@/lib/resolve/hydratePreview';
import type { TrackRecord } from '@/lib/types';

/** Every error from these routes is JSON with a status code. Never an HTML error page. */
export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: { ...NO_STORE, ...(init.headers ?? {}) },
  });
}

/**
 * Parses and validates a JSON body. Returns the parsed value or a ready-made 400 — a
 * malformed body and a body that fails the schema are both the caller's mistake, and both
 * come back as JSON.
 */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, 'body must be JSON') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError(400, 'invalid body', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * A stored TrackRecord with a FRESH preview. Deezer preview URLs are HMAC-signed and
 * expire 900 s after minting, so the `tracks` row never holds one (architecture.md,
 * "Preview audio") and every API response re-mints.
 */
export async function hydratedTrack(key: string): Promise<TrackRecord | null> {
  const track = tracksRepo.get(key);
  if (!track) return null;
  try {
    return await hydratePreview(track);
  } catch {
    // A dead Deezer is not a reason to fail the whole playlist view.
    return { ...track, preview: null };
  }
}

export interface SerialisedItem {
  id: number;
  position: number;
  track: TrackRecord;
  why: string | null;
  seedKey: string | null;
  addedAt: number;
}

/**
 * Playlist items with their tracks hydrated. An item whose `tracks` row went missing or
 * stopped matching the schema is skipped rather than crashing the view; the count of
 * skipped rows comes back so the route can say so.
 */
export async function itemsWithTracks(
  playlistId: string,
): Promise<{ items: SerialisedItem[]; missing: number }> {
  const rows = playlistsRepo.items(playlistId);
  const hydrated = await Promise.all(
    rows.map(async (row) => ({ row, track: await hydratedTrack(row.trackKey) })),
  );
  const items: SerialisedItem[] = [];
  let missing = 0;
  for (const { row, track } of hydrated) {
    if (!track) {
      missing += 1;
      continue;
    }
    items.push({
      id: row.id,
      position: row.position,
      track,
      why: row.why,
      seedKey: row.seedKey,
      addedAt: row.addedAt,
    });
  }
  return { items, missing };
}

/** `"Cats & Dogs"` -> `"cats-dogs"`. Used for the export `Content-Disposition` filename. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : 'playlist';
}
