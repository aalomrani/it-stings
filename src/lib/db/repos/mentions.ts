/**
 * `mentions` — the artist/title pairs the model extracted from Channel B evidence.
 * These are OUR derived data, so they are always cacheable regardless of which search
 * provider produced the underlying page text.
 *
 * A mention carries its own source (migration `004_mention_source.sql`): `url` is the page
 * it was read from and is always written, `pageTitle` is the page's title and is written
 * only where the provider's terms allow its text to be retained. `evidenceId` is optional
 * — a provider whose results may not be cached (Brave) writes no `evidence` row at all,
 * and the mention is still fully attributable through its URL.
 */

import { getDb } from '@/lib/db';

export interface MentionInput {
  /** The cached search result this was read from, when the provider allows one. */
  evidenceId?: number | null;
  seedKey: string;
  artist: string;
  title: string;
  /** The page URL. Always set for new rows; null only on pre-004 rows with no evidence. */
  url?: string | null;
  /** The page title — only where the provider's terms allow storing its text. */
  pageTitle?: string | null;
  sentence?: string | null;
  enthusiasm?: 'high' | 'medium' | 'low' | null;
  model: string;
  createdAt?: number;
}

export interface MentionRow {
  id: number;
  evidenceId: number | null;
  seedKey: string;
  artist: string;
  title: string;
  url: string | null;
  pageTitle: string | null;
  sentence: string | null;
  enthusiasm: 'high' | 'medium' | 'low' | null;
  model: string;
  createdAt: number;
}

interface Raw {
  id: number;
  evidence_id: number | null;
  seed_key: string;
  artist: string;
  title: string;
  url: string | null;
  page_title: string | null;
  sentence: string | null;
  enthusiasm: string | null;
  model: string;
  created_at: number;
}

const ENTHUSIASM = new Set(['high', 'medium', 'low']);

const toRow = (r: Raw): MentionRow => ({
  id: r.id,
  evidenceId: r.evidence_id,
  seedKey: r.seed_key,
  artist: r.artist,
  title: r.title,
  url: r.url,
  pageTitle: r.page_title,
  sentence: r.sentence,
  enthusiasm:
    r.enthusiasm && ENTHUSIASM.has(r.enthusiasm)
      ? (r.enthusiasm as 'high' | 'medium' | 'low')
      : null,
  model: r.model,
  createdAt: r.created_at,
});

export function findBySeed(seedKey: string): MentionRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM mentions WHERE seed_key = ? ORDER BY id ASC')
    .all(seedKey) as Raw[];
  return rows.map(toRow);
}

/** One transaction for the whole batch. Returns how many rows were written. */
export function insertMany(inputs: MentionInput[]): number {
  if (inputs.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO mentions
       (evidence_id, seed_key, artist, title, url, page_title, sentence, enthusiasm, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAll = db.transaction((rows: MentionInput[]) => {
    for (const m of rows) {
      stmt.run(
        m.evidenceId ?? null,
        m.seedKey,
        m.artist,
        m.title,
        m.url ?? null,
        m.pageTitle ?? null,
        m.sentence ?? null,
        m.enthusiasm ?? null,
        m.model,
        m.createdAt ?? Date.now(),
      );
    }
  });
  insertAll(inputs);
  return inputs.length;
}
