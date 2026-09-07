import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, getDbPath, runMigrations } from '@/lib/db';

/** Every migration in `src/lib/db/migrations`, in the order they are applied. */
const EXPECTED_MIGRATIONS = [
  '001_init.sql',
  '003_counters.sql',
  '004_mention_source.sql',
  '005_spotify_auth.sql',
  '006_profiles_feedback.sql',
];

const EXPECTED_TABLES = [
  'evidence',
  'feedback',
  'fingerprints',
  'http_cache',
  'mentions',
  'playlist_items',
  'playlists',
  'profiles',
  'run_counters',
  'runs',
  'schema_migrations',
  'spotify_auth',
  'tracks',
  'verifications',
];

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  )
    .map((r) => r.name)
    .filter((n) => !n.startsWith('sqlite_'));
}

afterEach(() => {
  closeDb();
});

describe('runMigrations', () => {
  it('creates the whole schema on a fresh database', () => {
    const db = new Database(':memory:');
    const first = runMigrations(db);
    expect(first.applied).toEqual(EXPECTED_MIGRATIONS);
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);
    db.close();
  });

  it('is idempotent — a second run applies nothing', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const second = runMigrations(db);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(EXPECTED_MIGRATIONS);
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n,
    ).toBe(EXPECTED_MIGRATIONS.length);
    db.close();
  });

  it('records every applied migration exactly once', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db);
    runMigrations(db);
    const rows = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all();
    expect(rows).toEqual(EXPECTED_MIGRATIONS.map((name) => ({ name })));
    db.close();
  });
});

/**
 * 004 recreates `mentions` (SQLite cannot drop a NOT NULL in place). Two things have to
 * survive that: the rows already in the table, and their attribution.
 */
describe('004_mention_source', () => {
  const migration = (name: string): string =>
    fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'db', 'migrations', name), 'utf8');

  it('makes evidence_id nullable and gives the mention its own url/page_title', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const columns = (
      db.prepare('PRAGMA table_info(mentions)').all() as { name: string; notnull: number }[]
    );
    const byName = new Map(columns.map((c) => [c.name, c]));
    expect(byName.get('evidence_id')?.notnull).toBe(0);
    expect(byName.has('url')).toBe(true);
    expect(byName.has('page_title')).toBe(true);

    // A mention with no evidence row behind it — the Brave path — now inserts.
    db.prepare(
      `INSERT INTO mentions (evidence_id, seed_key, artist, title, url, model, created_at)
       VALUES (NULL, 's', 'a', 't', 'https://example.test/x', 'm', 1)`,
    ).run();
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM mentions').get() as { n: number }).n,
    ).toBe(1);
    db.close();
  });

  it('carries an existing database\'s mentions across, backfilling url from evidence', () => {
    // A database as it stood before 004: 001 applied and recorded, nothing since.
    const db = new Database(':memory:');
    db.exec(
      `CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
    );
    db.exec(migration('001_init.sql'));
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
      '001_init.sql',
      1,
    );
    db.prepare(
      `INSERT INTO evidence (provider, query, url, title, fetched_at)
       VALUES ('tavily', 'q', 'https://example.test/thread', 'a thread', 10)`,
    ).run();
    db.prepare(
      `INSERT INTO mentions (evidence_id, seed_key, artist, title, sentence, enthusiasm, model, created_at)
       VALUES (1, 'seed', 'Squirrel Nut Zippers', 'Hell', 'same trick', 'high', 'm', 20)`,
    ).run();

    const applied = runMigrations(db);
    expect(applied.applied).toEqual([
      '003_counters.sql',
      '004_mention_source.sql',
      '005_spotify_auth.sql',
      '006_profiles_feedback.sql',
    ]);

    const row = db.prepare('SELECT * FROM mentions').get() as Record<string, unknown>;
    expect(row).toMatchObject({
      evidence_id: 1,
      artist: 'Squirrel Nut Zippers',
      title: 'Hell',
      sentence: 'same trick',
      enthusiasm: 'high',
      created_at: 20,
      // Backfilled from the evidence row it already pointed at: no mention loses its
      // attribution to the migration.
      url: 'https://example.test/thread',
      page_title: 'a thread',
    });
    db.close();
  });
});

describe('getDb', () => {
  it('opens the configured in-memory database with the right pragmas and schema', () => {
    expect(getDbPath()).toBe(':memory:');
    const db = getDb();
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('returns the same handle every time (hot-reload safe)', () => {
    expect(getDb()).toBe(getDb());
  });
});
