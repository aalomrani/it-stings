/**
 * In-flight run registry — one process, one Map.
 *
 * A fresh recommendation run takes minutes (rate-limited catalogue lookups). On a host that
 * closes long-lived streams, the client's connection is cut mid-run; the run now finishes
 * server-side anyway (the route no longer aborts it on disconnect) and caches its result.
 * This registry is what makes the client's retry — and any friend hitting the same song —
 * safe: while a run for a given key is in flight, a second request is answered with a
 * `pending` event instead of starting a SECOND slow run and hammering the sources.
 *
 * Keyed by the same identity the run cache uses: `seedKey + runCacheHash(options) +
 * ENGINE_VERSION` (weights are already excluded from `runCacheHash`, so a re-rank is not a
 * new run). The key is cleared when the run settles — resolve OR reject — so a run that
 * fails never leaves a permanent `pending` lock.
 *
 * Single Render/Node instance only (free tier does not scale horizontally), so an in-process
 * Set is exactly right; a multi-instance deploy would need a shared store.
 */

const inflight = new Set<string>();

/** True while a run for this key is executing. */
export function isInflight(key: string): boolean {
  return inflight.has(key);
}

/**
 * Register a run as in-flight and clear it when the promise settles (either way). Safe to
 * call more than once for the same key; the clear is tied to the promise passed here.
 */
export function markInflight(key: string, promise: Promise<unknown>): void {
  inflight.add(key);
  void promise.then(
    () => inflight.delete(key),
    () => inflight.delete(key),
  );
}

/** Test/introspection helper: how many runs are executing right now. */
export function inflightCount(): number {
  return inflight.size;
}
