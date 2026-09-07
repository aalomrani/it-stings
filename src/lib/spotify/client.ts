/**
 * Spotify with a USER token — the four calls the push needs, and the token lifecycle
 * behind them.
 *
 * Deliberately separate from `src/lib/sources/spotify.ts`. That file holds an app-level
 * client-credentials token (id + secret) and answers "what is this track's id"; it can
 * never create a playlist, because a client-credentials token has no user. This file holds
 * the ONE user's PKCE token from `spotify_auth`, needs no client secret at all, and is the
 * only thing in It Stings that writes to somebody's Spotify account.
 *
 * Rules this file keeps:
 *  - `ttlMs: 0` and `noStore: true` on every request. A bearer token in a request header
 *    and a playlist write in a body have no business in `http_cache`, and a cached POST
 *    would be a silent duplicate write.
 *  - Nothing throws, nothing logs a token. Failures come back as `{ ok: false, reason }`
 *    with a sentence a route can hand straight to the page.
 *  - Development Mode is the reality (api-reality §3.5): search `limit` is capped at 10,
 *    playlist writes go to `/v1/playlists/{id}/items` (the `/tracks` spelling is
 *    deprecated), and a maximum of 100 items may be added per request.
 */

import { z } from 'zod';

import * as authRepo from '@/lib/db/repos/spotifyAuth';
import { env } from '@/lib/env';
import { fetchExternal, type ExternalResult } from '@/lib/http/fetchExternal';
import { SCOPE, TOKEN_ENDPOINT } from '@/lib/spotify/pkce';
import { buildUrl, cleanQuery } from '@/lib/sources/common';
import { artistOverlap, sameTitle } from '@/lib/util/normalize';

export const API = 'https://api.spotify.com/v1';

/** `limit` is 0-10 in Development Mode, which is what every new app gets now. */
export const SEARCH_LIMIT = 10;
/** "A maximum of 100 items can be added in one request." — Add Items to a Playlist. */
export const MAX_ITEMS_PER_REQUEST = 100;
/** Refresh this far before `expires_at`, so a slow push cannot expire mid-flight. */
export const REFRESH_SKEW_MS = 60_000;

export const PLAYLIST_DESCRIPTION = 'from It Stings';

/**
 * Why a user-token call could not answer. A superset of the `sources/common` vocabulary
 * because this client has two failure modes no keyless source has: nobody is logged in,
 * and the login we had is gone.
 */
export type SpotifyFailure =
  | 'not_configured' // SPOTIFY_CLIENT_ID unset — no request was made
  | 'not_logged_in' // no row in spotify_auth
  | 'auth_expired' // refresh rejected; the row has been cleared, log in again
  | 'invalid_request' // our own params were unusable
  | 'not_found'
  | 'forbidden' // 403: dev-mode allowlist, or a playlist that is not the user's
  | 'rate_limited'
  | 'upstream_error'
  | 'bad_response';

export type SpotifyResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: SpotifyFailure; detail?: string };

const ok = <T,>(value: T): SpotifyResult<T> => ({ ok: true, value });
const fail = <T,>(reason: SpotifyFailure, detail?: string): SpotifyResult<T> =>
  detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };

export interface Tokens {
  accessToken: string;
  /** Absent when a refresh response carried no new one — keep the stored token. */
  refreshToken: string | null;
  expiresAt: number;
  scope: string | null;
}

export interface SpotifyProfile {
  id: string;
  displayName: string | null;
}

export interface SpotifyTrackMatch {
  id: string;
  uri: string;
  url: string;
}

export interface CreatedPlaylist {
  id: string;
  url: string;
}

/* ---------------------------------------------------------------------- *
 * schemas — permissive, like every other client in this app
 * ---------------------------------------------------------------------- */

const TokenSchema = z
  .object({
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    expires_in: z.number().optional(),
    scope: z.string().optional(),
    token_type: z.string().optional(),
  })
  .loose();

const MeSchema = z
  .object({ id: z.string().optional(), display_name: z.string().nullish() })
  .loose();

