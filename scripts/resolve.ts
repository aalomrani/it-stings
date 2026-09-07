/**
 * Resolve one track from the command line and print the whole TrackRecord.
 *
 *     npx tsx scripts/resolve.ts "The Cure" "The Lovecats"
 *     npx tsx scripts/resolve.ts "Olivia Rodrigo" "vampire" --force
 *     npx tsx scripts/resolve.ts "Louis Prima" "Jump, Jive an' Wail" --json
 *
 * Real network, no keys required. Everything it fetches lands in `data/itstings.sqlite`,
 * so the second run of the same track is near-instant.
 */

import { createRequire } from 'node:module';

/**
 * `src/lib/env.ts` imports `server-only`, whose default export throws outside a React
 * Server Component. Under `tsx` there is no `react-server` condition, so we pre-seed the
 * CJS cache with an empty module. (The alternative — `tsx --conditions=react-server` —
 * would make the documented one-liner above wrong.)
 */
const req = createRequire(import.meta.url);
const CJSModule = req('node:module') as unknown as { _cache: Record<string, unknown> };
const serverOnly = req.resolve('server-only');
CJSModule._cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {}, paths: [] };

/**
 * The per-host limiter's wait timer is `unref`'d (`src/lib/http/rateLimit.ts`), as is
 * `fetchExternal`'s retry sleep — correct for the server, where a pending timer must never
 * hold the process open, and fatal for a CLI. Without a ref'd timer of our own, Node's
 * event loop empties the moment a request has to WAIT (MusicBrainz is a serial 1.1 s/req
 * queue, and a 503 backs off for seconds), so the process exits 0 mid-resolve and prints
 * nothing. One ref'd interval for the duration of the run is the whole fix.
 */
function keepProcessAlive(): () => void {
  const handle = setInterval(() => {}, 1_000_000);
  return () => clearInterval(handle);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [artist, title] = args.filter((a) => !a.startsWith('--'));

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(14)} ${value === null || value === undefined ? '—' : String(value)}`);
}

async function main(): Promise<void> {
  if (!artist || !title) {
    console.error('usage: npx tsx scripts/resolve.ts "<artist>" "<title>" [--force] [--json]');
    process.exit(1);
  }

  const { resolveTrack } = await import('@/lib/resolve/resolveTrack');
  const started = Date.now();
  const res = await resolveTrack({ artist, title }, { force: flags.has('--force') });
  const ms = Date.now() - started;

  if (!res.ok) {
    console.error(`\n✗ ${artist} — ${title}: ${res.reason}${res.detail ? ` (${res.detail})` : ''}`);
    process.exit(2);
  }

  const t = res.track;
  if (flags.has('--json')) {
    console.log(JSON.stringify(t, null, 2));
    return;
  }

  const src = (s?: { source: string; id?: string; field?: string }) =>
    s ? `  [${s.source}${s.field ? ` ${s.field}` : ''}]` : '';

  console.log(`\n${t.artist} — ${t.title}${t.album ? `  (${t.album})` : ''}`);
  console.log(`resolved in ${ms}ms${res.cached ? ' from the cache' : ''}\n`);
  line('key', t.key);
  line('isrc', t.isrc);
  line('year', t.year ? `${t.year.value}${src(t.year.source)}` : null);
  line('duration', t.durationMs ? `${(t.durationMs.value / 1000).toFixed(1)}s${src(t.durationMs.source)}` : null);
  line('tempo', t.tempoBpm ? `${t.tempoBpm.value} bpm${src(t.tempoBpm.source)}` : 'unknown');
  line('key sig', t.keySignature ? `${t.keySignature.value}${src(t.keySignature.source)}` : 'unknown');
  line('ids', JSON.stringify(t.ids));
  line('artwork', t.artwork ? `${t.artwork.large}${src(t.artwork.source)}` : null);
  line(
    'preview',
    t.preview
      ? `${t.preview.url.slice(0, 78)}…\n                 [${t.preview.source.source}] expires ${
          t.preview.expiresAt ? new Date(t.preview.expiresAt).toISOString() : 'never'
        }`
      : 'none',
  );

  if (t.features) {
    const f = t.features;
    line(
      'features',
      `danceability ${fmt(f.danceability)}  happy ${fmt(f.moodHappy)}  sad ${fmt(f.moodSad)}  ` +
        `aggressive ${fmt(f.moodAggressive)}  relaxed ${fmt(f.moodRelaxed)}${src(f.source)}`,
    );
    line('genres', (f.genreLabels ?? []).join(', ') || '—');
  } else {
    line('features', 'none (AcousticBrainz has nothing for this recording)');
  }

  line(
    'tags',
    t.tags
      ? `${t.tags.value.slice(0, 10).map((x) => `${x.name}(${x.count})`).join(', ')}${src(t.tags.source)}`
      : 'none',
  );

  console.log('\n  links');
  for (const [name, url] of Object.entries(t.links)) console.log(`    ${name.padEnd(12)} ${url}`);

  if (t.degraded.length > 0) {
    console.log('\n  degraded');
    for (const d of t.degraded) console.log(`    - ${d}`);
  }
  console.log();
}

const fmt = (n: number | undefined): string => (typeof n === 'number' ? n.toFixed(2) : '—');

const release = keepProcessAlive();
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(release);
