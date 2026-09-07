/**
 * `withDeadline(ms, fallback, work)` — race a promise against a wall-clock deadline and
 * resolve to `fallback` if the deadline wins. It NEVER rejects: a rejection from `work`
 * also resolves to `fallback`.
 *
 * The point is a hard latency guarantee for best-effort enrichment. MusicBrainz and
 * AcousticBrainz are the engine's slow, frequently-degraded sources: a single MusicBrainz
 * call can hang for its full 10 s timeout, and the seed / Channel B make several serially,
 * so the ONLY way to bound a run is to cap the whole enrichment stage, not each call. When
 * the deadline fires the underlying work keeps running (it is not aborted) — it simply no
 * longer blocks the run, and its own per-call timeout drains it in the background.
 */
export function withDeadline<T>(ms: number, fallback: T, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (value: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    // Do not let the pending timer keep a Node process alive on its own.
    (timer as unknown as { unref?: () => void }).unref?.();
    work.then(
      (v) => done(v),
      () => done(fallback),
    );
  });
}
