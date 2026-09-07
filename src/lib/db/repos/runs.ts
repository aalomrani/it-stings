/**
 * `runs` — a whole `RunRecord` per pipeline execution. The cache key is
 * (seed key, options hash, engine version): bump `ENGINE_VERSION` in the pipeline and
 * every stored run stops matching, which is the point.
 */

import { getDb } from '@/lib/db';
import { RunRecordSchema, type RunOptions, type RunRecord } from '@/lib/types';
import { stableHash } from '@/lib/util/ids';

/** Stable hash of `RunOptions` — key order cannot change the result. */
export function optionsHash(options: RunOptions): string {
  return stableHash(options);
}

function parse(row: { json: string } | undefined): RunRecord | null {
  if (!row) return null;
  const parsed = RunRecordSchema.safeParse(JSON.parse(row.json));
  return parsed.success ? parsed.data : null;
}

/** The most recent matching run, or null. */
export function find(seedKey: string, hash: string, engineVersion: string): RunRecord | null {
  const row = getDb()
    .prepare(
      `SELECT json FROM runs
        WHERE seed_key = ? AND options_hash = ? AND engine_version = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(seedKey, hash, engineVersion) as { json: string } | undefined;
  return parse(row);
}

/**
 * The most recent run for a seed, whatever options or engine version produced it.
 *
 * `find` answers "is THIS run cached"; this answers "what did the listener last see for
 * this track". The recommend route uses it to hand Stage 2 the fingerprint that was on
 * screen when a field was struck, so the correction prompt quotes back the reading that
 * was actually rejected rather than the uncorrected one still sitting in `fingerprints`
 * (docs/tasks/phase3-engine.md, review finding F15).
 *
 * A row whose JSON no longer parses against the current schema is skipped rather than
 * failing the lookup: an old shape is a reason to have no previous fingerprint, not a
 * reason to refuse the run.
 */
export function latestForSeed(seedKey: string): RunRecord | null {
  const rows = getDb()
    .prepare('SELECT json FROM runs WHERE seed_key = ? ORDER BY created_at DESC, id DESC LIMIT 10')
    .all(seedKey) as { json: string }[];
  for (const row of rows) {
    try {
      const record = parse(row);
      if (record) return record;
    } catch {
      // Unparseable JSON in an old row: keep looking rather than failing the run.
    }
  }
  return null;
}

export function get(id: string): RunRecord | null {
  return parse(getDb().prepare('SELECT json FROM runs WHERE id = ?').get(id) as
    | { json: string }
    | undefined);
}

export function save(run: RunRecord, hash: string = optionsHash(run.options)): void {
  getDb()
    .prepare(
      `INSERT INTO runs (id, seed_key, options_hash, engine_version, json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         seed_key = excluded.seed_key, options_hash = excluded.options_hash,
         engine_version = excluded.engine_version, json = excluded.json,
         created_at = excluded.created_at`,
    )
    .run(run.id, run.seed.key, hash, run.engineVersion, JSON.stringify(run), run.createdAt);
}

export function count(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n;
}
