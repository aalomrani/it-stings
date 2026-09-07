/**
 * Spotify — deep links first, an id when credentials happen to exist.
 *
 * Reality that shapes this file (docs/api-reality.md §3.5):
 *  - audio-features, audio-analysis, recommendations, related-artists and `preview_url`
 *    are all dead for new apps. This client does METADATA AND LINKS ONLY.
 *  - everything on api.spotify.com 401s without a token, so with no credentials we never
 *    call it: `searchDeepLink` returns `open.spotify.com/search/<query>` (verified 200,
 *    keyless) and that is what `links.spotify` gets.
 *  - the embed page returns 200 for a nonexistent id, so `oembed` (a real 404) is the
 *    only way to validate an id.
 *  - PKCE / user OAuth is Phase 6. Nothing here asks for a user scope.
 */

import { z } from 'zod';

import { env } from '@/lib/env';
import { fetchExternal } from '@/lib/http/fetchExternal';
import { artistOverlap, sameTitle } from '@/lib/util/normalize';
import { sha1 } from '@/lib/util/ids';
import {
  TTL,
  buildUrl,
  cleanQuery,
  fail,
  failureFromHttp,
  ok,
  parseBody,
  type SourceDescription,
  type SourceResult,
} from '@/lib/sources/common';

const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const OPEN = 'https://open.spotify.com';

export interface SpotifyTrack {
  id: string;
  url: string;
}

export interface SpotifyOembed {
  title: string;
  thumbnailUrl: string | null;
  iframeUrl: string | null;
}

const TokenSchema = z
  .object({
    access_token: z.string().optional(),
    token_type: z.string().optional(),
    expires_in: z.number().optional(),
  })
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
                name: z.string().optional(),
                duration_ms: z.number().optional(),
                artists: z.array(z.object({ name: z.string().optional() }).loose()).optional(),
                external_urls: z.object({ spotify: z.string().optional() }).loose().optional(),
                external_ids: z.object({ isrc: z.string().optional() }).loose().optional(),
              })
              .loose(),
          )
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const OembedSchema = z
  .object({
    title: z.string().optional(),
    thumbnail_url: z.string().optional(),
    iframe_url: z.string().optional(),
  })
  .loose();

interface TokenState {
  token: string | null;
  expiresAt: number;
}

/** Survives Next's dev hot reload, so a reload never re-mints a still-valid token. */
const globalRef = globalThis as typeof globalThis & { __itstingsSpotifyToken?: TokenState };
const tokenState: TokenState = (globalRef.__itstingsSpotifyToken ??= { token: null, expiresAt: 0 });

export function configured(): boolean {
  return Boolean(env.spotifyClientId && env.spotifyClientSecret);
}

/** Tests / key rotation: drop the in-memory token. */
export function resetToken(): void {
  tokenState.token = null;
  tokenState.expiresAt = 0;
}

/**
 * Client-credentials token, cached IN MEMORY ONLY (`tokenState` hangs off `globalThis`,
 * so it survives Next's hot reload).
 *
 * `ttlMs: 0` is deliberate: this is the one request in the app whose response body IS a
 * live bearer credential, and nothing else in It Stings writes a credential to disk —
 * Last.fm's key is deliberately kept out of the `http_cache` `url` column, and
 * GetSongBPM/Tavily/Brave send theirs as headers. A dev-server restart costs one token
 * mint, which is free and irrelevant to every rate limit.
 */
async function getToken(force = false): Promise<SourceResult<string>> {
  const id = env.spotifyClientId;
  const secret = env.spotifyClientSecret;
  if (!id || !secret) return fail('no_api_key', 'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set');

  const now = Date.now();
  if (!force && tokenState.token && tokenState.expiresAt > now + 30_000) {
    return ok(tokenState.token, { fromCache: true, fetchedAt: now });
  }

  const res = await fetchExternal({
    url: ACCOUNTS,
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    // Credentials never touch the cache key in the clear, but a key rotation must miss.
    cacheKeyExtra: `spotify-token:${sha1(`${id}:${secret}`)}`,
    ttlMs: 0,
    retries: 1,
  });
  if (!res.ok) return failureFromHttp(res, { 400: 'invalid_api_key' });

  const parsed = parseBody(res, TokenSchema);
  if (!parsed.ok) return parsed;
  const token = parsed.value.access_token;
  if (!token) return fail('invalid_api_key', 'token response had no access_token');

  const lifetimeMs = (parsed.value.expires_in ?? 3600) * 1000;
  tokenState.token = token;
  tokenState.expiresAt = parsed.fetchedAt + lifetimeMs;
  return ok(token, { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt });
}

