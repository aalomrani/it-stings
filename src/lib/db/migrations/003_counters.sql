-- 003 — run counters for the deployed instance's cost caps (docs/tasks/phase7-ship.md §5).
--
-- One row per (scope, bucket). Two scopes are in use:
--   scope 'day'      bucket 'YYYY-MM-DD'            — runs per UTC day, whole instance
--   scope 'ip-hour'  bucket '<ip>@YYYY-MM-DDTHH'    — runs per hour per client IP
-- The bucket strings are built by `src/lib/gate.ts` (dayBucket / ipHourBucket) and the
-- table is only ever touched through `src/lib/db/repos/counters.ts`.
--
-- Counters live in SQLite rather than in memory so a Fly machine that auto-stopped
-- overnight, or a redeploy, cannot hand out a fresh budget: the data file is the volume.
-- Only real pipeline runs are counted; a cached replay costs nothing and increments
-- nothing.

CREATE TABLE run_counters (
  scope      TEXT NOT NULL,              -- 'day' | 'ip-hour'
  bucket     TEXT NOT NULL,              -- see above; opaque to SQL
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,           -- epoch ms of the last increment
  PRIMARY KEY (scope, bucket)
);

-- Old buckets are dead weight; the index is what makes the purge a range scan.
CREATE INDEX run_counters_updated ON run_counters(updated_at);
