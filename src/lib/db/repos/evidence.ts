/**
 * `evidence` — Channel B's raw web-search results, cached per (provider, query).
 *
 * Provider terms differ: Tavily results may be retained, Brave's may not (its ToS allows
 * transient storage only). The rule lives with the caller — `sources/websearch.ts` marks
 * Brave responses `noStore` and Channel B persists only its own extracted mentions for
 * them — but do not insert Brave rows here.
 */

import { getDb } from '@/lib/db';

export interface EvidenceInput {
  provider: string;
  query: string;
  url: string;
  title?: string | null;
  snippet?: string | null;
  content?: string | null;
  fetchedAt?: number;
}

export interface EvidenceRow {
  id: number;
  provider: string;
  query: string;
  url: string;
  title: string | null;
  snippet: string | null;
  content: string | null;
  fetchedAt: number;
}

interface Raw {
  id: number;
  provider: string;
  query: string;
  url: string;
  title: string | null;
  snippet: string | null;
  content: string | null;
  fetched_at: number;
}

const toRow = (r: Raw): EvidenceRow => ({
  id: r.id,
  provider: r.provider,
  query: r.query,
  url: r.url,
  title: r.title,
  snippet: r.snippet,
  content: r.content,
  fetchedAt: r.fetched_at,
});

/** Every stored result for one (provider, query), newest first. */
export function find(provider: string, query: string): EvidenceRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM evidence WHERE provider = ? AND query = ? ORDER BY fetched_at DESC, id DESC')
    .all(provider, query) as Raw[];
  return rows.map(toRow);
}

export function get(id: number): EvidenceRow | null {
  const row = getDb().prepare('SELECT * FROM evidence WHERE id = ?').get(id) as Raw | undefined;
  return row ? toRow(row) : null;
}

/** Returns the new row id. */
export function insert(input: EvidenceInput): number {
  const info = getDb()
    .prepare(
      `INSERT INTO evidence (provider, query, url, title, snippet, content, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.provider,
      input.query,
      input.url,
      input.title ?? null,
      input.snippet ?? null,
      input.content ?? null,
      input.fetchedAt ?? Date.now(),
    );
  return Number(info.lastInsertRowid);
}
