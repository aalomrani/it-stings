/**
 * Deezer public API — the ISRC source, the BPM source, and the preview source.
 *
 * Reality that shapes this file (docs/api-reality.md §3.2):
 *  - EVERY error is HTTP 200 with `{"error":{"type","message","code"}}`. Nothing here may
 *    branch on the HTTP status; `isRetryableBody` is what makes the throttle (code 4)
 *    retryable at the transport layer.
 *  - `bpm` is per Deezer track id, not per recording, and `0` means unknown.
 *  - `preview` is an HMAC-signed URL that dies 900 s after the response was minted, so a
 *    `/track/{id}` body fetched for preview minting is cached for 13 minutes and under a
 *    DIFFERENT cache key than the same body fetched for metadata (30 days). Sharing one
 *    key would hand a 30-day-old signature to the player.
 *  - search ordering is popularity-blended, so compilations, remasters and DJ edits
 *    routinely outrank the original — `pickBestMatch` is what fixes that.
 */

import { z } from 'zod';

import { fetchExternal } from '@/lib/http/fetchExternal';
import { artistOverlap, normTitle, sameTitle } from '@/lib/util/normalize';
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

const BASE = 'https://api.deezer.com';

export interface DeezerHit {
  id: number;
  title: string;
  titleShort: string;
  titleVersion: string;
  artist: { id: number | null; name: string };
  album: { id: number | null; title: string | null; cover: string | null; coverXl: string | null };
  isrc: string | null;
  /** Seconds, as Deezer reports it. */
  duration: number | null;
  rank: number;
  preview: string | null;
  link: string | null;
}

export interface DeezerTrack extends DeezerHit {
  /** `0` from the API becomes `null`: Deezer means "unknown", not "zero beats". */
  bpm: number | null;
  releaseDate: string | null;
  /** When the body we read was fetched — the preview URL expires 900 s after that. */
  fetchedAt: number;
}

const ArtistSchema = z.object({ id: z.number().optional(), name: z.string().optional() }).loose();

const AlbumSchema = z
  .object({
    id: z.number().optional(),
    title: z.string().optional(),
    cover: z.string().optional(),
    cover_medium: z.string().optional(),
    cover_big: z.string().optional(),
    cover_xl: z.string().optional(),
    release_date: z.string().optional(),
  })
  .loose();

const TrackSchema = z
  .object({
    id: z.number().optional(),
    title: z.string().optional(),
    title_short: z.string().optional(),
    title_version: z.string().optional(),
    isrc: z.string().optional(),
    link: z.string().optional(),
    duration: z.number().optional(),
    rank: z.number().optional(),
    preview: z.string().optional(),
    bpm: z.number().optional(),
    release_date: z.string().optional(),
    artist: ArtistSchema.optional(),
    album: AlbumSchema.optional(),
  })
  .loose();

const ErrorSchema = z
  .object({
    type: z.string().optional(),
    message: z.string().optional(),
    code: z.number().optional(),
  })
  .loose();

const SearchSchema = z
  .object({
    data: z.array(TrackSchema).optional(),
    total: z.number().optional(),
    error: ErrorSchema.optional(),
  })
  .loose();

const TrackResponseSchema = TrackSchema.extend({ error: ErrorSchema.optional() });

type RawTrack = z.infer<typeof TrackSchema>;

/**
 * Deezer's throttle (`{"error":{...,"code":4}}`) arrives as HTTP 200. Handing this to
 * `fetchExternal` makes the transport retry it with backoff AND keeps it out of the
 * cache, because only a clean response is stored.
 */
export function isRetryableBody(status: number, text: string): boolean {
  if (status !== 200 || !text.includes('"code"')) return false;
  try {
    const body = JSON.parse(text) as { error?: { code?: number } };
    return body?.error?.code === 4;
  } catch {
    return false;
  }
}

/**
 * Every Deezer error is an HTTP 200, so without this the transport would store them:
 * a transient `{"error":{"code":800}}` for a track Deezer simply did not serve this
 * second would become a hard `not_found` for 30 days (api-reality §3.2 records that such
 * misses are edition-dependent, not stable). Answer it, never keep it.
 */
export function isCacheableBody(status: number, text: string): boolean {
  if (status !== 200 || !text.includes('"error"')) return true;
  try {
    const body = JSON.parse(text) as { error?: unknown };
    return body?.error === undefined || body.error === null;
  } catch {
    return true;
  }
}

