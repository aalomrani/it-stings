/**
 * `POST /api/playlists/[id]/push` -> `{ url, added, skipped: [{ artist, title, reason }] }`
 *
 * The whole point of Phase 6: take a playlist It Stings built and write it into the user's
 * Spotify account as a PRIVATE playlist. It is a write to somebody else's service, so the
 * route is built around two rules:
 *
 *  1. **Never push a guess.** A track goes in only via a Spotify id we already resolved, or
 *     a `/v1/search` hit that passes the same strict artist+title (+duration) match the rest
 *     of the app uses. Everything else is SKIPPED AND REPORTED, by name, with a reason. A
 *     playlist that silently contains the wrong "Hell" is worse than one that says it could
 *     not find it.
 *  2. **Report what actually happened.** `added` is the number of items Spotify confirmed,
 *     not the number we intended: if the third chunk of 100 fails, the first 200 really are
 *     in the playlist and the tracks from the failed chunk onwards appear in `skipped` with
 *     the reason.
 *
 * Chunking is 100 per request because that is the documented maximum for Add Items to a
 * Playlist, and the endpoint is `/v1/playlists/{id}/items` — the `/tracks` spelling was
 * deprecated in Feb 2026 (docs/api-reality.md §3.5).
 */

import { json, jsonError } from '@/app/api/playlists/shared';
import * as playlistsRepo from '@/lib/db/repos/playlists';
import * as tracksRepo from '@/lib/db/repos/tracks';
import * as spotify from '@/lib/spotify/client';
import type { TrackRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export interface SkippedTrack {
  artist: string;
  title: string;
  reason: string;
}

/** A track that has a Spotify URI, and the row it came from — so a failure can name it. */
interface Matched {
  uri: string;
  artist: string;
  title: string;
}

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  const playlist = playlistsRepo.get(id);
  if (!playlist) return jsonError(404, 'playlist not found');

  if (!spotify.configured()) {
    return jsonError(400, 'SPOTIFY_CLIENT_ID is not set, so the Spotify push is off', {
      configured: false,
    });
  }

  const token = await spotify.accessToken();
  if (!token.ok) {
    const status = token.reason === 'not_logged_in' || token.reason === 'auth_expired' ? 401 : 502;
    return jsonError(status, spotify.explain(token.reason, token.detail), {
      loggedIn: false,
      reason: token.reason,
    });
  }

  const skipped: SkippedTrack[] = [];
  const matched: Matched[] = [];

  /*
   * The stored track rows, NOT `itemsWithTracks`: that helper re-mints Deezer preview URLs
   * for the player, which is a network round trip per item and has nothing to do with a
   * Spotify push.
   */
  for (const row of playlistsRepo.items(id)) {
    const track: TrackRecord | null = tracksRepo.get(row.trackKey);
    if (!track) {
      skipped.push({
        artist: '—',
        title: row.trackKey,
        reason: 'that track is no longer in the local cache',
      });
      continue;
    }

    // The id we already resolved beats a search every time: it costs no request and cannot
    // match the wrong recording.
    const known = track.ids?.spotify;
    if (known) {
      matched.push({ uri: spotify.trackUri(known), artist: track.artist, title: track.title });
      continue;
    }

    const durationMs = track.durationMs?.value;
    const found = await spotify.searchTrack(token.value, track.artist, track.title, {
      ...(durationMs ? { durationMs } : {}),
    });
    if (found.ok) {
      matched.push({ uri: found.value.uri, artist: track.artist, title: track.title });
      continue;
    }
    skipped.push({
      artist: track.artist,
      title: track.title,
      reason:
        found.reason === 'not_found'
          ? 'no strict artist + title match on Spotify'
          : spotify.explain(found.reason, found.detail),
    });
  }

  if (matched.length === 0) {
    // Nothing matched. Creating an empty private playlist in someone's account to say so
    // would be litter, so the answer is the report and no playlist.
    return json({
      url: null,
      added: 0,
      skipped,
      message:
        skipped.length > 0
          ? 'nothing in this playlist could be matched on Spotify, so no playlist was created.'
          : 'this playlist is empty, so there was nothing to push.',
    });
  }

  const created = await spotify.createPlaylist(token.value, {
    name: playlist.name,
    description: spotify.PLAYLIST_DESCRIPTION,
  });
  if (!created.ok) {
    return jsonError(502, spotify.explain(created.reason, created.detail), {
      reason: created.reason,
    });
  }

  let added = 0;
  const chunks = spotify.chunk(matched, spotify.MAX_ITEMS_PER_REQUEST);
  for (const batch of chunks) {
    const result = await spotify.addItems(
      token.value,
      created.value.id,
      batch.map((m) => m.uri),
    );
    if (result.ok) {
      added += batch.length;
      continue;
    }
    // This chunk and everything after it did not make it. Report those tracks as skipped
    // rather than failing the whole call — the ones already added really are there.
    const reason = spotify.explain(result.reason, result.detail);
    for (const item of matched.slice(added)) {
      skipped.push({
        artist: item.artist,
        title: item.title,
        reason: `could not be added: ${reason}`,
      });
    }
    break;
  }

  return json({
    url: created.value.url,
    added,
    skipped,
    playlistName: playlist.name,
  });
}
