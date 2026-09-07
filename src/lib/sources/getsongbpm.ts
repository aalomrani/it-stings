/**
 * GetSongBPM — the tempo fallback between Deezer's `bpm: 0` and AcousticBrainz.
 *
 * Reality that shapes this file (docs/api-reality.md §3.7):
 *  - the live host is `https://api.getsong.co/`. The documented `api.getsongbpm.com`
 *    now serves a Cloudflare challenge; it is never called.
 *  - unauthenticated requests are "not allowed" (401 every time), so with no key we
 *    return `no_api_key` without a request.
 *  - the key travels in the `X-API-KEY` header, not the query string, so it never lands
 *    in a URL, a log line or the cache.
 *  - bodies are JSON under a `text/html` content type — parse the text, not the header.
 *  - `tempo` and `time_sig` arrive as STRINGS ("220", "4/4"); `tempo` of 0 or NaN is
 *    unknown, never a BPM.
 *  - USING THE KEY OBLIGES US TO SHOW THE BACKLINK. `ATTRIBUTION` is what the footer
 *    renders whenever the key is configured.
 */

import { z } from 'zod';

import { env } from '@/lib/env';
import { fetchExternal } from '@/lib/http/fetchExternal';
import { artistOverlap, sameTitle } from '@/lib/util/normalize';
import {
  TTL,
  buildUrl,
  cleanQuery,
  fail,
  failureFromHttp,
  numberOrNull,
  ok,
  parseBody,
  type SourceDescription,
  type SourceResult,
} from '@/lib/sources/common';

const BASE = 'https://api.getsong.co';

/** Mandatory while a key is configured — "we will suspend your account without notice". */
export const ATTRIBUTION = {
  text: 'Tempo data by GetSongBPM',
  href: 'https://getsongbpm.com',
} as const;

export interface GetSongBpmResult {
  bpm: number | null;
  key: string | null;
  timeSig: string | null;
  /** The song's page on getsongbpm.com — a contextual backlink for the card. */
  url: string | null;
  title: string;
  artist: string;
}

const SongSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    uri: z.string().optional(),
    tempo: z.unknown().optional(),
    time_sig: z.unknown().optional(),
    key_of: z.unknown().optional(),
    open_key: z.unknown().optional(),
    artist: z
      .object({ id: z.string().optional(), name: z.string().optional(), uri: z.string().optional() })
      .loose()
      .optional(),
  })
  .loose();

const SearchSchema = z
  .object({
    // `search` is an array on a hit; the API answers with a string/object when it has
    // nothing, so accept anything and check for an array ourselves.
    search: z.unknown().optional(),
    error: z.string().optional(),
  })
  .loose();

export function configured(): boolean {
  return Boolean(env.getsongbpmApiKey);
}

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;

/**
 * `GET /search/?type=both&lookup=song:<title> artist:<artist>`.
 * The docs' own example keeps a literal space between the two `key:value` parts.
 */
export async function lookup(
  artist: string,
  title: string,
  { limit = 5 }: { limit?: number } = {},
): Promise<SourceResult<GetSongBpmResult>> {
  const key = env.getsongbpmApiKey;
  if (!key) return fail('no_api_key', 'GETSONGBPM_API_KEY is not set');

  const a = cleanQuery(artist);
  const t = cleanQuery(title);
  if (!a || !t) return fail('invalid_request', 'artist and title required');

  const url = buildUrl(`${BASE}/search/`, {
    limit,
    lookup: `song:${t} artist:${a}`,
    type: 'both',
  });

  const res = await fetchExternal({
    url,
    headers: { 'X-API-KEY': key },
    ttlMs: TTL.getsongbpm,
    retries: 1,
  });
  if (!res.ok) return failureFromHttp(res, { 401: 'invalid_api_key' });

  const parsed = parseBody(res, SearchSchema);
  if (!parsed.ok) return parsed;
  if (parsed.value.error) return fail('upstream_error', parsed.value.error);

  const raw = parsed.value.search;
  if (!Array.isArray(raw)) return fail('not_found', `no GetSongBPM song for ${artist} — ${title}`);

  const songs = raw
    .map((entry) => SongSchema.safeParse(entry))
    .filter((p) => p.success)
    .map((p) => p.data);

  const match = songs.find(
    (s) => s.title && sameTitle(s.title, t) && artistOverlap(s.artist?.name ?? '', a),
  );
  if (!match) return fail('not_found', `no GetSongBPM match for ${artist} — ${title}`);

  return ok(
    {
      // `tempo` is a string in the docs' own example; 0 and NaN both mean unknown.
      bpm: numberOrNull(match.tempo),
      key: asString(match.key_of),
      timeSig: asString(match.time_sig),
      url: asString(match.uri),
      title: match.title ?? title,
      artist: match.artist?.name ?? artist,
    },
    { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt },
  );
}

export function describe(): SourceDescription {
  return { name: 'getsongbpm', needsKey: true, configured: configured() };
}
