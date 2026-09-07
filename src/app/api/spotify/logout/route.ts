/**
 * `POST /api/spotify/logout` -> `{ ok: true, disconnected }`
 *
 * Deletes the one `spotify_auth` row. There is nothing to revoke upstream — Spotify has no
 * token-revocation endpoint — so "logged out" means this instance no longer holds the
 * credential, which is the only claim it can honestly make. The user can remove the app
 * itself at spotify.com/account/apps, and the message says so.
 *
 * POST, not GET: it changes server state, so it must not be reachable by a link, a
 * prefetch or a bookmark.
 */

import { NextResponse } from 'next/server';

import * as authRepo from '@/lib/db/repos/spotifyAuth';
import * as spotify from '@/lib/spotify/client';

export const dynamic = 'force-dynamic';

export function POST() {
  const disconnected = spotify.configured() ? authRepo.clear() : false;
  return NextResponse.json(
    {
      ok: true,
      disconnected,
      message: disconnected
        ? 'this instance has forgotten the Spotify login. To remove It Stings from the account itself, use spotify.com/account/apps.'
        : 'nothing was connected.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
