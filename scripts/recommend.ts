/**
 * `npx tsx scripts/recommend.ts "The Cure" "The Lovecats"`
 * `npx tsx scripts/recommend.ts isrc:GBAAM8300010`          (skip resolution)
 *
 * Flags: `--same-artist` include the seed's own artist, `--json` dump the RunRecord.
 *
 * Resolves the seed, runs the pipeline, prints one line per `PipelineEvent` as it
 * arrives, then the final table. This is the same code path `GET /api/recommend` uses —
 * if the CLI is honest about being a placeholder, so is the stream.
 */

import { createRequire } from 'node:module';

import type { PipelineEvent, RunRecord, TrackRecord } from '@/lib/types';

/**
 * `src/lib/env.ts` imports `server-only`, whose default export throws outside a React
 * Server Component. Under `tsx` there is no `react-server` condition, so pre-seed the CJS
 * cache with an empty module — the same shim `scripts/resolve.ts` uses, so the documented
 * one-liner above needs no extra flag. Everything below `@/lib` is therefore imported
 * DYNAMICALLY, after this runs.
 */
const req = createRequire(import.meta.url);
const CJSModule = req('node:module') as unknown as { _cache: Record<string, unknown> };
const serverOnly = req.resolve('server-only');
CJSModule._cache[serverOnly] = {
  id: serverOnly,
  filename: serverOnly,
  loaded: true,
  exports: {},
  paths: [],
};

const KEY_PREFIX = /^(isrc|deezer|itunes):/;

function usage(): never {
  console.error('usage: npx tsx scripts/recommend.ts "<artist>" "<title>" [--same-artist] [--json]');
  console.error('       npx tsx scripts/recommend.ts <trackKey> [--same-artist] [--json]');
  process.exit(2);
}

/** A key goes straight to the pipeline; an artist/title pair is resolved first. */
async function seedFor(args: string[]): Promise<TrackRecord | { key: string }> {
  if (args.length === 1 && KEY_PREFIX.test(args[0])) return { key: args[0] };
  if (args.length !== 2) usage();

  const [artist, title] = args;
  process.stdout.write(`resolving ${artist} — ${title} …\n`);

  const [itunes, { resolveTrack }] = await Promise.all([
    import('@/lib/sources/itunes'),
    import('@/lib/resolve/resolveTrack'),
  ]);
  const hit = await itunes.findTrack(artist, title);
  const resolved = await resolveTrack(
    hit.ok
      ? {
          itunesId: hit.value.itunesId,
          artist: hit.value.artist,
          title: hit.value.title,
          durationMs: hit.value.durationMs ?? undefined,
        }
      : { artist, title },
  );

  if (!resolved.ok) {
    console.error(`could not resolve ${artist} — ${title}: ${resolved.reason} ${resolved.detail ?? ''}`);
    process.exit(1);
  }
  return resolved.track;
}

function describe(event: PipelineEvent): string {
  switch (event.type) {
    case 'run':
      return `run      ${event.runId}${event.cached ? '  (cached)' : ''}`;
    case 'stage':
      return `stage    ${event.stage} ${event.status}${event.message ? `  ${event.message}` : ''}`;
    case 'seed':
      return `seed     ${event.track.artist} — ${event.track.title} [${event.track.key}]`;
    case 'fingerprint':
      return `finger   bpm=${event.fingerprint.tempo_bpm ?? 'unknown'} era=${
        event.fingerprint.era ?? 'unknown'
      } feel=${event.fingerprint.tempo_feel} (${event.fingerprint.model})`;
    case 'channel':
      return `channel  ${event.channel} ${event.status}${
        event.found === undefined ? '' : ` found=${event.found}`
      }${event.reason ? `  ${event.reason}` : ''}`;
    case 'verified':
      return `verified ${event.channel} kept=${event.kept} dropped=${event.dropped}`;
    case 'result':
      return `result   ${event.item.track.artist} — ${event.item.track.title}  ${event.item.finalScore.toFixed(2)}`;
    case 'final':
      return `final    ${event.results.length} results, ${event.degraded.length} degraded note(s), ${event.stats.durationMs}ms`;
    case 'error':
      return `error    ${event.message}`;
  }
}

