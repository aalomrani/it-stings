/**
 * Shared vocabulary for every `sources/*` client.
 *
 * Three rules hold across all of them and are enforced here:
 *  1. Nothing throws. Network trouble, an upstream 500, a body that does not match the
 *     schema — all of it comes back as `{ ok: false, reason }`.
 *  2. A missing API key returns `{ ok: false, reason: 'no_api_key' }` WITHOUT a request.
 *  3. Every schema is permissive (`.loose()`, optional fields). We validate the handful of
 *     fields we read and ignore everything else, because these APIs add fields without
 *     warning and a stricter parse would turn a working response into an outage.
 */

import type { z } from 'zod';

import type { ExternalResult } from '@/lib/http/fetchExternal';
import type { SourceName } from '@/lib/types';

/** Why a source could not answer. Deliberately small and machine-readable. */
export type SourceFailure =
  | 'no_api_key' // key not configured — no request was made
  | 'invalid_api_key' // upstream rejected the key
  | 'invalid_request' // our own params were unusable (empty artist, etc.)
  | 'not_found' // upstream answered, and the answer is "nothing"
  | 'not_in_dataset' // AcousticBrainz 404: normal for post-2022 recordings
  | 'rate_limited'
  | 'upstream_error' // 5xx, timeout, network failure, retries exhausted
  | 'bad_response' // 200 whose body we could not parse
  | 'no_provider'; // web search with neither provider configured

export type SourceResult<T> =
  | { ok: true; value: T; fromCache: boolean; fetchedAt: number }
  | { ok: false; reason: SourceFailure; detail?: string };

/** What `/api/health` prints for each client. */
export interface SourceDescription {
  name: SourceName;
  needsKey: boolean;
  configured: boolean;
}

export function ok<T>(value: T, from?: { fromCache: boolean; fetchedAt: number }): SourceResult<T> {
  return {
    ok: true,
    value,
    fromCache: from?.fromCache ?? false,
    fetchedAt: from?.fetchedAt ?? Date.now(),
  };
}

export function fail<T>(reason: SourceFailure, detail?: string): SourceResult<T> {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

const DAY = 86_400_000;
const MINUTE = 60_000;

/** TTLs are fixed by docs/architecture.md ("Rate limits and caching"). */
export const TTL = {
  /** iTunes + Deezer search. */
  search: 7 * DAY,
  /** iTunes /lookup, Deezer /track/{id} when read for metadata. */
  track: 30 * DAY,
  /** Deezer /track/{id} when read to mint a preview URL (the URL dies after 15 min). */
  preview: 13 * MINUTE,
  musicbrainz: 90 * DAY,
  /** The AcousticBrainz dataset was frozen in 2022; it will never change again. */
  acousticbrainz: 90 * DAY,
  lastfm: 30 * DAY,
  websearch: 30 * DAY,
  spotify: 30 * DAY,
  getsongbpm: 90 * DAY,
} as const;

/** A trimmed, space-collapsed query string. Keeps Akamai/Deezer cache keys stable. */
export function cleanQuery(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Build a URL with its query parameters SORTED by name. iTunes' edge cache keys on the
 * exact query string (`x-true-cache-key`, api-reality §3.1), so a stable order is the
 * difference between a TCP_HIT and an origin round trip.
 */
export function buildUrl(base: string, params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return qs.length > 0 ? `${base}?${qs}` : base;
}

/** Map a `fetchExternal` failure onto a `SourceFailure`. */
export function failureFromHttp<T>(
  result: Extract<ExternalResult, { ok: false }>,
  overrides: Partial<Record<number, SourceFailure>> = {},
): SourceResult<T> {
  const status = result.status;
  if (status !== null && overrides[status]) return fail<T>(overrides[status], result.reason);
  if (status === 401 || status === 403) return fail<T>('invalid_api_key', result.reason);
  if (status === 404) return fail<T>('not_found', result.reason);
  if (status === 429) return fail<T>('rate_limited', result.reason);
  return fail<T>('upstream_error', result.reason);
}

/**
 * `JSON.parse` a successful response and run it through a permissive schema.
 *
 * The `.trim()` matters: iTunes prefixes its body with three newlines (verified), and
 * GetSongBPM answers JSON under a `text/html` content type.
 */
export function parseBody<S extends z.ZodType>(
  result: Extract<ExternalResult, { ok: true }>,
  schema: S,
): SourceResult<z.infer<S>> {
  let raw: unknown;
  try {
    raw = JSON.parse(result.text.trim());
  } catch {
    return fail('bad_response', `not JSON (${result.text.slice(0, 80)})`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return fail('bad_response', parsed.error.issues.map((i) => i.message).join('; ').slice(0, 200));
  }
  return ok(parsed.data as z.infer<S>, { fromCache: result.fromCache, fetchedAt: result.fetchedAt });
}

/** Last.fm and Deezer collapse a one-element array into a bare object. Undo that. */
export function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** `"91.9"`, `91.9`, `"0"` -> number | null. Zero and NaN both mean "unknown". */
export function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

/** The four-digit year of `"1983-10-18T12:00:00Z"` / `"1983-11-28"` / `"1983"`. */
export function yearOf(date: string | undefined | null): number | null {
  if (!date) return null;
  const m = /^(\d{4})/.exec(date.trim());
  if (!m) return null;
  const year = Number(m[1]);
  return year >= 1900 && year <= 2100 ? year : null;
}

const QUIET = Boolean(process.env.VITEST);

/** One-line progress logging that stays out of the test output. */
export function log(line: string): void {
  if (!QUIET) console.info(line);
}
