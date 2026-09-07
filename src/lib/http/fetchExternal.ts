/**
 * THE seam. Every third-party HTTP request in It Stings goes through this function —
 * nothing above `src/lib/sources/` calls `fetch` directly, and tests replace the
 * transport here with `setFetchImpl` instead of hitting the network.
 *
 * Order of operations: SQLite cache lookup -> per-host limiter -> fetch (no-store, abort
 * timeout, fixed User-Agent) -> retry with backoff -> store on success.
 *
 * It never throws. Every failure comes back as `{ ok: false, reason }` with a reason a
 * human can read in a log line or a `degraded[]` entry.
 */

import * as httpCache from '@/lib/db/repos/httpCache';
import { getLimiterForUrl } from '@/lib/http/rateLimit';
import { sha1 } from '@/lib/util/ids';

export interface ExternalRequest {
  url: string; method?: 'GET' | 'POST'; headers?: Record<string,string>; body?: string;
  ttlMs: number;                 // 0 = don't cache
  cacheKeyExtra?: string;        // e.g. provider name when the URL is not unique
  cacheUrl?: string;             // recorded in http_cache instead of `url` (keeps an api_key query param out of the database); the cache KEY still hashes the real url
  timeoutMs?: number;            // default 10000
  retries?: number;              // default 2, on network error / 5xx / 429 / 503 with backoff 1.2s, 2.4s, 4.8s
  okStatuses?: number[];         // default 200-299
  isRetryableBody?: (status: number, text: string) => boolean;   // e.g. Deezer code 4 in a 200
  isCacheableBody?: (status: number, text: string) => boolean;   // false = answer it, don't store it (e.g. Deezer's HTTP-200 error bodies)
  noStore?: boolean;             // set for providers whose terms forbid caching (Brave/Exa)
}

export type ExternalResult =
  | { ok: true; status: number; text: string; json<T>(): T; fromCache: boolean; fetchedAt: number }
  | { ok: false; status: number | null; reason: string; fromCache: false };

/** MusicBrainz 403s without a descriptive User-Agent; every host gets the same one. */
export const USER_AGENT = 'ItStings/0.1 (local dev)';
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRIES = 2;
/**
 * Backoff before attempt 2, 3, 4, 5, 6 — the ladder docs/architecture.md specifies for
 * MusicBrainz 503s (1.2 / 2.4 / 4.8 / 6 / 6 s). The last entry is reused for any further
 * attempt. api-reality.md addendum B4 measured 10 of 22 MusicBrainz attempts answering
 * 503, in runs of three, so a budget that stops at three retries has no margin.
 */
export const RETRY_BACKOFF_MS = [1200, 2400, 4800, 6000, 6000];

type FetchImpl = typeof fetch;

let fetchImpl: FetchImpl | null = null;

/** Tests inject a fake transport; `null` restores the platform `fetch`. */
export function setFetchImpl(fn: FetchImpl | null): void {
  fetchImpl = fn;
}

function transport(): FetchImpl {
  return fetchImpl ?? globalThis.fetch;
}

/** sha1 of method + url + body + cacheKeyExtra. */
export function cacheKeyFor(req: ExternalRequest): string {
  const method = req.method ?? 'GET';
  return sha1([method, req.url, req.body ?? '', req.cacheKeyExtra ?? ''].join('\n'));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-url';
  }
}

const QUIET = Boolean(process.env.VITEST);

function debug(line: string): void {
  if (!QUIET) console.debug(line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });
}

function success(status: number, text: string, fromCache: boolean, fetchedAt: number): ExternalResult {
  let parsed: unknown;
  let didParse = false;
  return {
    ok: true,
    status,
    text,
    fromCache,
    fetchedAt,
    json<T>(): T {
      if (!didParse) {
        parsed = JSON.parse(text);
        didParse = true;
      }
      return parsed as T;
    },
  };
}

function isOkStatus(status: number, okStatuses?: number[]): boolean {
  return okStatuses ? okStatuses.includes(status) : status >= 200 && status < 300;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status >= 500;
}

type Attempt =
  | { kind: 'response'; status: number; text: string; ms: number }
  | { kind: 'network'; reason: string; ms: number };

