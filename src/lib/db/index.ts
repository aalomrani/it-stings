/**
 * The one better-sqlite3 handle.
 *
 * better-sqlite3 is synchronous; there is no pool and no await anywhere below. The handle
 * is stashed on `globalThis` so Next's dev hot reload re-uses it instead of opening a new
 * connection (and re-running migrations) on every edit.
 *
 * Location: `data/itstings.sqlite`, overridable with `ITSTINGS_DB_PATH` (tests use
 * `:memory:`). `data/` is created on first open.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const DEFAULT_DB_PATH = path.join('data', 'itstings.sqlite');

interface DbGlobal {
  db: Db | null;
  path: string | null;
}

const globalRef = globalThis as typeof globalThis & { __itstingsDb?: DbGlobal };
const state: DbGlobal = (globalRef.__itstingsDb ??= { db: null, path: null });

/** The path we would open right now (respects `ITSTINGS_DB_PATH`). Not resolved. */
export function configuredDbPath(): string {
  const fromEnv = process.env.ITSTINGS_DB_PATH?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_DB_PATH;
}

/** The path of the OPEN database, or the configured one if nothing is open yet. */
export function getDbPath(): string {
  return state.path ?? configuredDbPath();
}

/**
 * Where the migration `.sql` files live. Resolved from `process.cwd()` rather than from
 * this module's own path: under `next dev` / `next build` the module is bundled, and a
 * path derived from `import.meta.url` makes Turbopack trace the entire project into the
 * server output. The app is always run from the project root (`npm run dev`, `npm start`,
 * `npx tsx scripts/...`, `vitest`), so cwd is the reliable anchor.
 *
 * The `turbopackIgnore` comments below opt these reads out of static tracing; they are
 * plain runtime file reads of a directory we control.
 */
function migrationsDir(): string {
  const dir = path.join(process.cwd(), 'src', 'lib', 'db', 'migrations');
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    throw new Error(
      `Cannot find migrations at ${dir}. Run It Stings from the project root.`,
    );
  }
  return dir;
}

/**
 * Applies every `migrations/*.sql` not yet recorded in `schema_migrations`, in filename
 * order, each inside a transaction. Idempotent: running it twice applies nothing the
 * second time.
 */
export function runMigrations(db: Db): { applied: string[]; skipped: string[] } {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const dir = migrationsDir();
  const files = fs
    .readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const alreadyApplied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => (r as { name: string }).name),
  );
  const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (alreadyApplied.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(file, Date.now());
    })();
    applied.push(file);
  }
  return { applied, skipped };
}

function open(): Db {
  const dbPath = configuredDbPath();
  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  // WAL is meaningless for :memory: and better-sqlite3 warns rather than fails, so skip it.
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);

  state.db = db;
  state.path = dbPath;
  return db;
}

/** Lazy singleton. First call opens the file, sets pragmas and runs migrations. */
export function getDb(): Db {
  if (state.db && state.db.open && state.path === configuredDbPath()) return state.db;
  if (state.db && state.db.open) state.db.close();
  return open();
}

/** Closes the handle (tests, `db:reset`). The next `getDb()` re-opens and re-migrates. */
export function closeDb(): void {
  if (state.db?.open) state.db.close();
  state.db = null;
  state.path = null;
}
