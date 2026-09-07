/**
 * `profiles` — one anonymous, per-browser training profile (migration
 * `006_profiles_feedback.sql`).
 *
 * A profile is identified by the `itstings_profile` cookie uuid (provisioned in
 * `src/proxy.ts`). The row is created LAZILY — the first time a browser posts feedback or
 * sets a name — so a visitor who never trains anything never gets a row. `weights_json`
 * holds the learned `WeightsMap` (see `src/lib/engine/train.ts`); it is NULL until the
 * first feedback, and while NULL the recommend route ranks with `DEFAULT_DIMENSION_WEIGHTS`.
 *
 * Everything here is scoped by `id`: this file never lists across profiles, because one
 * browser's training must never surface in another's ranking.
 */

import { getDb } from '@/lib/db';
import type { WeightsMap } from '@/lib/engine/rank';

export interface Profile {
  id: string;
  displayName: string | null;
  /** The learned weights, or `null` until this profile's first feedback. */
  weights: WeightsMap | null;
  feedbackCount: number;
  createdAt: number;
  updatedAt: number;
}

interface Raw {
  id: string;
  display_name: string | null;
  weights_json: string | null;
  feedback_count: number;
  created_at: number;
  updated_at: number;
}

/**
 * Parse the stored `weights_json`. A row whose JSON no longer parses (schema drift, a bad
 * hand-edit) is treated as "no learned weights yet" rather than a crash — the profile just
 * falls back to the default weights until its next vote overwrites the column.
 */
function parseWeights(json: string | null): WeightsMap | null {
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as WeightsMap;
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

const toProfile = (r: Raw): Profile => ({
  id: r.id,
  displayName: r.display_name,
  weights: parseWeights(r.weights_json),
  feedbackCount: r.feedback_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** The profile, or `null` when this browser has never trained anything. */
export function get(id: string): Profile | null {
  const row = getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Raw | undefined;
  return row ? toProfile(row) : null;
}

/**
 * Ensure a row exists for `id` and return it. Idempotent: an existing profile is returned
 * untouched (its name, weights and count are preserved), a missing one is created with
 * NULL weights and a zero count. This is the lazy-creation point — call it once at the top
 * of a write that is about to record feedback or a name.
 */
export function upsert(id: string, now: number = Date.now()): Profile {
  getDb()
    .prepare(
      `INSERT INTO profiles (id, display_name, weights_json, feedback_count, created_at, updated_at)
            VALUES (?, NULL, NULL, 0, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(id, now, now);
  const profile = get(id);
  if (!profile) throw new Error('profiles.upsert: row vanished immediately after writing it');
  return profile;
}

/**
 * Persist a freshly learned `WeightsMap` and the count it was learned from. Creates the row
 * if it does not exist yet, so the feedback route can call this without a separate `upsert`.
 */
export function setWeights(
  id: string,
  weights: WeightsMap,
  feedbackCount: number,
  now: number = Date.now(),
): Profile {
  getDb()
    .prepare(
      `INSERT INTO profiles (id, display_name, weights_json, feedback_count, created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
            weights_json   = excluded.weights_json,
            feedback_count = excluded.feedback_count,
            updated_at     = excluded.updated_at`,
    )
    .run(id, JSON.stringify(weights), feedbackCount, now, now);
  const profile = get(id);
  if (!profile) throw new Error('profiles.setWeights: row vanished immediately after writing it');
  return profile;
}

/** Set (or clear, with `null`) the display name. Creates the row if it does not exist. */
export function setName(id: string, displayName: string | null, now: number = Date.now()): Profile {
  getDb()
    .prepare(
      `INSERT INTO profiles (id, display_name, weights_json, feedback_count, created_at, updated_at)
            VALUES (?, ?, NULL, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
            display_name = excluded.display_name,
            updated_at   = excluded.updated_at`,
    )
    .run(id, displayName, now, now);
  const profile = get(id);
  if (!profile) throw new Error('profiles.setName: row vanished immediately after writing it');
  return profile;
}

export function count(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n;
}