async function attemptOnce(req: ExternalRequest, timeoutMs: number): Promise<Attempt> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  try {
    const res = await transport()(req.url, {
      method: req.method ?? 'GET',
      headers: { 'User-Agent': USER_AGENT, ...(req.headers ?? {}) },
      body: req.body,
      // NO `cache` option, deliberately (docs/architecture.md, "Rate limits and caching"):
      // Next's patched fetch never caches in a route handler by default, and
      // `cache: 'no-store'` makes it send `cache-control: no-cache` + `pragma: no-cache`
      // UPSTREAM, which bypasses iTunes' Akamai edge cache (measured in api-reality.md's
      // Next.js addendum). SQLite is our cache; the edge cache is free speed on top.
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    return { kind: 'response', status: res.status, text, ms: Date.now() - started };
  } catch (err) {
    const ms = Date.now() - started;
    const aborted =
      (err instanceof Error && err.name === 'AbortError') || controller.signal.aborted;
    const reason = aborted
      ? `timeout after ${timeoutMs}ms`
      : `network error: ${err instanceof Error ? err.message : String(err)}`;
    return { kind: 'network', reason, ms };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchExternal(req: ExternalRequest): Promise<ExternalResult> {
  const host = hostOf(req.url);
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = req.retries ?? DEFAULT_RETRIES;
  const cacheable = req.ttlMs > 0 && !req.noStore;
  const key = cacheKeyFor(req);

  if (cacheable) {
    try {
      const hit = httpCache.get(key);
      if (hit) {
        debug(`[fetchExternal] host=${host} status=${hit.status} ms=0 fromCache=true`);
        return success(hit.status, hit.body, true, hit.fetchedAt);
      }
    } catch (err) {
      // A cache problem must never stop a request going out.
      debug(`[fetchExternal] host=${host} cache-read-failed: ${String(err)}`);
    }
  }

  const limiter = getLimiterForUrl(req.url);
  const attempts = retries + 1;
  let lastStatus: number | null = null;
  let lastReason = 'no attempt was made';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      await sleep(RETRY_BACKOFF_MS[Math.min(attempt - 2, RETRY_BACKOFF_MS.length - 1)]);
    }

    const outcome = await limiter.schedule(() => attemptOnce(req, timeoutMs));

    if (outcome.kind === 'network') {
      debug(
        `[fetchExternal] host=${host} status=- ms=${outcome.ms} fromCache=false ` +
          `attempt=${attempt}/${attempts} ${outcome.reason}`,
      );
      lastStatus = null;
      lastReason = outcome.reason;
      continue;
    }

    const { status, text, ms } = outcome;
    debug(
      `[fetchExternal] host=${host} status=${status} ms=${ms} fromCache=false ` +
        `attempt=${attempt}/${attempts}`,
    );
    lastStatus = status;

    const bodySaysRetry = req.isRetryableBody?.(status, text) ?? false;

    if (isOkStatus(status, req.okStatuses) && !bodySaysRetry) {
      const fetchedAt = Date.now();
      // A source that answers its errors with HTTP 200 (Deezer, Last.fm) gets a say in
      // what is worth storing: a transient `{"error":{"code":800}}` must not become a
      // 30-day negative cache entry for a track that simply was not served this second.
      const storeIt = cacheable && (req.isCacheableBody?.(status, text) ?? true);
      if (storeIt) {
        try {
          httpCache.set({
            cacheKey: key,
            url: req.cacheUrl ?? req.url,
            status,
            body: text,
            fetchedAt,
            expiresAt: fetchedAt + req.ttlMs,
          });
        } catch (err) {
          debug(`[fetchExternal] host=${host} cache-write-failed: ${String(err)}`);
        }
      }
      return success(status, text, false, fetchedAt);
    }

    if (bodySaysRetry) {
      lastReason = `retryable error body from ${host} (HTTP ${status})`;
      continue;
    }
    if (isRetryableStatus(status)) {
      lastReason = `HTTP ${status} from ${host}`;
      continue;
    }
    // Anything else is a real answer we simply do not want. Do not retry it.
    return { ok: false, status, reason: `HTTP ${status} from ${host}`, fromCache: false };
  }

  return {
    ok: false,
    status: lastStatus,
    reason: `${lastReason} (gave up after ${attempts} attempt${attempts === 1 ? '' : 's'})`,
    fromCache: false,
  };
}
