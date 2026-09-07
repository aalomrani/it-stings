/**
 * `GET /api/spotify/login` -> 302 to `accounts.spotify.com/authorize`
 *
 * Step 1-3 of PKCE. Mints a `code_verifier`, keeps it in an httpOnly cookie, and sends the
 * browser to Spotify with only the CHALLENGE — the one-way hash — in the URL. No client
 * secret exists anywhere in this flow, which is exactly why it is the flow a local app can
 * ship.
 *
 * `?return=/playlists/pl_x` remembers which page started the login, in a cookie rather than
 * in the redirect URI: Spotify requires the redirect URI to match the dashboard entry
 * character for character, so it cannot carry a per-playlist path.
 */

import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { SCOPE, authorizeUrl, beginAuthorization } from '@/lib/spotify/pkce';
import {
  DEFAULT_RETURN_PATH,
  isHttps,
  safeReturnPath,
  setHandshakeCookies,
} from '@/lib/spotify/session';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const clientId = env.spotifyClientId;
  if (!clientId) {
    // A hand-typed URL for a feature that is switched off. The UI never shows this route
    // when unconfigured, so the honest answer is the instruction, not a redirect.
    return NextResponse.json(
      {
        error: 'not_configured',
        message:
          'Set SPOTIFY_CLIENT_ID (and SPOTIFY_REDIRECT_URI) to enable the Spotify push. ' +
          'The redirect URI must be a loopback IP literal — localhost is rejected by Spotify.',
        need: {
          SPOTIFY_CLIENT_ID: 'the Client ID of an app at https://developer.spotify.com/dashboard',
          SPOTIFY_REDIRECT_URI: env.spotifyRedirectUri,
        },
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const returnTo = safeReturnPath(
    new URL(request.url).searchParams.get('return') ?? DEFAULT_RETURN_PATH,
  );
  const { verifier, challenge, state } = beginAuthorization();

  const url = authorizeUrl({
    clientId,
    redirectUri: env.spotifyRedirectUri,
    codeChallenge: challenge,
    state,
    scope: SCOPE,
  });

  // 302 rather than Next's default 307: this is a GET that ends a GET, and 302 is what
  // every OAuth example and every proxy in the world expects to see here.
  const response = NextResponse.redirect(url, 302);
  response.headers.set('Cache-Control', 'no-store');
  setHandshakeCookies(response.cookies, { verifier, state, returnTo }, { secure: isHttps(request) });
  return response;
}
