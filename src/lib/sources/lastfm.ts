/**
 * Last.fm — crowd tags (the seed fingerprint's hard data) and Channel A's candidates.
 *
 * Reality that shapes this file (docs/api-reality.md §3.4):
 *  - with NO key the API answers error 6, the same code as "not found". So the key is
 *    checked locally first and our own params are validated locally, and only THEN is an
 *    upstream 6 read as `not_found`. This is why `no_api_key` never reaches the network.
 *  - error 10 / 26 (HTTP 403) means the key is bad -> `invalid_api_key`, surfaced by
 *    `/api/health` rather than retried.
 *  - the JSON is XML-shaped: every number arrives as a STRING and a single repeated node
 *    collapses into a bare object. Both are handled here, never by callers.
 *  - `autocorrect=1` on every call, because "The Lovecats" and "The Love Cats" are two
 *    different entries with different stats.
 *  - ToS: a visible "powered by Last.fm" credit linking to the catalogue `url` we return
 *    is mandatory in the UI; the Last.fm rows we keep must stay well under 100 MB.
 */

import { z } from 'zod';

import { env } from '@/lib/env';
import { fetchExternal } from '@/lib/http/fetchExternal';
import {
  TTL,
  buildUrl,
  cleanQuery,
  fail,
  failureFromHttp,
  ok,
  parseBody,
  toArray,
  type SourceDescription,
  type SourceResult,
} from '@/lib/sources/common';

const BASE = 'https://ws.audioscrobbler.com/2.0/';

export const ATTRIBUTION = {
  text: 'Powered by AudioScrobbler / Last.fm',
  href: 'https://www.last.fm',
} as const;

export interface LastfmTag {
  name: string;
  count: number;
  url: string | null;
}

export interface LastfmSimilar {
  artist: string;
  title: string;
  match: number;
  mbid: string | null;
  url: string | null;
}

export interface LastfmTagTrack {
  artist: string;
  title: string;
  rank: number | null;
  mbid: string | null;
  url: string | null;
}

export interface LastfmSearchTrack {
  artist: string;
  title: string;
  listeners: number | null;
  mbid: string | null;
  url: string | null;
}

export interface LastfmTrackInfo {
  artist: string;
  title: string;
  mbid: string | null;
  url: string | null;
  durationMs: number | null;
  listeners: number | null;
  playcount: number | null;
  album: string | null;
  tags: LastfmTag[];
}

/** Every documented number arrives as a string; coerce, never trust the type. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;

const ErrorSchema = z.object({ error: z.number().optional(), message: z.string().optional() }).loose();

const ArtistRefSchema = z
  .object({ name: z.string().optional(), mbid: z.string().optional(), url: z.string().optional() })
  .loose();

const TagSchema = z
  .object({ name: z.string().optional(), count: z.unknown().optional(), url: z.string().optional() })
  .loose();

const TopTagsSchema = ErrorSchema.extend({
  toptags: z
    .object({ tag: z.union([TagSchema, z.array(TagSchema)]).optional() })
    .loose()
    .optional(),
});

const SimilarTrackSchema = z
  .object({
    name: z.string().optional(),
    mbid: z.string().optional(),
    match: z.unknown().optional(),
    url: z.string().optional(),
    artist: z.union([ArtistRefSchema, z.string()]).optional(),
  })
  .loose();

const SimilarSchema = ErrorSchema.extend({
  similartracks: z
    .object({ track: z.union([SimilarTrackSchema, z.array(SimilarTrackSchema)]).optional() })
    .loose()
    .optional(),
});

/**
 * `track.search`: per the doc XML the `artist` here is a PLAIN STRING, not the nested
 * object every other method uses (api-reality §3.4). `artistName()` handles both anyway.
 */
const SearchTrackSchema = z
  .object({
    name: z.string().optional(),
    mbid: z.string().optional(),
    url: z.string().optional(),
    listeners: z.unknown().optional(),
    artist: z.union([ArtistRefSchema, z.string()]).optional(),
  })
  .loose();

const SearchSchema = ErrorSchema.extend({
  results: z
    .object({
      trackmatches: z
        .object({ track: z.union([SearchTrackSchema, z.array(SearchTrackSchema)]).optional() })
        .loose()
        .optional(),
    })
    .loose()
    .optional(),
});

const TagTrackSchema = SimilarTrackSchema.extend({
  '@attr': z.object({ rank: z.unknown().optional() }).loose().optional(),
  rank: z.unknown().optional(),
});

const TagTopTracksSchema = ErrorSchema.extend({
  tracks: z
    .object({ track: z.union([TagTrackSchema, z.array(TagTrackSchema)]).optional() })
    .loose()
    .optional(),
  // The XML root is `toptracks`; the JSON key was UNTESTED without a key, so accept both.
  toptracks: z
    .object({ track: z.union([TagTrackSchema, z.array(TagTrackSchema)]).optional() })
    .loose()
    .optional(),
});

