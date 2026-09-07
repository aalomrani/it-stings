/**
 * PKCE (RFC 7636) — the whole reason this flow needs no client secret.
 *
 * Pure functions over `node:crypto`. No I/O, no environment, no state: everything here is
 * a value in and a value out, which is what makes the authorize URL testable without a
 * client id and the S256 transform testable against the RFC's own vectors.
 *
 * The shape of the flow (docs/api-reality.md §3.5, quoted from Spotify's own tutorial):
 *   1. mint a `code_verifier`  — 43-128 chars of `[A-Za-z0-9-._~]`
 *   2. `code_challenge` = base64url(SHA-256(verifier)), `=` stripped, `+`→`-`, `/`→`_`
 *   3. send the CHALLENGE to `/authorize` with `code_challenge_method=S256`
 *   4. send the VERIFIER to `/api/token` — the server proves the two match
 * The verifier never leaves this origin (it lives in an httpOnly cookie for the ~60 s the
 * user is on Spotify's page); the challenge is a one-way hash and is safe in a URL.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize';
export const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

/**
 * The only scope this app asks for. `playlist-modify-private` covers Create Playlist and
 * Add Items to a Playlist (api-reality §3.5, "Scopes"), which is exactly the push and
 * nothing else: no reading the user's library, no public playlists, no profile beyond the
 * display name every token carries.
 */
export const SCOPE = 'playlist-modify-private';

/** RFC 7636 §4.1: `unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"`. */
export const VERIFIER_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
export const VERIFIER_MIN_LENGTH = 43;
export const VERIFIER_MAX_LENGTH = 128;
export const DEFAULT_VERIFIER_LENGTH = 64;

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/** base64url: standard base64 with `+`→`-`, `/`→`_` and the `=` padding removed. */
export function base64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A fresh `code_verifier`.
 *
 * `randomInt` is the CSPRNG, and rejection sampling is its problem rather than ours — a
 * modulo over `randomBytes` would bias the last few characters of a 65-character alphabet,
 * which is exactly the kind of quiet entropy loss PKCE exists to prevent.
 */
export function createVerifier(length: number = DEFAULT_VERIFIER_LENGTH): string {
  if (!Number.isInteger(length) || length < VERIFIER_MIN_LENGTH || length > VERIFIER_MAX_LENGTH) {
    throw new RangeError(
      `code_verifier length must be an integer in [${VERIFIER_MIN_LENGTH}, ${VERIFIER_MAX_LENGTH}]`,
    );
  }
  let out = '';
  for (let i = 0; i < length; i++) out += VERIFIER_ALPHABET[randomInt(VERIFIER_ALPHABET.length)];
  return out;
}

/** RFC 7636 §4.6: does this string qualify as a `code_verifier` at all? */
export function isVerifier(value: unknown): value is string {
  return typeof value === 'string' && VERIFIER_RE.test(value);
}

/** S256: `base64url(SHA-256(ASCII(verifier)))`. RFC 7636 §4.2. */
export function challengeFor(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier, 'ascii').digest());
}

/**
 * The CSRF `state`. Same alphabet as the verifier so it survives a query string untouched;
 * 32 characters is ~190 bits over a 65-symbol alphabet.
 */
export function createState(): string {
  let out = '';
  for (let i = 0; i < 32; i++) out += VERIFIER_ALPHABET[randomInt(VERIFIER_ALPHABET.length)];
  return out;
}

/**
 * Constant-time `state` comparison. The value is a public nonce rather than a secret, but
 * comparing it in constant time costs nothing and keeps the one comparison in the flow
 * that gates a token exchange from being the one that leaks a timing signal.
 */
export function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export interface AuthorizeParams {
  clientId: string;
  /**
   * Must be, character for character, a URI registered in the dashboard, and for a local
   * app must be a loopback IP LITERAL: `http://127.0.0.1:PORT/...`. Spotify rejects
   * `localhost` outright (api-reality §3.5, "Redirect URIs").
   */
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope?: string;
}

/**
 * The `accounts.spotify.com/authorize` URL, parameters in the order Spotify's own
 * reference lists them. Order is cosmetic to the server and load-bearing to a human
 * reading the redirect in a browser bar or a task report.
 */
export function authorizeUrl({
  clientId,
  redirectUri,
  codeChallenge,
  state,
  scope = SCOPE,
}: AuthorizeParams): string {
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('response_type', 'code');
  params.set('redirect_uri', redirectUri);
  params.set('scope', scope);
  params.set('code_challenge_method', 'S256');
  params.set('code_challenge', codeChallenge);
  params.set('state', state);
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

/**
 * Verifier + challenge + state in one call: the three values `/api/spotify/login` needs,
 * minted together so no route can accidentally hash the wrong one.
 */
export function beginAuthorization(length: number = DEFAULT_VERIFIER_LENGTH): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = createVerifier(length);
  return { verifier, challenge: challengeFor(verifier), state: createState() };
}
