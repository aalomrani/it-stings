/**
 * iTunes Search API — typeahead and canonical metadata. No key, CORS-open, and the only
 * source that reliably has artwork and a stable (non-expiring) preview URL.
 *
 * Reality that shapes this file (docs/api-reality.md §3.1):
 *  - the body starts with three `\n` before the JSON, so parse the TRIMMED text;
 *  - there is no `isrc` field and `lookup?isrc=` returns nothing — ISRCs come from Deezer;
 *  - `trackId` is storefront-specific, so `country` travels with every id (we pin `US`);
 *  - Akamai caches per exact query string, so params are sorted and the term normalised;
 *  - `releaseDate` is the date of the album the track sits on, not the recording — it is a
 *    weak year source, cross-checked against MusicBrainz in the resolver.
 */

import { z } from 'zod';

import { fetchExternal } from '@/lib/http/fetchExternal';
import { normTitle, artistOverlap, sameTitle } from '@/lib/util/normalize';
import {
  TTL,
  buildUrl,
  cleanQuery,
  fail,
  failureFromHttp,
  ok,
  parseBody,
  yearOf,
  type SourceDescription,
  type SourceResult,
} from '@/lib/sources/common';

const BASE = 'https://itunes.apple.com';
export const DEFAULT_COUNTRY = 'US';

/** One typeahead row. Also the shape `/api/search` returns. */
export interface TypeaheadHit {
  itunesId: number;
  title: string;
  artist: string;
  album: string | null;
  artworkSmall: string | null;
  artworkLarge: string | null;
  previewUrl: string | null;
  durationMs: number | null;
  releaseYear: number | null;
  releaseDate: string | null;
  /** iTunes `primaryGenreName` — a coarse genre used as a fast keyless tag for candidates
   *  that skip the MusicBrainz/AcousticBrainz path (see resolveTrack `candidate` mode). */
  genre: string | null;
  url: string | null;
  country: string;
}

/** Permissive: we read ten of the 31 observed keys and ignore the rest. */
const ItunesTrackSchema = z
  .object({
    wrapperType: z.string().optional(),
    kind: z.string().optional(),
    trackId: z.number().optional(),
    trackName: z.string().optional(),
    artistName: z.string().optional(),
    collectionName: z.string().optional(),
    artworkUrl100: z.string().optional(),
    previewUrl: z.string().optional(),
    trackTimeMillis: z.number().optional(),
    releaseDate: z.string().optional(),
    trackViewUrl: z.string().optional(),
    primaryGenreName: z.string().optional(),
  })
  .loose();

const ItunesEnvelopeSchema = z
  .object({
    resultCount: z.number().optional(),
    results: z.array(ItunesTrackSchema).optional(),
  })
  .loose();

type ItunesTrack = z.infer<typeof ItunesTrackSchema>;

/** `.../100x100bb.jpg` -> `.../<size>x<size>bb.jpg` (verified up to 3000x3000). */
export function artworkAt(url: string | undefined, size: number): string | null {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\.(jpg|png|webp)$/i, `/${size}x${size}bb.$1`);
}

function toHit(t: ItunesTrack, country: string): TypeaheadHit | null {
  if (typeof t.trackId !== 'number' || !t.trackName || !t.artistName) return null;
  return {
    itunesId: t.trackId,
    title: t.trackName,
    artist: t.artistName,
    album: t.collectionName ?? null,
    artworkSmall: artworkAt(t.artworkUrl100, 200),
    artworkLarge: artworkAt(t.artworkUrl100, 600),
    previewUrl: t.previewUrl ?? null,
    durationMs: typeof t.trackTimeMillis === 'number' ? t.trackTimeMillis : null,
    releaseYear: yearOf(t.releaseDate),
    releaseDate: t.releaseDate ?? null,
    genre: t.primaryGenreName ?? null,
    url: t.trackViewUrl ?? null,
    country,
  };
}

/**
 * `GET /search?entity=song&...`. Returns [] (not an error) when the term finds nothing —
 * iTunes answers 200 with `resultCount: 0` for a missing term too.
 */