function table(run: RunRecord): string {
  if (run.results.length === 0) return '(no results)';
  const rows = run.results.map((rec, i) => ({
    rank: String(i + 1),
    who: `${rec.track.artist} — ${rec.track.title}`,
    year: rec.track.year ? String(rec.track.year.value) : '—',
    score: rec.finalScore.toFixed(2),
    channels: rec.channels.join(''),
    why: rec.why,
  }));
  const width = (pick: (r: (typeof rows)[number]) => string, min: number) =>
    Math.max(min, ...rows.map((r) => pick(r).length));
  const wWho = Math.min(48, width((r) => r.who, 6));
  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

  return [
    `${'#'.padStart(3)}  ${pad('artist — title', wWho)}  year  score  ch   why`,
    ...rows.map(
      (r) =>
        `${r.rank.padStart(3)}  ${pad(r.who, wWho)}  ${r.year.padStart(4)}  ${r.score.padStart(5)}  ${r.channels.padEnd(3)}  ${r.why}`,
    ),
  ].join('\n');
}

/**
 * The per-host limiter's wait timer is `unref`'d (`src/lib/http/rateLimit.ts`) so it can
 * never hold the SERVER open. In a CLI that means Node can exit, silently and with code
 * 0, while requests are still queued behind the limiter. One ref'd timer for the duration
 * of the run is the whole fix.
 */
function keepProcessAlive(): () => void {
  const handle = setInterval(() => {}, 1_000_000);
  return () => clearInterval(handle);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const includeSameArtist = argv.includes('--same-artist');
  const asJson = argv.includes('--json');
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (positional.length === 0) usage();

  const release = keepProcessAlive();
  try {
    await stream(positional, { includeSameArtist, asJson });
  } finally {
    release();
  }
}

async function stream(
  positional: string[],
  { includeSameArtist, asJson }: { includeSameArtist: boolean; asJson: boolean },
): Promise<void> {
  const { runPipeline } = await import('@/lib/engine/pipeline');
  const seed = await seedFor(positional);
  const startedAt = Date.now();

  const run = await runPipeline({
    seedKey: seed.key,
    options: { includeSameArtist },
    onEvent: (event) => {
      process.stdout.write(`${String(Date.now() - startedAt).padStart(6)}ms  ${describe(event)}\n`);
    },
  });

  if (asJson) {
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
    return;
  }

  process.stdout.write(`\n${table(run)}\n`);
  if (run.degraded.length > 0) {
    process.stdout.write(`\ndegraded:\n${run.degraded.map((d) => `  - ${d}`).join('\n')}\n`);
  }
  if (run.stats.cut && run.stats.cut.length > 0) {
    process.stdout.write(
      `\ncut:\n${run.stats.cut
        .map((c) => `  - ${c.artist} — ${c.title}: ${c.reason}`)
        .join('\n')}\n`,
    );
  }

  const channels = (['A', 'B', 'C'] as const)
    .map((ch) => {
      const s = run.stats.perChannel[ch];
      return s.skipped
        ? `${ch} ${s.skipped}`
        : `${ch} found ${s.found}/verified ${s.verified}/dropped ${s.dropped}`;
    })
    .join(' · ');
  const tokens = run.stats.tokens
    ? ` · ${run.stats.tokens.input} in / ${run.stats.tokens.output} out tokens`
    : '';

  process.stdout.write(
    `\nrun ${run.id} · engine ${run.engineVersion} · ${run.stats.durationMs}ms · `
      + `${run.stats.modelCalls} model call(s)${tokens}\n${channels}\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