const TrackInfoSchema = ErrorSchema.extend({
  track: z
    .object({
      name: z.string().optional(),
      mbid: z.string().optional(),
      url: z.string().optional(),
      duration: z.unknown().optional(),
      listeners: z.unknown().optional(),
      playcount: z.unknown().optional(),
      artist: z.union([ArtistRefSchema, z.string()]).optional(),
      album: z.object({ title: z.string().optional() }).loose().optional(),
      toptags: z
        .object({ tag: z.union([TagSchema, z.array(TagSchema)]).optional() })
        .loose()
        .optional(),
    })
    .loose()
    .optional(),
});

const artistName = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'name' in v) return String((v as { name?: unknown }).name ?? '');
  return '';
};

/** Errors 8 / 11 / 16 / 29 are transient; retrying keeps them out of the cache too. */
export function isRetryableBody(status: number, text: string): boolean {
  if (status !== 200 || !text.includes('"error"')) return false;
  try {
    const body = JSON.parse(text) as { error?: number };
    return body.error === 8 || body.error === 11 || body.error === 16 || body.error === 29;
  } catch {
    return false;
  }
}

/**
 * An error body is an answer, not a fact. Without this a `{"error":6}` ("not found",
 * which Last.fm also returns for a transient miss) would occupy a 30-day cache row and
 * make the track permanently untaggable for a month.
 */
export function isCacheableBody(_status: number, text: string): boolean {
  if (!text.includes('"error"')) return true;
  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error !== 'number';
  } catch {
    return true;
  }
}

function failureFromCode<T>(code: number, message?: string): SourceResult<T> {
  const detail = `lastfm error ${code}${message ? `: ${message}` : ''}`;
  switch (code) {
    case 10:
    case 26:
      return fail<T>('invalid_api_key', detail);
    case 6:
    case 7:
      return fail<T>('not_found', detail);
    case 29:
      return fail<T>('rate_limited', detail);
    default:
      return fail<T>('upstream_error', detail);
  }
}

/**
 * One call. The key is added here and nowhere else; `cacheUrl` keeps it out of the
 * `http_cache` row (the cache KEY still hashes the real URL).
 */
async function call<S extends z.ZodType>(
  method: string,
  params: Record<string, string | number | undefined>,
  schema: S,
  ttlMs: number,
): Promise<SourceResult<z.infer<S>>> {
  const apiKey = env.lastfmApiKey;
  if (!apiKey) return fail('no_api_key', 'LASTFM_API_KEY is not set');

  const common = { method, format: 'json', autocorrect: 1, ...params };
  const url = buildUrl(BASE, { ...common, api_key: apiKey });
  const cacheUrl = buildUrl(BASE, common);

  const res = await fetchExternal({
    url,
    cacheUrl,
    ttlMs,
    retries: 2,
    isRetryableBody,
    isCacheableBody,
  });

  if (!res.ok) {
    // Verified shapes: no/empty key -> 400 error 6, bad key -> 403 error 10. We already
    // know the key is present and the params are valid, so 400 means "not found".
    return failureFromHttp(res, { 400: 'not_found', 403: 'invalid_api_key' });
  }

  const parsed = parseBody(res, schema);
  if (!parsed.ok) return parsed;

  const body = parsed.value as z.infer<typeof ErrorSchema>;
  if (typeof body.error === 'number') return failureFromCode(body.error, body.message);
  return parsed;
}

function validNames(artist: string, title: string): string | null {
  if (!cleanQuery(artist)) return 'artist is required';
  if (!cleanQuery(title)) return 'track is required';
  return null;
}

/** `track.getTopTags` — the crowd vocabulary that grounds the fingerprint. */
export async function getTopTags(artist: string, title: string): Promise<SourceResult<LastfmTag[]>> {
  const invalid = validNames(artist, title);
  if (invalid) return fail('invalid_request', invalid);

  const res = await call(
    'track.getTopTags',
    { artist: cleanQuery(artist), track: cleanQuery(title) },
    TopTagsSchema,
    TTL.lastfm,
  );
  if (!res.ok) return res;

  const tags = toArray(res.value.toptags?.tag)
    .map((t) => ({ name: str(t.name) ?? '', count: num(t.count) ?? 0, url: str(t.url) }))
    .filter((t) => t.name.length > 0)
    .sort((a, b) => b.count - a.count);
  return ok(tags, { fromCache: res.fromCache, fetchedAt: res.fetchedAt });
}

