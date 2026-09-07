/**
 * `feedback` — one profile's "this matches" / "not a match" votes (migration
 * `006_profiles_feedback.sql`).
 *
 * A vote is a (profile, seed, candidate) triple with a label. The learner
 * (`src/lib/engine/train.ts`) turns ALL of a profile's rows into weight-tuning pairs, so
 * this repo exists to record one vote (upserting, never duplicating a contradictory one)
 * and to read a profile's whole history back.
 *
 * Everything is scoped by `profile_id`; there is deliberately no cross-profile read.
 */

import { getDb } from '@/lib/db';

export type FeedbackLabel = 'match' | 'not';
export type FeedbackSource = 'card' | 'added';

export interface FeedbackRow {
  id: number;
  profileId: string;
  seedKey: string;
  candidateKey: string;
  label: FeedbackLabel;
  source: FeedbackSource;
  createdAt: number;
}

export interface RecordInput {
  profileId: string;
  seedKey: string;
  candidateKey: string;
  label: FeedbackLabel;
  source: FeedbackSource;
}

interface Raw {
  id: number;
  profile_id: string;
  seed_key: string;
  candidate_key: string;
  label: FeedbackLabel;
  source: FeedbackSource;
  created_at: number;
}

const toRow = (r: Raw): FeedbackRow => ({
  id: r.id,
  profileId: r.profile_id,
  seedKey: r.seed_key,
  candidateKey: r.candidate_key,
  label: r.label,
  source: r.source,
  createdAt: r.created_at,
});

/**
 * Record one vote, upserting on (profile, seed, candidate): a later vote on the same pair
 * REPLACES the earlier one — its label, its source and its timestamp — so flipping a
 * 'match' to 'not' (or the reverse) leaves exactly one row, never two that disagree.
 * Returns the row as stored.
 */
export function record(input: RecordInput, now: number = Date.now()): FeedbackRow {
  getDb()
    .prepare(
      `INSERT INTO feedback (profile_id, seed_key, candidate_key, label, source, created_at)
            VALUES (@profileId, @seedKey, @candidateKey, @label, @source, @createdAt)
       ON CONFLICT(profile_id, seed_key, candidate_key) DO UPDATE SET
            label      = excluded.label,
            source     = excluded.source,
            created_at = excluded.created_at`,
    )
    .run({ ...input, createdAt: now });

  const row = getDb()
    .prepare(
      'SELECT * FROM feedback WHERE profile_id = ? AND seed_key = ? AND candidate_key = ?',
    )
    .get(input.profileId, input.seedKey, input.candidateKey) as Raw | undefined;
  if (!row) throw new Error('feedback.record: row vanished immediately after writing it');
  return toRow(row);
}

/** Every vote this profile has cast, oldest first. */
export function listForProfile(profileId: string): FeedbackRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM feedback WHERE profile_id = ? ORDER BY id ASC')
    .all(profileId) as Raw[];
  return rows.map(toRow);
}

/** How many pairs this profile has voted on. */
export function countForProfile(profileId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM feedback WHERE profile_id = ?')
    .get(profileId) as { n: number };
  return row.n;
}