export async function searchSongs(
  term: string,
  { limit = 8, country = DEFAULT_COUNTRY }: { limit?: number; country?: string } = {},
): Promise<SourceResult<TypeaheadHit[]>> {
  const q = cleanQuery(term).toLowerCase();
  if (q.length === 0) return fail('invalid_request', 'empty term');

  const url = buildUrl(`${BASE}/search`, {
    country,
    entity: 'song',
    limit: Math.min(Math.max(limit, 1), 200),
    media: 'music',
    term: q,
  });

  const res = await fetchExternal({ url, ttlMs: TTL.search });
  if (!res.ok) return failureFromHttp(res);

  const parsed = parseBody(res, ItunesEnvelopeSchema);
  if (!parsed.ok) return parsed;

  const hits = (parsed.value.results ?? [])
    .map((t) => toHit(t, country))
    .filter((h): h is TypeaheadHit => h !== null);
  return ok(hits, { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt });
}

/** `GET /lookup?id=`. A storefront mismatch answers 200 with zero results -> not_found. */
export async function lookupById(
  id: number,
  country: string = DEFAULT_COUNTRY,
): Promise<SourceResult<TypeaheadHit>> {
  if (!Number.isFinite(id) || id <= 0) return fail('invalid_request', `bad iTunes id ${id}`);

  const url = buildUrl(`${BASE}/lookup`, { country, entity: 'song', id });
  const res = await fetchExternal({ url, ttlMs: TTL.track });
  if (!res.ok) return failureFromHttp(res);

  const parsed = parseBody(res, ItunesEnvelopeSchema);
  if (!parsed.ok) return parsed;

  for (const raw of parsed.value.results ?? []) {
    const hit = toHit(raw, country);
    if (hit) return ok(hit, { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt });
  }
  return fail('not_found', `iTunes id ${id} not in the ${country} storefront`);
}

/**
 * Search, then apply the same match rule the Deezer picker uses: the normalised title
 * must match and the artist must overlap. Used when we have a name but no iTunes id
 * (the resolver's fallback, and the verifier's second pass after Deezer misses).
 */
export async function findTrack(
  artist: string,
  title: string,
  { durationMs, country = DEFAULT_COUNTRY }: { durationMs?: number; country?: string } = {},
): Promise<SourceResult<TypeaheadHit>> {
  if (!artist.trim() || !title.trim()) return fail('invalid_request', 'artist and title required');

  const res = await searchSongs(`${artist} ${title}`, { limit: 10, country });
  if (!res.ok) return res;

  const best = pickBestHit(res.value, { artist, title, durationMs });
  if (!best) return fail('not_found', `no iTunes hit matching ${artist} — ${title}`);
  return ok(best, { fromCache: res.fromCache, fetchedAt: res.fetchedAt });
}

/** Penalised in a title unless the query asked for it (same list as the Deezer picker). */
const UNWANTED = /\b(live|remix|mixed|karaoke|tribute|cover|instrumental)\b/i;
const WEAKLY_UNWANTED = /\b(remaster|remastered|anniversary|re-?recorded|acoustic|demo)\b/i;

/**
 * Score iTunes hits exactly like `deezer.pickBestMatch` so the two sources cannot
 * disagree about which version of a song we mean.
 */
export function pickBestHit(
  hits: TypeaheadHit[],
  query: { artist: string; title: string; durationMs?: number },
): TypeaheadHit | null {
  const wantedUnwanted = UNWANTED.test(query.title);
  const wantedWeak = WEAKLY_UNWANTED.test(query.title);

  // Both must match: a title-only match is a different band's cover, which the Stage-4
  // verifier must never accept.
  const pool = hits.filter(
    (h) => sameTitle(h.title, query.title) && artistOverlap(h.artist, query.artist),
  );
  if (pool.length === 0) return null;

  let best: { hit: TypeaheadHit; score: number } | null = null;
  for (const hit of pool) {
    let score = 0;
    if (normTitle(hit.title) === normTitle(query.title)) score += 6;
    if (query.durationMs && hit.durationMs) {
      const diff = Math.abs(hit.durationMs - query.durationMs);
      score += diff <= 3000 ? 40 : Math.max(-25, -diff / 1000);
    }
    if (!wantedUnwanted && UNWANTED.test(hit.title)) score -= 40;
    if (!wantedWeak && WEAKLY_UNWANTED.test(hit.title)) score -= 6;
    if (hit.previewUrl) score += 2;
    if (!best || score > best.score) best = { hit, score };
  }
  return best?.hit ?? null;
}

export function describe(): SourceDescription {
  return { name: 'itunes', needsKey: false, configured: true };
}