/** `{"error":{"code":800}}` and friends -> a typed failure. */
function failureFromBody<T>(error: z.infer<typeof ErrorSchema>): SourceResult<T> {
  const detail = `deezer ${error.type ?? 'Exception'} ${error.code ?? '?'}: ${error.message ?? ''}`;
  switch (error.code) {
    case 800: // DataException "no data"
      return fail<T>('not_found', detail);
    case 4: // Quota limit exceeded (survived the retries)
      return fail<T>('rate_limited', detail);
    case 500:
    case 501:
    case 600:
      return fail<T>('invalid_request', detail);
    default:
      return fail<T>('upstream_error', detail);
  }
}

function toHit(raw: RawTrack): DeezerHit | null {
  if (typeof raw.id !== 'number' || !raw.title) return null;
  return {
    id: raw.id,
    title: raw.title,
    // `title_version` is absent (not empty) on some tracks — verified on 3 of 24.
    titleShort: raw.title_short ?? raw.title,
    titleVersion: raw.title_version ?? '',
    artist: { id: raw.artist?.id ?? null, name: raw.artist?.name ?? '' },
    album: {
      id: raw.album?.id ?? null,
      title: raw.album?.title ?? null,
      cover: raw.album?.cover_medium ?? raw.album?.cover ?? null,
      coverXl: raw.album?.cover_xl ?? raw.album?.cover_big ?? null,
    },
    isrc: raw.isrc ?? null,
    duration: typeof raw.duration === 'number' ? raw.duration : null,
    rank: typeof raw.rank === 'number' ? raw.rank : 0,
    preview: raw.preview && raw.preview.length > 0 ? raw.preview : null,
    link: raw.link ?? null,
  };
}

function toTrack(raw: RawTrack, fetchedAt: number): DeezerTrack | null {
  const hit = toHit(raw);
  if (!hit) return null;
  return {
    ...hit,
    bpm: numberOrNull(raw.bpm),
    releaseDate: raw.release_date ?? raw.album?.release_date ?? null,
    fetchedAt,
  };
}

async function runSearch(q: string, limit: number): Promise<SourceResult<DeezerHit[]>> {
  const url = buildUrl(`${BASE}/search`, { limit, q });
  const res = await fetchExternal({
    url,
    ttlMs: TTL.search,
    retries: 3,
    isRetryableBody,
    isCacheableBody,
  });
  if (!res.ok) return failureFromHttp(res, { 200: 'rate_limited' });

  const parsed = parseBody(res, SearchSchema);
  if (!parsed.ok) return parsed;
  if (parsed.value.error) return failureFromBody(parsed.value.error);

  const hits = (parsed.value.data ?? [])
    .map(toHit)
    .filter((h): h is DeezerHit => h !== null);
  return ok(hits, { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt });
}

const UNWANTED = /\b(live|remix|mixed|karaoke|tribute|cover|instrumental)\b/i;
const WEAKLY_UNWANTED = /\b(remaster|remastered|anniversary|re-?recorded|acoustic|demo|edit)\b/i;

const hitText = (h: DeezerHit) => `${h.title} ${h.titleVersion}`;

/**
 * Advanced syntax first (`artist:"…" track:"…"`), plain query as the fallback.
 *
 * The fallback is not only for "advanced returned nothing": the probe found advanced
 * picks a worse edition in 5 of 15 sample tracks (Booty Swing returns ONLY the Pukkelpop
 * live take). So we also fall back when everything advanced returned is a variant we
 * would penalise, and hand the union to `pickBestMatch`.
 */
export async function searchTrack(
  artist: string,
  title: string,
  { limit = 10 }: { limit?: number } = {},
): Promise<SourceResult<DeezerHit[]>> {
  const a = cleanQuery(artist);
  const t = cleanQuery(title);
  if (!a || !t) return fail('invalid_request', 'artist and title required');

  const advanced = await runSearch(`artist:"${a}" track:"${t}"`, limit);
  const advancedHits = advanced.ok ? advanced.value : [];

  const usable = advancedHits.filter(
    (h) => sameTitle(h.titleShort, t) && !UNWANTED.test(hitText(h)) && !WEAKLY_UNWANTED.test(hitText(h)),
  );
  if (advanced.ok && usable.length > 0) return advanced;

  const plain = await runSearch(`${a} ${t}`, limit);
  if (!plain.ok) return advanced.ok ? advanced : plain;

  const merged = [...advancedHits];
  const seen = new Set(merged.map((h) => h.id));
  for (const hit of plain.value) {
    if (!seen.has(hit.id)) {
      seen.add(hit.id);
      merged.push(hit);
    }
  }
  return ok(merged, { fromCache: plain.fromCache, fetchedAt: plain.fetchedAt });
}

