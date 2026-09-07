/**
 * `GET /api/spotify/callback` -> 302 back to the page the login started from
 *
 * Step 4 of PKCE, and the only place an authorization code is ever exchanged. Every exit
 * from this route — the grant, the denial, the state mismatch, the failed exchange — does
 * the same two things: drop the handshake cookies, and send the browser back to a page that
 * can SAY what happened. Nothing here renders HTML and nothing here returns a bare error
 * code, because the person who ends up here is in the middle of a click, not reading JSON.
 *
 * The tokens go straight into `spotify_auth` and no further. Nothing in the redirect, the
 * cookies or the logs carries one.
 */

import { NextResponse } from 'next/server';

import * as authRepo from '@/lib/db/repos/spotifyAuth';
import * as spotify from '@/lib/spotify/client';
import { isVerifier, sameState } from '@/lib/spotify/pkce';
import {
  DEFAULT_RETURN_PATH,
  RETURN_COOKIE,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  clearHandshakeCookies,
  isHttps,
  readCookie,
  readableAuthError,
  returnPath,
  safeReturnPath,
} from '@/lib/spotify/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secure = isHttps(request);
  const query = new URL(request.url).searchParams;
  const returnTo = safeReturnPath(readCookie(request, RETURN_COOKIE) ?? DEFAULT_RETURN_PATH);

  /** Every exit goes through here, so no branch can forget to drop the verifier. */
  const back = (result: 'connected' | 'error', reason?: string) => {
    const response = new NextResponse(null, {
      status: 302,
      headers: {
        Location: returnPath(returnTo, result, reason),
        'Cache-Control': 'no-store',
      },
    });
    clearHandshakeCookies(response.cookies, { secure });
    return response;
  };

  if (!spotify.configured()) {
    return back('error', 'SPOTIFY_CLIENT_ID is not set, so there is no login to complete.');
  }

  // Spotify's own refusal, `?error=access_denied` being the everyday one.
  const denied = query.get('error');
  if (denied) return back('error', readableAuthError(denied));

  const code = query.get('code');
  const state = query.get('state');
  const storedState = readCookie(request, STATE_COOKIE);
  const verifier = readCookie(request, VERIFIER_COOKIE);

  if (!code) return back('error', 'Spotify sent no authorization code back — start again.');
  if (!sameState(state, storedState)) {
    // Either a forged callback or a login that sat in a tab past the cookie's ten minutes.
    return back('error', 'that login could not be matched to this browser — start again.');
  }
  if (!isVerifier(verifier)) {
    return back('error', 'the login expired before it finished — start again.');
  }

  const tokens = await spotify.exchangeCode({ code, verifier });
  if (!tokens.ok) {
    return back('error', spotify.explain(tokens.reason, tokens.detail));
  }
  if (!tokens.value.refreshToken) {
    // Without one the connection dies in an hour with no way to renew it; better to say so
    // now than to look connected and fail on the next push.
    return back('error', 'Spotify returned no refresh token — start again.');
  }

  authRepo.save({
    accessToken: tokens.value.accessToken,
    refreshToken: tokens.value.refreshToken,
    expiresAt: tokens.value.expiresAt,
    scope: tokens.value.scope,
  });

  // Best effort: a display name is a nicety, and a failed `/me` must not throw away a
  // perfectly good token.
  const profile = await spotify.me(tokens.value.accessToken);
  if (profile.ok) {
    authRepo.save({
      accessToken: tokens.value.accessToken,
      expiresAt: tokens.value.expiresAt,
      userId: profile.value.id,
      displayName: profile.value.displayName,
    });
  }

  return back('connected');
}