/**
 * `GET /v1/search?type=track` — `limit` is capped at 10 in development mode, which is
 * what every new app gets now, so 10 is the ceiling here too.
 */
export async function searchTrack(
  artist: string,
  title: string,
  { durationMs }: { durationMs?: number } = {},
): Promise<SourceResult<SpotifyTrack>> {
  if (!configured()) return fail('no_api_key', 'Spotify credentials not set');
  const a = cleanQuery(artist);
  const t = cleanQuery(title);
  if (!a || !t) return fail('invalid_request', 'artist and title required');

  const url = buildUrl(`${API}/search`, {
    limit: 10,
    q: `track:${t} artist:${a}`,
    type: 'track',
  });

  let attempt = await searchOnce(url, false);
  // A cached-but-expired token answers 401 once; mint a fresh one and try again.
  if (!attempt.ok && attempt.reason === 'invalid_api_key') attempt = await searchOnce(url, true);
  if (!attempt.ok) return attempt;

  const items = attempt.value.tracks?.items ?? [];
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
  if (!match?.id) return fail('not_found', `no Spotify track for ${artist} — ${title}`);

  return ok(
    { id: match.id, url: match.external_urls?.spotify ?? trackUrl(match.id) },
    { fromCache: attempt.fromCache, fetchedAt: attempt.fetchedAt },
  );
}

async function searchOnce(url: string, forceToken: boolean): Promise<SourceResult<z.infer<typeof SearchSchema>>> {
  const token = await getToken(forceToken);
  if (!token.ok) return token;

  const res = await fetchExternal({
    url,
    headers: { Authorization: `Bearer ${token.value}` },
    ttlMs: TTL.spotify,
    retries: 1,
  });
  if (!res.ok) return failureFromHttp(res);
  return parseBody(res, SearchSchema);
}

/** Keyless. Verified 200; the desktop app opens it with the query prefilled. */
export function searchDeepLink(artist: string, title: string): string {
  return `${OPEN}/search/${encodeURIComponent(cleanQuery(`${artist} ${title}`))}`;
}

export function trackUrl(id: string): string {
  return `${OPEN}/track/${id}`;
}

/**
 * A Spotify id is 22 base62 characters (docs/architecture.md, "Preview audio"). Validating
 * locally is not decoration: oEmbed answers a MALFORMED id with 504, which every retry
 * heuristic reads as "upstream is busy, try again", so one typo used to cost two upstream
 * calls and a 1.2 s backoff before failing.
 */
export const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;

export function isValidId(id: string): boolean {
  return SPOTIFY_ID.test(id);
}

/** Keyless. The iframe the card falls back to when no preview MP3 exists. */
export function embedUrl(id: string): string | null {
  return isValidId(id) ? `${OPEN}/embed/track/${id}` : null;
}

/**
 * Keyless. `open.spotify.com/embed/track/<id>` answers 200 even for a nonexistent id;
 * oEmbed answers a real 404, so this is the only way to validate an id without a token.
 */
export async function oembed(url: string): Promise<SourceResult<SpotifyOembed>> {
  const trackId = /^https:\/\/open\.spotify\.com\/(?:embed\/)?track\/([^/?#]+)/.exec(url)?.[1]
    ?? /^spotify:track:([^:?#]+)/.exec(url)?.[1];
  if (!/^https:\/\/open\.spotify\.com\/|^spotify:/.test(url)) {
    return fail('invalid_request', `not a Spotify URL: ${url}`);
  }
  // Reject a malformed id here rather than spending a 504 upstream to learn the same thing.
  if (trackId !== undefined && !isValidId(trackId)) {
    return fail('invalid_request', `not a Spotify track id: ${trackId}`);
  }
  const res = await fetchExternal({
    url: buildUrl(`${OPEN}/oembed`, { url }),
    ttlMs: TTL.spotify,
    // 504 here means "bad request", not "busy" (api-reality addendum C3), and the transport
    // retries every 5xx — so this call gets no retry budget at all.
    retries: 0,
    okStatuses: [200],
  });
  if (!res.ok) return failureFromHttp(res, { 404: 'not_found', 504: 'invalid_request' });

  const parsed = parseBody(res, OembedSchema);
  if (!parsed.ok) return parsed;
  return ok(
    {
      title: parsed.value.title ?? '',
      thumbnailUrl: parsed.value.thumbnail_url ?? null,
      iframeUrl: parsed.value.iframe_url ?? null,
    },
    { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt },
  );
}

export function describe(): SourceDescription {
  return { name: 'spotify', needsKey: true, configured: configured() };
}