/** `track.getSimilar` — Channel A's first half. */
export async function getSimilar(
  artist: string,
  title: string,
  { limit = 50 }: { limit?: number } = {},
): Promise<SourceResult<LastfmSimilar[]>> {
  const invalid = validNames(artist, title);
  if (invalid) return fail('invalid_request', invalid);

  const res = await call(
    'track.getSimilar',
    { artist: cleanQuery(artist), track: cleanQuery(title), limit },
    SimilarSchema,
    TTL.lastfm,
  );
  if (!res.ok) return res;

  const tracks = toArray(res.value.similartracks?.track)
    .map((t) => ({
      artist: artistName(t.artist),
      title: str(t.name) ?? '',
      match: num(t.match) ?? 0,
      mbid: str(t.mbid),
      url: str(t.url),
    }))
    .filter((t) => t.artist.length > 0 && t.title.length > 0);
  return ok(tracks, { fromCache: res.fromCache, fetchedAt: res.fetchedAt });
}

/** `tag.getTopTracks` — Channel A's tag pivot. */
export async function getTagTopTracks(
  tag: string,
  { limit = 50 }: { limit?: number } = {},
): Promise<SourceResult<LastfmTagTrack[]>> {
  if (!cleanQuery(tag)) return fail('invalid_request', 'tag is required');

  const res = await call('tag.getTopTracks', { tag: cleanQuery(tag), limit }, TagTopTracksSchema, TTL.lastfm);
  if (!res.ok) return res;

  const container = res.value.tracks ?? res.value.toptracks;
  const tracks = toArray(container?.track)
    .map((t) => ({
      artist: artistName(t.artist),
      title: str(t.name) ?? '',
      rank: num(t['@attr']?.rank ?? t.rank),
      mbid: str(t.mbid),
      url: str(t.url),
    }))
    .filter((t) => t.artist.length > 0 && t.title.length > 0);
  return ok(tracks, { fromCache: res.fromCache, fetchedAt: res.fetchedAt });
}

/**
 * `track.search` — Channel A's title-variant retry.
 *
 * Last.fm keeps "The Lovecats" and "The Love Cats" as two separate entries with separate
 * stats (api-reality §3.4), and `autocorrect=1` does not always bridge them. When
 * `getSimilar` comes back empty, the channel asks search for the spelling Last.fm itself
 * ranks first and retries once with that exact name.
 */
export async function searchTracks(
  title: string,
  { artist, limit = 5 }: { artist?: string; limit?: number } = {},
): Promise<SourceResult<LastfmSearchTrack[]>> {
  if (!cleanQuery(title)) return fail('invalid_request', 'track is required');

  const res = await call(
    'track.search',
    { track: cleanQuery(title), artist: artist ? cleanQuery(artist) : undefined, limit },
    SearchSchema,
    TTL.lastfm,
  );
  if (!res.ok) return res;

  const tracks = toArray(res.value.results?.trackmatches?.track)
    .map((t) => ({
      artist: artistName(t.artist),
      title: str(t.name) ?? '',
      listeners: num(t.listeners),
      mbid: str(t.mbid),
      url: str(t.url),
    }))
    .filter((t) => t.artist.length > 0 && t.title.length > 0);
  return ok(tracks, { fromCache: res.fromCache, fetchedAt: res.fetchedAt });
}

/** `track.getInfo` — canonical spelling, MBID and the catalogue URL the ToS wants linked. */
export async function getTrackInfo(
  artist: string,
  title: string,
): Promise<SourceResult<LastfmTrackInfo>> {
  const invalid = validNames(artist, title);
  if (invalid) return fail('invalid_request', invalid);

  const res = await call(
    'track.getInfo',
    { artist: cleanQuery(artist), track: cleanQuery(title) },
    TrackInfoSchema,
    TTL.lastfm,
  );
  if (!res.ok) return res;

  const t = res.value.track;
  if (!t || !t.name) return fail('not_found', `no Last.fm track for ${artist} — ${title}`);

  return ok(
    {
      artist: artistName(t.artist),
      title: t.name,
      mbid: str(t.mbid),
      url: str(t.url),
      durationMs: num(t.duration),
      listeners: num(t.listeners),
      playcount: num(t.playcount),
      album: str(t.album?.title),
      tags: toArray(t.toptags?.tag)
        .map((tag) => ({ name: str(tag.name) ?? '', count: num(tag.count) ?? 0, url: str(tag.url) }))
        .filter((tag) => tag.name.length > 0),
    },
    { fromCache: res.fromCache, fetchedAt: res.fetchedAt },
  );
}

/** The Last.fm catalogue page for a track — what the ToS requires links to point at. */
export function catalogueUrl(artist: string, title: string): string {
  const enc = (s: string) => encodeURIComponent(cleanQuery(s).replace(/ /g, '+')).replace(/%2B/g, '+');
  return `https://www.last.fm/music/${enc(artist)}/_/${enc(title)}`;
}

export function describe(): SourceDescription {
  return { name: 'lastfm', needsKey: true, configured: Boolean(env.lastfmApiKey) };
}
