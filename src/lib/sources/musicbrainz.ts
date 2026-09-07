/**
 * MusicBrainz WS/2 — the canonical recording id (MBID) and the only trustworthy release
 * year. The MBID is also the join key into AcousticBrainz.
 *
 * Reality that shapes this file (docs/api-reality.md §3.3):
 *  - a descriptive User-Agent is MANDATORY (403 `ua-missing` without one). It is set once
 *    in `fetchExternal`; `USER_AGENT` is re-exported here so the requirement is visible.
 *  - ~25% of compliant requests answer 503 "server is currently busy" with `retry-after: 0`,
 *    in runs of up to three. Every call passes `retries: 5`; the transport backs off
 *    1.2 / 2.4 / 4.8 / 6 / 6 s (docs/architecture.md, "External API behaviours").
 *  - the limiter for musicbrainz.org is strictly serial at ≥1100 ms, so no two MusicBrainz
 *    requests are ever in flight at once. Nothing in this file parallelises.
 *  - `inc=releases` is silently ignored on /isrc; tags and genres only arrive on a lookup,
 *    and if a future MB rejects the inc list we retry with the minimal, verified one.
 */

import { z } from 'zod';

import { USER_AGENT, fetchExternal } from '@/lib/http/fetchExternal';
import { artistOverlap, sameTitle } from '@/lib/util/normalize';
import {
  TTL,
  buildUrl,
  cleanQuery,
  fail,
  failureFromHttp,
  ok,
  parseBody,
  toArray,
  yearOf,
  type SourceDescription,
  type SourceResult,
} from '@/lib/sources/common';

const BASE = 'https://musicbrainz.org/ws/2';

export { USER_AGENT };

/**
 * `inc` lists, verified live: `genres` is NOT a valid inc parameter for the /isrc
 * resource (400 "genres is not a valid inc parameter for the isrc resource"), while
 * `tags` is. The recording lookup accepts both. Each call still falls back to the
 * minimal list if a future MusicBrainz rejects the richer one.
 */
const INC_ISRC = 'artist-credits+isrcs+tags';
const INC_MINIMAL = 'artist-credits+isrcs';
const INC_RECORDING_FULL = 'artist-credits+isrcs+tags+genres';

export interface MbTag {
  name: string;
  count: number;
}

export interface MbRecording {
  mbid: string;
  title: string;
  artist: string;
  disambiguation: string | null;
  lengthMs: number | null;
  firstReleaseDate: string | null;
  year: number | null;
  isrcs: string[];
  tags: MbTag[];
  genres: MbTag[];
  url: string;
}

const TagSchema = z.object({ name: z.string().optional(), count: z.number().optional() }).loose();

const ArtistCreditSchema = z
  .object({
    name: z.string().optional(),
    joinphrase: z.string().optional(),
    artist: z.object({ id: z.string().optional(), name: z.string().optional() }).loose().optional(),
  })
  .loose();

const RecordingSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    score: z.number().optional(),
    length: z.number().nullable().optional(),
    disambiguation: z.string().optional(),
    'first-release-date': z.string().optional(),
    'artist-credit': z.array(ArtistCreditSchema).optional(),
    isrcs: z.array(z.string()).optional(),
    tags: z.array(TagSchema).optional(),
    genres: z.array(TagSchema).optional(),
  })
  .loose();

const IsrcResponseSchema = z
  .object({ isrc: z.string().optional(), recordings: z.array(RecordingSchema).optional() })
  .loose();

const SearchResponseSchema = z
  .object({ count: z.number().optional(), recordings: z.array(RecordingSchema).optional() })
  .loose();

type RawRecording = z.infer<typeof RecordingSchema>;

/** "The Cure" from `artist-credit: [{name, joinphrase}]`, joinphrases included. */
function creditedArtist(raw: RawRecording): string {
  const credits = toArray(raw['artist-credit']);
  if (credits.length === 0) return '';
  return credits
    .map((c) => `${c.name ?? c.artist?.name ?? ''}${c.joinphrase ?? ''}`)
    .join('')
    .trim();
}

