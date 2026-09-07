/**
 * `http_cache` — the response cache behind `http/fetchExternal.ts`. Keys are sha1 of
 * method + url + body + cacheKeyExtra; nothing else in the app reads this table.
 */

import { getDb } from '@/lib/db';

export interface CacheEntry {
  cacheKey: string;
  url: string;
  status: number;
  body: string;
  fetchedAt: number;
  expiresAt: number;
}

interface Row {
  cache_key: string;
  url: string;
  status: number;
  body: string;
  fetched_at: number;
  expires_at: number;
}

const toEntry = (r: Row): CacheEntry => ({
  cacheKey: r.cache_key,
  url: r.url,
  status: r.status,
  body: r.body,
  fetchedAt: r.fetched_at,
  expiresAt: r.expires_at,
});

/** Returns the entry only while it is fresh; an expired row reads as a miss. */
export function get(cacheKey: string, now: number = Date.now()): CacheEntry | null {
  const row = getDb()
    .prepare('SELECT * FROM http_cache WHERE cache_key = ?')
    .get(cacheKey) as Row | undefined;
  if (!row) return null;
  if (row.expires_at <= now) return null;
  return toEntry(row);
}

export function set(entry: CacheEntry): void {
  getDb()
    .prepare(
      `INSERT INTO http_cache (cache_key, url, status, body, fetched_at, expires_at)
       VALUES (@cache_key, @url, @status, @body, @fetched_at, @expires_at)
       ON CONFLICT(cache_key) DO UPDATE SET
         url = excluded.url, status = excluded.status, body = excluded.body,
         fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    )
    .run({
      cache_key: entry.cacheKey,
      url: entry.url,
      status: entry.status,
      body: entry.body,
      fetched_at: entry.fetchedAt,
      expires_at: entry.expiresAt,
    });
}

/** Deletes every entry whose TTL has run out. Returns how many rows went. */
export function purgeExpired(now: number = Date.now()): number {
  return getDb().prepare('DELETE FROM http_cache WHERE expires_at <= ?').run(now).changes;
}

export function count(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM http_cache').get() as { n: number }).n;
}
