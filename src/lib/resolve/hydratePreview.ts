/**
 * Preview minting.
 *
 * A Deezer preview URL is HMAC-signed and dies exactly 900 s after the response that
 * carried it (verified on three mints). So the `tracks` row NEVER holds one: it holds the
 * Deezer track id, and every TrackRecord that leaves an API route passes through here to
 * get a fresh URL. `expiresAt` is deliberately one minute short of the real deadline so a
 * client that refreshes on expiry always beats it.
 *
 * iTunes preview URLs are unsigned and stable, so they are persisted and returned with
 * `expiresAt: null`.
 */

import * as deezer from '@/lib/sources/deezer';
import * as tracksRepo from '@/lib/db/repos/tracks';
import type { SourceRef, TrackRecord } from '@/lib/types';

/** One minute of head room under Deezer's 900 s signature lifetime. */
export const PREVIEW_LIFETIME_MS = 14 * 60_000;

/**
 * A copy of `track` with the best preview we can mint right now. Never throws: a dead
 * Deezer degrades to the persisted iTunes preview, and failing that to `null`, because a
 * card with no audio still shows its artwork, its `why` and its links.
 */
export async function hydratePreview(track: TrackRecord): Promise<TrackRecord> {
  const deezerId = track.ids.deezer;
  if (typeof deezerId === 'number') {
    try {
      const res = await deezer.getTrack(deezerId, { forPreview: true });
      if (res.ok && res.value.preview) {
        return {
          ...track,
          preview: {
            url: res.value.preview,
            source: { source: 'deezer', id: String(deezerId), field: 'preview' },
            expiresAt: res.value.fetchedAt + PREVIEW_LIFETIME_MS,
          },
        };
      }
    } catch {
      // fall through to the iTunes preview
    }
  }

  // A persisted iTunes preview is already correct: unsigned, CORS-open, no expiry.
  if (track.preview && track.preview.source.source === 'itunes') {
    return { ...track, preview: { ...track.preview, expiresAt: null } };
  }
  return { ...track, preview: null };
}

/** What `GET /api/preview?key=` returns: `{ url: null }` when nothing can be minted. */
export interface PreviewPayload {
  url: string | null;
  source?: SourceRef;
  expiresAt?: number | null;
}

/**
 * Mint a preview for a stored track key. Returns `null` when the key is unknown, so the
 * route can answer 404 rather than pretending the track exists.
 */
export async function previewForKey(key: string): Promise<TrackRecord['preview'] | null | undefined> {
  const stored = tracksRepo.get(key);
  if (!stored) return undefined;
  const hydrated = await hydratePreview(stored);
  return hydrated.preview;
}

/** Persisted form: a Deezer URL must never reach `tracks`. */
export function stripVolatilePreview(track: TrackRecord): TrackRecord {
  if (track.preview && track.preview.source.source === 'deezer') {
    return { ...track, preview: null };
  }
  return track;
}
