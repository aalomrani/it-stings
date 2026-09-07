/**
 * The three cookies that carry the PKCE handshake across the trip to Spotify, and the
 * rules for reading anything that comes back from that trip.
 *
 * Not in the task's file list — it exists so `login` and `callback` cannot disagree about
 * a cookie name, a `SameSite` value or what counts as a safe place to redirect to. Both
 * routes are short because everything here is one decision each.
 *
 * The verifier is the secret half of PKCE and lives ONLY here: `httpOnly` keeps it out of
 * page JS, `sameSite: 'lax'` is the strictest value that survives Spotify's top-level GET
 * redirect back to us (`strict` would drop the cookie on that navigation and every login
 * would fail), and a ten-minute `maxAge` means an abandoned login leaves nothing behind.
 */

import type { NextResponse } from 'next/server';

export const VERIFIER_COOKIE = 'itstings_sp_verifier';
export const STATE_COOKIE = 'itstings_sp_state';
export const RETURN_COOKIE = 'itstings_sp_return';

/** Long enough to read a consent screen, short enough that a stale one is worthless. */
export const HANDSHAKE_MAX_AGE_SECONDS = 600;

/** Where the callback sends a browser that arrived without a remembered page. */
export const DEFAULT_RETURN_PATH = '/playlists';

/** The query parameter the playlist page reads to report what the round trip did. */
export const RESULT_PARAM = 'spotify';
export const REASON_PARAM = 'spotify_reason';

type CookieJar = NextResponse['cookies'];

/**
 * Cookies straight off the request header.
 *
 * Deliberately not `next/headers`' `cookies()`: these handlers are called directly in the
 * unit tests, where there is no request scope for that helper to read, and a `Request` is
 * the only thing a test should have to build.
 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * Fly terminates TLS and forwards the original scheme; plain http on 127.0.0.1 must not
 * get a `Secure` cookie or the whole flow would be untestable locally.
 */
export function isHttps(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]?.trim() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A same-origin path we are willing to send a browser to after the callback.
 *
 * Only a single-slash absolute path, no scheme, no `//host` (which a browser reads as
 * protocol-relative and would make this an open redirect), no control characters. Anything
 * else falls back to `/playlists`.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (typeof value !== 'string') return DEFAULT_RETURN_PATH;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return DEFAULT_RETURN_PATH;
  if (trimmed.startsWith('//')) return DEFAULT_RETURN_PATH;
  // A backslash (which some clients normalise to `/`), whitespace or a control
  // character are all ways to smuggle a different origin past the two checks above.
  if (/[\u0000-\u0020\u007f\\]/.test(trimmed)) return DEFAULT_RETURN_PATH;
  if (trimmed.length > 512) return DEFAULT_RETURN_PATH;
  return trimmed;
}

/**
 * A message safe to put in a query string and render as text.
 *
 * React escapes whatever it renders, so this is not the XSS boundary — it is the "a
 * sentence, not a payload" boundary: printable ASCII plus the punctuation our own messages
 * use, capped at a length that fits a line on the page.
 */
export function safeReason(value: string | null | undefined, fallback = 'unknown error'): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[^\w \-.,:;()'’—/]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 180) : fallback;
}

/** Spotify's `?error=` codes, as sentences (api-reality §3.5: `access_denied` is the one). */
export function readableAuthError(code: string | null): string {
  switch (code) {
    case 'access_denied':
      return 'you did not authorise It Stings on Spotify, so nothing was pushed.';
    case 'invalid_client':
      return 'Spotify did not recognise SPOTIFY_CLIENT_ID — check the dashboard app.';
    case 'invalid_redirect_uri':
    case 'invalid_request':
      return 'Spotify rejected the redirect URI — it must match the dashboard entry exactly, and be a 127.0.0.1 loopback literal rather than localhost.';
    case 'server_error':
    case 'temporarily_unavailable':
      return 'Spotify could not complete the login just now — try again.';
    default:
      return `Spotify refused the login (${safeReason(code, 'no reason given')}).`;
  }
}

const base = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
} as const;

/** Stores the handshake. Called once, on the way out to Spotify. */
export function setHandshakeCookies(
  cookies: CookieJar,
  values: { verifier: string; state: string; returnTo: string },
  options: { secure: boolean },
): void {
  const common = { ...base, secure: options.secure, maxAge: HANDSHAKE_MAX_AGE_SECONDS };
  cookies.set(VERIFIER_COOKIE, values.verifier, common);
  cookies.set(STATE_COOKIE, values.state, common);
  cookies.set(RETURN_COOKIE, values.returnTo, common);
}

/**
 * Drops the handshake. Called on EVERY exit from the callback — the success path, the
 * denial, the state mismatch and the failed exchange alike. A verifier that outlives its
 * one use is a credential lying around for no reason.
 */
export function clearHandshakeCookies(cookies: CookieJar, options: { secure: boolean }): void {
  const common = { ...base, secure: options.secure, maxAge: 0 };
  cookies.set(VERIFIER_COOKIE, '', common);
  cookies.set(STATE_COOKIE, '', common);
  cookies.set(RETURN_COOKIE, '', common);
}

/**
 * `/playlists/pl_x` + `connected` -> `/playlists/pl_x?spotify=connected`.
 *
 * RELATIVE, deliberately. An absolute URL here would have to be built from `request.url`,
 * and under the standalone server that string comes back as `http://localhost:PORT/...`
 * even when the browser asked for `http://127.0.0.1:PORT/...` — which is a DIFFERENT
 * origin: the handshake cookies would not travel, and the loopback literal Spotify insists
 * on would be swapped for the hostname it rejects. A relative `Location` (RFC 7231 §7.1.2)
 * keeps the browser exactly where it already is.
 */
export function returnPath(
  path: string,
  result: 'connected' | 'error',
  reason?: string,
): string {
  const safe = safeReturnPath(path);
  const [pathname, existing = ''] = safe.split('?', 2);
  const params = new URLSearchParams(existing);
  params.set(RESULT_PARAM, result);
  if (reason !== undefined) params.set(REASON_PARAM, safeReason(reason));
  return `${pathname}?${params.toString()}`;
}