/**
 * `GET /track/{id}`.
 *
 * `forPreview` switches BOTH the TTL (13 min, because the signed preview URL inside the
 * body dies after 15) and the cache key, so a metadata read cached for 30 days can never
 * be served to the player.
 */
export async function getTrack(
  id: number,
  { forPreview = false }: { forPreview?: boolean } = {},
): Promise<SourceResult<DeezerTrack>> {
  if (!Number.isFinite(id) || id <= 0) return fail('invalid_request', `bad Deezer id ${id}`);
  return trackAt(`${BASE}/track/${id}`, forPreview);
}

/**
 * `GET /track/isrc:{ISRC}`. Returns ONE arbitrary id among the duplicates that share the
 * ISRC — often a low-rank, region-limited edition — so the resolver prefers a search hit
 * and uses this only when an ISRC is all it has.
 */
export async function getTrackByIsrc(isrc: string): Promise<SourceResult<DeezerTrack>> {
  const clean = isrc.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length !== 12) return fail('invalid_request', `bad ISRC ${isrc}`);
  return trackAt(`${BASE}/track/isrc:${clean}`, false);
}

async function trackAt(url: string, forPreview: boolean): Promise<SourceResult<DeezerTrack>> {
  const res = await fetchExternal({
    url,
    ttlMs: forPreview ? TTL.preview : TTL.track,
    cacheKeyExtra: forPreview ? 'preview' : 'meta',
    retries: 3,
    isRetryableBody,
    isCacheableBody,
  });
  if (!res.ok) return failureFromHttp(res, { 200: 'rate_limited' });

  const parsed = parseBody(res, TrackResponseSchema);
  if (!parsed.ok) return parsed;
  if (parsed.value.error) return failureFromBody(parsed.value.error);

  const track = toTrack(parsed.value, parsed.fetchedAt);
  if (!track) return fail('bad_response', 'track body had no id');
  return ok(track, { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt });
}

/**
 * The version-picking rule from docs/architecture.md step 2, shared by the resolver and
 * the Stage-4 verifier:
 *  - the normalised title MUST match (hard filter);
 *  - the artist must overlap when any hit's does (hard filter once one exists);
 *  - a duration within ±3 s of the reference is the strongest positive signal;
 *  - live / remix / mixed / karaoke / tribute / cover / instrumental are penalised unless
 *    the query itself asked for one; remasters and anniversary re-recordings mildly so;
 *  - ties go to the higher `rank` (Deezer's popularity proxy).
 */
export function pickBestMatch(
  hits: DeezerHit[],
  query: { artist: string; title: string; durationMs?: number },
): DeezerHit | null {
  const wantsUnwanted = UNWANTED.test(query.title);
  const wantsWeak = WEAKLY_UNWANTED.test(query.title);

  const titleMatches = hits.filter(
    (h) => sameTitle(h.titleShort, query.title) || sameTitle(h.title, query.title),
  );
  const artistMatches = titleMatches.filter((h) => artistOverlap(h.artist.name, query.artist));
  const pool = artistMatches.length > 0 ? artistMatches : titleMatches;
  if (pool.length === 0) return null;

  let best: { hit: DeezerHit; score: number } | null = null;
  for (const hit of pool) {
    let score = 0;
    if (normTitle(hit.titleShort) === normTitle(query.title)) score += 6;
    if (query.durationMs && hit.duration) {
      const diff = Math.abs(hit.duration * 1000 - query.durationMs);
      score += diff <= 3000 ? 40 : Math.max(-25, -diff / 1000);
    }
    if (!wantsUnwanted && UNWANTED.test(hitText(hit))) score -= 40;
    if (!wantsWeak && WEAKLY_UNWANTED.test(hitText(hit))) score -= 6;
    if (artistMatches.length === 0) score -= 15; // no artist matched at all: weak evidence
    score += Math.min(12, hit.rank / 80_000);
    if (hit.preview) score += 1;
    if (!best || score > best.score) best = { hit, score };
  }
  return best?.hit ?? null;
}

export function describe(): SourceDescription {
  return { name: 'deezer', needsKey: false, configured: true };
}
