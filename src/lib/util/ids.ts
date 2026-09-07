/**
 * Id and hash helpers. No I/O, no state — safe to import anywhere on the server.
 */

import { createHash, randomUUID } from 'node:crypto';

/** Playlist ids are `pl_<uuid>` so a stray id is recognisable in a log line. */
export function newPlaylistId(): string {
  return `pl_${randomUUID()}`;
}

/** Run ids are `run_<uuid>`. */
export function newRunId(): string {
  return `run_${randomUUID()}`;
}

/** sha1 hex digest — used for the http_cache key and for options hashes. */
export function sha1(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex');
}

/**
 * Order-insensitive hash of a plain JSON value. Object keys are sorted so
 * `{a:1,b:2}` and `{b:2,a:1}` hash identically — the run cache depends on that.
 */
export function stableHash(value: unknown): string {
  return sha1(stableStringify(value));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
