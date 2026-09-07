/**
 * `GET /api/spotify/status` -> `{ configured, loggedIn, displayName }`
 *
 * The one thing the browser is allowed to know about the Spotify connection, and the
 * switch the whole feature hangs off: with `SPOTIFY_CLIENT_ID` unset this answers
 * `configured: false` and `SpotifyPush` renders one mono line explaining what to set
 * instead of a button that could only fail.
 *
 * No token, no scope, no refresh token, no client id — `displayName` is the entire payload
 * beyond two booleans, and it is there so the page can say WHO is connected rather than
 * just "connected".
 */

import { NextResponse } from 'next/server';

import * as authRepo from '@/lib/db/repos/spotifyAuth';
import * as spotify from '@/lib/spotify/client';

export const dynamic = 'force-dynamic';

export function GET() {
  const configured = spotify.configured();
  // Unconfigured means the feature does not exist — not even a database read.
  const row = configured ? authRepo.get() : null;

  return NextResponse.json(
    {
      configured,
      loggedIn: row !== null,
      displayName: row?.displayName ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