function toRecording(raw: RawRecording): MbRecording | null {
  if (!raw.id || !raw.title) return null;
  const firstReleaseDate = raw['first-release-date'] ?? null;
  const tags = toArray(raw.tags)
    .filter((t) => t.name)
    .map((t) => ({ name: t.name as string, count: t.count ?? 0 }));
  const genres = toArray(raw.genres)
    .filter((t) => t.name)
    .map((t) => ({ name: t.name as string, count: t.count ?? 0 }));
  return {
    mbid: raw.id,
    title: raw.title,
    artist: creditedArtist(raw),
    disambiguation: raw.disambiguation && raw.disambiguation.length > 0 ? raw.disambiguation : null,
    lengthMs: typeof raw.length === 'number' ? raw.length : null,
    firstReleaseDate,
    year: yearOf(firstReleaseDate),
    isrcs: toArray(raw.isrcs),
    tags,
    genres,
    url: `https://musicbrainz.org/recording/${raw.id}`,
  };
}

/**
 * docs/architecture.md: "retry 503 up to 5 times with 1.2 / 2.4 / 4.8 / 6 / 6 s backoff".
 * api-reality.md addendum B4 is the measurement behind it — 10 of 22 attempts 503'd, with
 * two runs of three consecutive 503s that only succeeded on the 4th attempt, so a budget
 * of 3 retries (4 attempts) had zero margin against the observed worst case.
 */
const MB_RETRIES = 5;

async function getJson<S extends z.ZodType>(url: string, schema: S): Promise<SourceResult<z.infer<S>>> {
  const res = await fetchExternal({ url, ttlMs: TTL.musicbrainz, retries: MB_RETRIES });
  // 400 is MusicBrainz rejecting our own query (a bad `inc` list), not an outage.
  if (!res.ok) return failureFromHttp(res, { 400: 'invalid_request' });
  return parseBody(res, schema);
}

/**
 * `GET /isrc/{isrc}` — the join that worked for 13 of 15 sample tracks.
 *
 * One ISRC can map to several recordings (album mix, radio edit, a duplicate entry). We
 * take the one closest to `lengthMs` when a duration is known, else the earliest release.
 */
export async function lookupByIsrc(
  isrc: string,
  { lengthMs }: { lengthMs?: number } = {},
): Promise<SourceResult<MbRecording>> {
  const clean = isrc.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length !== 12) return fail('invalid_request', `bad ISRC ${isrc}`);

  const url = (inc: string) => buildUrl(`${BASE}/isrc/${clean}`, { fmt: 'json', inc });

  let res = await getJson(url(INC_ISRC), IsrcResponseSchema);
  // A future MusicBrainz that rejects tags/genres on /isrc must not cost us the MBID.
  if (!res.ok && res.reason === 'invalid_request') res = await getJson(url(INC_MINIMAL), IsrcResponseSchema);
  if (!res.ok) return res;

  const recordings = toArray(res.value.recordings)
    .map(toRecording)
    .filter((r): r is MbRecording => r !== null);
  if (recordings.length === 0) return fail('not_found', `no MusicBrainz recording for ${clean}`);

  const chosen = pickRecording(recordings, { lengthMs });
  return ok(chosen, { fromCache: res.fromCache, fetchedAt: res.fetchedAt });
}

/** Closest duration wins; failing that, the earliest first-release-date. */
export function pickRecording(
  recordings: MbRecording[],
  { lengthMs }: { lengthMs?: number } = {},
): MbRecording {
  const sorted = [...recordings].sort((a, b) => {
    if (lengthMs && a.lengthMs && b.lengthMs) {
      const da = Math.abs(a.lengthMs - lengthMs);
      const db = Math.abs(b.lengthMs - lengthMs);
      if (da !== db) return da - db;
    }
    const ya = a.year ?? 9999;
    const yb = b.year ?? 9999;
    return ya - yb;
  });
  return sorted[0];
}

