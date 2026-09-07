/**
 * `fingerprints` — Stage 2 output, cached per (track key, model, prompt version) so a
 * prompt edit invalidates the cache instead of silently reusing an old interpretation.
 */

import { getDb } from '@/lib/db';
import { FingerprintSchema, type Fingerprint } from '@/lib/types';

export interface FingerprintKey {
  trackKey: string;
  model: string;
  promptVersion: string;
}

export function get(key: FingerprintKey): Fingerprint | null {
  const row = getDb()
    .prepare(
      'SELECT json FROM fingerprints WHERE track_key = ? AND model = ? AND prompt_version = ?',
    )
    .get(key.trackKey, key.model, key.promptVersion) as { json: string } | undefined;
  if (!row) return null;
  const parsed = FingerprintSchema.safeParse(JSON.parse(row.json));
  return parsed.success ? parsed.data : null;
}

export function set(key: FingerprintKey, fingerprint: Fingerprint): void {
  getDb()
    .prepare(
      `INSERT INTO fingerprints (track_key, model, prompt_version, json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(track_key, model, prompt_version) DO UPDATE SET
         json = excluded.json, created_at = excluded.created_at`,
    )
    .run(key.trackKey, key.model, key.promptVersion, JSON.stringify(fingerprint), Date.now());
}
