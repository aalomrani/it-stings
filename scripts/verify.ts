/**
 * Stage-4 verification from the command line: does this (artist, title) exist?
 *
 *     npx tsx scripts/verify.ts "Louis Prima" "Jump, Jive an' Wail"
 *     npx tsx scripts/verify.ts "The Cure" "The Lovecats" "Talking Heads" "Psycho Killer"
 *     npx tsx scripts/verify.ts                # the built-in 3 real + 3 invented set
 *
 * Arguments are consumed in artist/title pairs. Real network, no keys required.
 */

import { createRequire } from 'node:module';

/** See scripts/resolve.ts: `server-only` has to be stubbed out under tsx. */
const req = createRequire(import.meta.url);
const CJSModule = req('node:module') as unknown as { _cache: Record<string, unknown> };
const serverOnly = req.resolve('server-only');
CJSModule._cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {}, paths: [] };

/**
 * The per-host limiter's wait timer is `unref`'d (`src/lib/http/rateLimit.ts`), as is
 * `fetchExternal`'s retry sleep — correct for the server, fatal for a CLI. Without a ref'd
 * timer of our own Node's event loop empties the moment a request has to WAIT behind the
 * serial MusicBrainz queue or a 503 backoff, and the process exits 0 mid-verify having
 * printed nothing. One ref'd interval for the duration of the run is the whole fix.
 */
function keepProcessAlive(): () => void {
  const handle = setInterval(() => {}, 1_000_000);
  return () => clearInterval(handle);
}

/** Three tracks that exist, three that do not. The invented ones MUST miss. */
const DEFAULT_SET: [string, string][] = [
  ['The Cure', 'The Lovecats'],
  ['Louis Prima', "Jump, Jive an' Wail"],
  ['Cherry Poppin’ Daddies', 'Zoot Suit Riot'],
  ['The Cure', 'Purple Marmalade Sunrise'],
  ['Talking Heads', 'Velvet Accordion Tuesday'],
  ['Nonexistent Orchestra', 'The Ballad of the Missing Endpoint'],
];

function pairsFrom(args: string[]): [string, string][] {
  const clean = args.filter((a) => !a.startsWith('--'));
  if (clean.length === 0) return DEFAULT_SET;
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) pairs.push([clean[i], clean[i + 1]]);
  return pairs;
}

async function main(): Promise<void> {
  const pairs = pairsFrom(process.argv.slice(2));
  const { verifyMany } = await import('@/lib/resolve/verifyCandidate');
  const { trackNormKey } = await import('@/lib/util/normalize');

  const started = Date.now();
  const results = await verifyMany(
    pairs.map(([artist, title]) => ({ artist, title })),
    { concurrency: 6 },
  );
  const ms = Date.now() - started;

  console.log(`\nverified ${pairs.length} candidates in ${ms}ms\n`);
  let hits = 0;
  for (const [artist, title] of pairs) {
    const result = results.get(trackNormKey(artist, title));
    if (result?.ok) {
      hits += 1;
      const t = result.track;
      console.log(
        `  HIT   ${artist} — ${title}\n` +
          `        ${t.key}  ${t.artist} — ${t.title}` +
          `${t.year ? ` (${t.year.value})` : ''}` +
          `${t.tempoBpm ? ` ${t.tempoBpm.value} bpm` : ''}` +
          `${result.cached ? '  [cached]' : ''}`,
      );
    } else {
      console.log(`  MISS  ${artist} — ${title}   (${result?.reason ?? 'no result'})`);
    }
  }
  console.log(`\n${hits} hit, ${pairs.length - hits} missed\n`);
}

const release = keepProcessAlive();
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(release);