/**
 * Lucene recording search, used when the ISRC lookup 404s (or there is no ISRC).
 * Only a hit whose title AND artist both normalise-match is accepted — a near-miss here
 * would poison the MBID, and with it every AcousticBrainz feature downstream.
 */
export async function searchRecording(
  artist: string,
  title: string,
  { limit = 5, lengthMs }: { limit?: number; lengthMs?: number } = {},
): Promise<SourceResult<MbRecording>> {
  const a = cleanQuery(artist).replace(/["\\]/g, '');
  const t = cleanQuery(title).replace(/["\\]/g, '');
  if (!a || !t) return fail('invalid_request', 'artist and title required');

  const url = buildUrl(`${BASE}/recording`, {
    fmt: 'json',
    limit,
    query: `recording:"${t}" AND artist:"${a}"`,
  });

  const res = await getJson(url, SearchResponseSchema);
  if (!res.ok) return res;

  const matches = toArray(res.value.recordings)
    .map(toRecording)
    .filter((r): r is MbRecording => r !== null)
    .filter((r) => sameTitle(r.title, title) && artistOverlap(r.artist, artist));
  if (matches.length === 0) return fail('not_found', `no MusicBrainz match for ${artist} — ${title}`);

  return ok(pickRecording(matches, { lengthMs }), {
    fromCache: res.fromCache,
    fetchedAt: res.fetchedAt,
  });
}

/** `GET /recording/{mbid}` with tags, genres and ISRCs. */
export async function getRecording(mbid: string): Promise<SourceResult<MbRecording>> {
  if (!/^[0-9a-f-]{36}$/i.test(mbid)) return fail('invalid_request', `bad MBID ${mbid}`);

  const url = (inc: string) => buildUrl(`${BASE}/recording/${mbid}`, { fmt: 'json', inc });
  let res = await getJson(url(INC_RECORDING_FULL), RecordingSchema);
  if (!res.ok && res.reason === 'invalid_request') res = await getJson(url(INC_MINIMAL), RecordingSchema);
  if (!res.ok) return res;

  const recording = toRecording(res.value);
  if (!recording) return fail('bad_response', 'recording body had no id');
  return ok(recording, { fromCache: res.fromCache, fetchedAt: res.fetchedAt });
}

const ReleasesResponseSchema = z
  .object({
    releases: z
      .array(
        z
          .object({
            date: z.string().optional(),
            'release-group': z
              .object({ 'first-release-date': z.string().optional() })
              .loose()
              .optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

/**
 * Step 7's second year source: the earliest release-group first-release-date across the
 * releases this recording appears on. docs/architecture.md puts it between the recording's
 * own `first-release-date` and the iTunes/Deezer EDITION dates, so it only runs when the
 * recording carried no date of its own — one extra serial request, cached 90 days.
 */
export async function getEarliestReleaseYear(mbid: string): Promise<SourceResult<number>> {
  if (!/^[0-9a-f-]{36}$/i.test(mbid)) return fail('invalid_request', `bad MBID ${mbid}`);

  const url = buildUrl(`${BASE}/recording/${mbid}`, {
    fmt: 'json',
    inc: 'releases+release-groups',
  });
  const res = await getJson(url, ReleasesResponseSchema);
  if (!res.ok) return res;

  const years = toArray(res.value.releases)
    .flatMap((r) => [yearOf(r['release-group']?.['first-release-date']), yearOf(r.date)])
    .filter((y): y is number => y !== null);
  if (years.length === 0) return fail('not_found', `no release dates for recording ${mbid}`);

  return ok(Math.min(...years), { fromCache: res.fromCache, fetchedAt: res.fetchedAt });
}

export function describe(): SourceDescription {
  return { name: 'musicbrainz', needsKey: false, configured: true };
}