const SearchSchema = z
  .object({
    tracks: z
      .object({
        items: z
          .array(
            z
              .object({
                id: z.string().optional(),
                uri: z.string().optional(),
                name: z.string().optional(),
                duration_ms: z.number().optional(),
                artists: z.array(z.object({ name: z.string().optional() }).loose()).optional(),
                external_urls: z.object({ spotify: z.string().optional() }).loose().optional(),
              })
              .loose(),
          )
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const PlaylistSchema = z
  .object({
    id: z.string().optional(),
    external_urls: z.object({ spotify: z.string().optional() }).loose().optional(),
  })
  .loose();

const SnapshotSchema = z.object({ snapshot_id: z.string().optional() }).loose();

/* ---------------------------------------------------------------------- *
 * transport
 * ---------------------------------------------------------------------- */

/** PKCE needs a client id and NO secret. That is the whole point of the flow. */
export function configured(): boolean {
  return Boolean(env.spotifyClientId);
}

export function trackUri(id: string): string {
  return `spotify:track:${id}`;
}

/** `[1..n]` split into runs of at most `size`. Exported because the push chunks on it. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function httpFailure<T>(res: Extract<ExternalResult, { ok: false }>): SpotifyResult<T> {
  switch (res.status) {
    case 401:
      return fail<T>('auth_expired', res.reason);
    case 403:
      return fail<T>('forbidden', res.reason);
    case 404:
      return fail<T>('not_found', res.reason);
    case 429:
      return fail<T>('rate_limited', res.reason);
    default:
      return fail<T>('upstream_error', res.reason);
  }
}

function parse<S extends z.ZodType>(
  res: Extract<ExternalResult, { ok: true }>,
  schema: S,
): SpotifyResult<z.infer<S>> {
  let raw: unknown;
  try {
    raw = JSON.parse(res.text.trim());
  } catch {
    return fail('bad_response', `not JSON (${res.text.slice(0, 80)})`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return fail('bad_response', parsed.error.issues.map((i) => i.message).join('; ').slice(0, 200));
  }
  return ok(parsed.data as z.infer<S>);
}

/** One authenticated api.spotify.com call. Never cached, never retried more than once. */
async function api<S extends z.ZodType>(
  token: string,
  init: { url: string; method?: 'GET' | 'POST'; body?: unknown },
  schema: S,
): Promise<SpotifyResult<z.infer<S>>> {
  const res = await fetchExternal({
    url: init.url,
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    ttlMs: 0,
    noStore: true,
    // 201 is the documented success for Create Playlist and Add Items.
    okStatuses: [200, 201],
    retries: 1,
  });
  if (!res.ok) return httpFailure(res);
  return parse(res, schema);
}

/** `POST accounts.spotify.com/api/token`, form encoded. The response body IS a credential. */
async function postToken(form: Record<string, string>): Promise<SpotifyResult<Tokens>> {
  const res = await fetchExternal({
    url: TOKEN_ENDPOINT,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    // A live bearer credential must never be written to the cache, on any TTL.
    ttlMs: 0,
    noStore: true,
    retries: 1,
  });
  if (!res.ok) {
    // 400 `invalid_grant` is the "this login is over" answer; 400 `invalid_client` means
    // the client id is wrong. Both mean the same thing to the user: log in again.
    if (res.status === 400) return fail('auth_expired', res.reason);
    return httpFailure(res);
  }

  const parsed = parse(res, TokenSchema);
  if (!parsed.ok) return parsed;
  const accessToken = parsed.value.access_token;
  if (!accessToken) return fail('bad_response', 'token response carried no access_token');

  return ok({
    accessToken,
    refreshToken: parsed.value.refresh_token ?? null,
    expiresAt: Date.now() + (parsed.value.expires_in ?? 3600) * 1000,
    scope: parsed.value.scope ?? null,
  });
}

/* ---------------------------------------------------------------------- *
 * the token lifecycle
 * ---------------------------------------------------------------------- */

/** Step 4 of PKCE: the authorization code plus the verifier that proves the challenge. */
export function exchangeCode(input: {
  code: string;
  verifier: string;
  redirectUri?: string;
}): Promise<SpotifyResult<Tokens>> {
  const clientId = env.spotifyClientId;
  if (!clientId) return Promise.resolve(fail('not_configured', 'SPOTIFY_CLIENT_ID is not set'));
  return postToken({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri ?? env.spotifyRedirectUri,
    client_id: clientId,
    code_verifier: input.verifier,
  });
}

/** `grant_type=refresh_token`. No secret — PKCE refresh is client-id only. */
export function refreshTokens(refreshToken: string): Promise<SpotifyResult<Tokens>> {
  const clientId = env.spotifyClientId;
  if (!clientId) return Promise.resolve(fail('not_configured', 'SPOTIFY_CLIENT_ID is not set'));
  return postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
}

/**
 * A usable access token, refreshing transparently when the stored one is within
 * `REFRESH_SKEW_MS` of expiry.
 *
 * The refresh is proactive rather than a reaction to a 401: a push is a sequence of writes,
 * and discovering expiry halfway through would mean a half-written playlist. A rejected
 * refresh clears the row — the grant is gone, and a stored token that can never be renewed
 * would make the UI claim a connection that does not exist.
 */
export async function accessToken(now: number = Date.now()): Promise<SpotifyResult<string>> {
  if (!configured()) return fail('not_configured', 'SPOTIFY_CLIENT_ID is not set');

  const row = authRepo.get();
  if (!row) return fail('not_logged_in', 'no Spotify account is connected');
  if (row.expiresAt > now + REFRESH_SKEW_MS) return ok(row.accessToken);

  const refreshed = await refreshTokens(row.refreshToken);
  if (!refreshed.ok) {
    if (refreshed.reason === 'auth_expired') {
      authRepo.clear();
      return fail('auth_expired', 'Spotify rejected the stored login — connect again');
    }
    return fail(refreshed.reason, refreshed.detail);
  }

  // "the response might not include a new refresh token. If it does not, continue using
  // the existing token" — so `refreshToken: null` here means keep, never clear.
  authRepo.save({
    accessToken: refreshed.value.accessToken,
    refreshToken: refreshed.value.refreshToken,
    expiresAt: refreshed.value.expiresAt,
    ...(refreshed.value.scope === null ? {} : { scope: refreshed.value.scope }),
  });
  return ok(refreshed.value.accessToken);
}

/** True when the grant we hold covers the writes the push makes. */
export function hasPushScope(scope: string | null | undefined): boolean {
  if (!scope) return true; // Spotify omitted it; assume the grant we asked for.
  return scope.split(/\s+/).includes(SCOPE);
}

/* ---------------------------------------------------------------------- *
 * the four calls the push makes
 * ---------------------------------------------------------------------- */

/** `GET /v1/me` — only for the display name the status route shows. */
export async function me(token: string): Promise<SpotifyResult<SpotifyProfile>> {
  const res = await api(token, { url: `${API}/me` }, MeSchema);
  if (!res.ok) return res;
  if (!res.value.id) return fail('bad_response', 'profile carried no id');
  return ok({ id: res.value.id, displayName: res.value.display_name ?? null });
}

/**
 * `GET /v1/search?type=track&limit=10` with a strict match on the way out.
 *
 * Spotify will happily return ten plausible-looking tracks for a query it did not
 * understand, so the match is made HERE: normalised title equality plus artist overlap,
 * and a duration within 8 s when we know one. A near miss is skipped and reported rather
 * than pushed — a playlist quietly containing the wrong "Hell" is worse than a playlist
 * that says it could not find it.
 */
export async function searchTrack(
  token: string,
  artist: string,
  title: string,
  { durationMs }: { durationMs?: number } = {},
): Promise<SpotifyResult<SpotifyTrackMatch>> {
  const a = cleanQuery(artist);
  const t = cleanQuery(title);
  if (!a || !t) return fail('invalid_request', 'artist and title are both required');

  const res = await api(
    token,
    {
      url: buildUrl(`${API}/search`, {
        limit: SEARCH_LIMIT,
        q: `track:${t} artist:${a}`,
        type: 'track',
      }),
    },
    SearchSchema,
  );
  if (!res.ok) return res;

  const items = res.value.tracks?.items ?? [];
  const match = items.find((item) => {
    const names = (item.artists ?? []).map((x) => x.name ?? '').filter(Boolean);
    return (
      item.id &&
      item.name &&
      sameTitle(item.name, t) &&
      names.some((n) => artistOverlap(n, a)) &&
      (!durationMs || !item.duration_ms || Math.abs(item.duration_ms - durationMs) <= 8000)
    );
  });
  if (!match?.id) return fail('not_found', `no strict match on Spotify for ${artist} — ${title}`);

  return ok({
    id: match.id,
    uri: match.uri ?? trackUri(match.id),
    url: match.external_urls?.spotify ?? `https://open.spotify.com/track/${match.id}`,
  });
}

/**
 * `POST /v1/me/playlists` — the current spelling. `POST /users/{id}/playlists` is
 * deprecated (api-reality §3.5) and is not used here.
 */
export async function createPlaylist(
  token: string,
  input: { name: string; description?: string },
): Promise<SpotifyResult<CreatedPlaylist>> {
  const name = input.name.trim();
  if (!name) return fail('invalid_request', 'a playlist needs a name');

  const res = await api(
    token,
    {
      url: `${API}/me/playlists`,
      method: 'POST',
      body: {
        name,
        public: false,
        description: input.description ?? PLAYLIST_DESCRIPTION,
      },
    },
    PlaylistSchema,
  );
  if (!res.ok) return res;
  if (!res.value.id) return fail('bad_response', 'created playlist carried no id');
  return ok({
    id: res.value.id,
    url: res.value.external_urls?.spotify ?? `https://open.spotify.com/playlist/${res.value.id}`,
  });
}

/**
 * `POST /v1/playlists/{id}/items` — the Feb 2026 rename of `/tracks`.
 *
 * The URIs go in the JSON BODY, not the query string: "if the uris parameter is present in
 * the query string, any URIs listed here in the body will be ignored", and a query string
 * of 100 URIs is a URL long enough to meet a proxy's limit.
 */
export async function addItems(
  token: string,
  playlistId: string,
  uris: readonly string[],
): Promise<SpotifyResult<{ snapshotId: string | null }>> {
  if (uris.length === 0) return fail('invalid_request', 'no uris to add');
  if (uris.length > MAX_ITEMS_PER_REQUEST) {
    return fail('invalid_request', `at most ${MAX_ITEMS_PER_REQUEST} items per request`);
  }
  const res = await api(
    token,
    {
      url: `${API}/playlists/${encodeURIComponent(playlistId)}/items`,
      method: 'POST',
      body: { uris: [...uris] },
    },
    SnapshotSchema,
  );
  if (!res.ok) return res;
  return ok({ snapshotId: res.value.snapshot_id ?? null });
}

/** The sentence a route hands to the page for each failure. Never mentions a token. */
export function explain(reason: SpotifyFailure, detail?: string): string {
  switch (reason) {
    case 'not_configured':
      return 'SPOTIFY_CLIENT_ID is not set, so the Spotify push is off.';
    case 'not_logged_in':
      return 'no Spotify account is connected — connect one first.';
    case 'auth_expired':
      return 'the Spotify login has expired or was revoked — connect again.';
    case 'forbidden':
      return (
        'Spotify refused the write (403). In Development Mode only accounts added to the ' +
        'app’s allowlist may use it, and the app owner needs Premium.'
      );
    case 'rate_limited':
      return 'Spotify is rate limiting this app right now — try again in a minute.';
    case 'not_found':
      return 'Spotify has no such track or playlist.';
    case 'invalid_request':
      return detail ?? 'that request could not be made.';
    case 'bad_response':
      return 'Spotify answered something this app could not read.';
    case 'upstream_error':
      return 'Spotify could not be reached.';
  }
}
