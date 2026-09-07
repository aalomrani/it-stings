/**
 * `run_counters` — the durable half of the cost caps (migration `003_counters.sql`).
 *
 * The limits, the bucket keys and the human sentences are in `@/lib/gate`, which knows
 * nothing about SQLite; this file is the only thing that writes the table.
 *
 * Why SQLite and not a module-level Map: a Fly machine with `min_machines_running = 0`
 * stops when nobody is using the app, and a redeploy replaces the process. In-memory
 * counters would hand out a fresh 60 runs every time that happened.
 *
 * Part B wires `consumeRunBudget` into `GET /api/recommend`: call it once per run that is
 * actually going to execute, and NOT for a run served from the `runs` cache — a cached
 * replay makes no model calls and no external requests, so it costs nothing and counts
 * for nothing.
 */

import { getDb } from '@/lib/db';
import {
  SCOPE_DAY,
  SCOPE_IP_HOUR,
  checkRunBudget,
  dayBucket,
  ipHourBucket,
  runCaps,
  type BudgetCounts,
  type BudgetVerdict,
  type RunCaps,
} from '@/lib/gate';

type Scope = typeof SCOPE_DAY | typeof SCOPE_IP_HOUR;

/** Current value of one counter. A bucket that was never written reads as 0. */
export function current(scope: Scope, bucket: string): number {
  const row = getDb()
    .prepare('SELECT count FROM run_counters WHERE scope = ? AND bucket = ?')
    .get(scope, bucket) as { count: number } | undefined;
  return row?.count ?? 0;
}

/** Adds one to a counter and returns its new value. Creates the row on first use. */
export function increment(scope: Scope, bucket: string, now: number = Date.now()): number {
  const row = getDb()
    .prepare(
      `INSERT INTO run_counters (scope, bucket, count, updated_at)
            VALUES (?, ?, 1, ?)
       ON CONFLICT(scope, bucket) DO UPDATE SET
            count = run_counters.count + 1, updated_at = excluded.updated_at
         RETURNING count`,
    )
    .get(scope, bucket, now) as { count: number };
  return row.count;
}

/** Both counters that apply to a run right now, without changing anything. */
export function countsFor(ip: string | null, now: number = Date.now()): BudgetCounts {
  return {
    day: current(SCOPE_DAY, dayBucket(now)),
    ipHour: current(SCOPE_IP_HOUR, ipHourBucket(ip, now)),
  };
}

/** Read-only: would a run be allowed? Used by diagnostics; the route uses `consume`. */
export function peekRunBudget(
  ip: string | null,
  now: number = Date.now(),
  caps: RunCaps = runCaps(),
): BudgetVerdict {
  return checkRunBudget(countsFor(ip, now), caps);
}

/**
 * Check, then charge. Returns `{ ok: true }` and has incremented both counters, or
 * returns the refusal and has incremented nothing.
 *
 * The whole thing runs inside one better-sqlite3 transaction. better-sqlite3 is
 * synchronous, so within a process this is genuinely atomic; across processes the
 * transaction plus `busy_timeout` is what keeps two machines from both spending the last
 * run of the day.
 */
export function consumeRunBudget(
  ip: string | null,
  now: number = Date.now(),
  caps: RunCaps = runCaps(),
): BudgetVerdict {
  // Nothing is capped: skip the write entirely so the local single-user app never grows
  // a counters table full of rows nobody asked for.
  if (caps.perDay === null && caps.perIpPerHour === null) return { ok: true };

  const db = getDb();
  return db.transaction((): BudgetVerdict => {
    const verdict = checkRunBudget(countsFor(ip, now), caps);
    if (!verdict.ok) return verdict;
    if (caps.perDay !== null) increment(SCOPE_DAY, dayBucket(now), now);
    if (caps.perIpPerHour !== null) increment(SCOPE_IP_HOUR, ipHourBucket(ip, now), now);
    return { ok: true };
  })();
}

/** Drops buckets last touched before `cutoff`. Housekeeping; nothing depends on it. */
export function purgeOlderThan(cutoff: number): number {
  return getDb().prepare('DELETE FROM run_counters WHERE updated_at < ?').run(cutoff).changes;
}

export function count(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM run_counters').get() as { n: number }).n;
}
