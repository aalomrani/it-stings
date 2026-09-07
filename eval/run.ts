/**
 * `npm run eval` — run the whole engine over `eval/seeds.json` and dump the results for a
 * human to read.
 *
 *   npm run eval                  every seed
 *   npm run eval -- lovecats      one seed by id
 *   npm run eval -- lovecats fever
 *
 * For each seed: iTunes search -> `resolveTrack` -> `runPipeline` (with `force`, so a
 * stored run never stands in for a fresh one) -> `eval/out/<id>.json` (the RunRecord) and
 * `eval/out/<id>.md` (the readable report).
 *
 * The harness JUDGES NOTHING about musical quality — that is what the `passing` and
 * `failing` notes at the top of every report are for, and reading them against the table
 * is the actual eval. What it does automate is the handful of failures a machine can see:
 * a same-artist leak, a generic `why`, a short list, a result with no way to hear it, and
 * a Channel-C drop rate over the spec's ~20% budget.
 *
 * A degraded run (no `ANTHROPIC_API_KEY`, a dead API) is REPORTED, not thrown: the report
 * says the run was degraded and prints the degraded lines, because "the engine could not
 * run today" is a result the harness has to be able to record.
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Fingerprint, Recommendation, RunRecord, TrackRecord } from '@/lib/types';

/**
 * `src/lib/env.ts` imports `server-only`, whose default export throws outside a React
 * Server Component. Under `tsx` there is no `react-server` condition, so pre-seed the CJS
 * cache with an empty module (the same shim `scripts/recommend.ts` uses). Everything below
 * `@/lib` is therefore imported DYNAMICALLY, after this runs.
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

const ROOT = process.cwd();
const SEEDS_PATH = path.join(ROOT, 'eval', 'seeds.json');
const OUT_DIR = path.join(ROOT, 'eval', 'out');

interface Seed {
  id: string;
  title: string;
  artist: string;
  year?: number;
  what_it_is: string;
  passing: string[];
  failing: string[];
}

interface SeedsFile {
  seeds: Seed[];
}

/** Rule 6's floor, restated here so the report flags a list the engine had to shorten. */
const MIN_RESULTS = 8;
/** docs/spec.md, Stage 4: "if Channel C's drop rate exceeds ~20%, tighten its prompt". */
const C_DROP_BUDGET = 0.2;

/**
 * Engine flags the report reads. They are plain strings on `Recommendation.flags`, set by
 * `score.ts` and `pipeline.ts`; naming them here keeps the harness free of engine imports
 * it does not otherwise need.
 */
const FLAG_COVER = 'cover-or-same-song';
const FLAG_GENERIC_WHY = 'weak-why-unfixed';
const FLAG_NO_DISCRIMINATOR = 'why-not-discriminating';
const FLAG_UNSOURCED_NUMBER = 'unsourced-number';

/* ------------------------------------------------------------------------------------ *
 * Report building
 * ------------------------------------------------------------------------------------ */

type Flag = { level: 'fail' | 'flag'; text: string };

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

function yearOf(track: TrackRecord): string {
  return track.year ? String(track.year.value) : '—';
}

function fingerprintBlock(fingerprint: Fingerprint | null): string {
  if (!fingerprint) return '_No fingerprint: the run degraded before Stage 2 finished._';
  const rows: [string, string][] = [
    ['tempo_bpm', fingerprint.tempo_bpm === null ? 'unknown' : String(fingerprint.tempo_bpm)],
    ['tempo_feel', fingerprint.tempo_feel],
    ['rhythmic_character', fingerprint.rhythmic_character],
    ['instrumentation', fingerprint.instrumentation.join(', ')],
    ['vocal_delivery', fingerprint.vocal_delivery],
    ['harmonic_language', fingerprint.harmonic_language],
    ['emotional_register', fingerprint.emotional_register],
    ['production_texture', fingerprint.production_texture],
    ['era', fingerprint.era === null ? 'unknown' : String(fingerprint.era)],
    ['scene_context', fingerprint.scene_context],
    ['signature_hook', fingerprint.signature_hook],
    ['genre_labels', fingerprint.genre_labels.join(', ')],
  ];
  const confidence = Object.entries(fingerprint.confidence)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
  return [
    '| field | value |',
    '| --- | --- |',
    ...rows.map(([k, v]) => `| \`${k}\` | ${esc(v)} |`),
    '',
    `**confidence** — ${confidence}`,
    '',
    `**grounded on** — ${fingerprint.grounded_on.map((g) => esc(g)).join(' · ') || '(nothing)'}`,
    '',
    `**model** — ${fingerprint.model}`,
  ].join('\n');
}

function channelBlock(run: RunRecord): string {
  const lines = [
    '| channel | found | verified | dropped | drop rate | note |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const channel of ['A', 'B', 'C'] as const) {
    const s = run.stats.perChannel[channel];
    const rate = s.found > 0 ? pct(s.dropped / s.found) : '—';
    lines.push(
      `| ${channel} | ${s.found} | ${s.verified} | ${s.dropped} | ${rate} | ${esc(s.skipped ?? '')} |`,
    );
  }
  const spread = run.stats.channelCSpread;
  if (spread) {
    lines.push('');
    lines.push(
      `Channel C spread, **measured from the years it returned** (not from what it claimed): `
        + `${spread.decades.join(', ') || 'no dated entries'} — ${spread.dated}/${spread.entries} `
        + `entries dated, ${pct(spread.topDecadeShare)} of those in the largest decade; `
        + `genre families: ${spread.genres.join(', ') || 'unstated'}. `
        + (spread.ok ? 'Meets the ≥3 decades / ≥3 families ask.' : '**Below the ≥3 decades / ≥3 families ask.**'),
    );
  }

  const retry = run.stats.channelCRetry;
  lines.push('');
  if (!retry) {
    lines.push('_Channel C did not run._');
  } else if (retry.retryDropRate === null) {
    lines.push(
      `Channel C drop rate **${pct(retry.firstDropRate)}** — under the ${pct(C_DROP_BUDGET)} `
        + 'budget, so the tight-prompt retry did not fire.',
    );
  } else {
    lines.push(
      `Channel C drop rate **${pct(retry.firstDropRate)}** — over the ${pct(C_DROP_BUDGET)} budget, `
        + `so it was re-run with \`tightness: 'tight'\` (retry drop rate `
        + `**${pct(retry.retryDropRate)}**, ${retry.added} extra verified track(s)).`,
    );
  }
  return lines.join('\n');
}

function resultsTable(results: Recommendation[]): string {
  if (results.length === 0) return '_No results._';
  // `why is false of` is the model's own counter-example — a record in the candidate's
  // genre the sentence does NOT describe. Read it next to the `why`: if the sentence would
  // fit that record too, the `why` is a genre sentence and the row is a failure.
  const lines = [
    '| # | artist — title | year | final | model | ch | why | why is false of |',
    '| ---: | --- | ---: | ---: | ---: | --- | --- | --- |',
  ];
  results.forEach((rec, i) => {
    lines.push(
      `| ${i + 1} | ${esc(`${rec.track.artist} — ${rec.track.title}`)} | ${yearOf(rec.track)} `
        + `| ${fmt(rec.finalScore)} | ${fmt(rec.modelScore)} | ${rec.channels.join('')} `
        + `| ${esc(rec.why)} | ${esc(rec.whyDiscriminates ?? '—')} |`,
    );
  });
  return lines.join('\n');
}

function traitsBlock(results: Recommendation[]): string {
  if (results.length === 0) return '';
  return results
    .map(
      (rec, i) =>
        `${i + 1}. **${rec.track.artist} — ${rec.track.title}** — `
          + `${rec.sharedTraits.map((t) => `\`${esc(t)}\``).join(', ') || '_no traits_'}`
          + (rec.flags.length > 0 ? ` _(${rec.flags.join(', ')})_` : ''),
    )
    .join('\n');
}

function cutBlock(run: RunRecord): string {
  const cut = run.stats.cut ?? [];
  if (cut.length === 0) return '_Nothing was cut._';
  return [
    '| artist — title | reason |',
    '| --- | --- |',
    ...cut.map((c) => `| ${esc(`${c.artist} — ${c.title}`)} | ${c.reason} |`),
  ].join('\n');
}

function spreadBlock(
  results: Recommendation[],
  decadeOf: (t: TrackRecord) => number | null,
  primaryGenre: (t: TrackRecord) => string | null,
): string {
  if (results.length === 0) return '_No results to spread._';
  const decades = new Map<string, number>();
  const genres = new Map<string, number>();
  for (const rec of results) {
    const decade = decadeOf(rec.track);
    const key = decade === null ? 'unknown' : `${decade}s`;
    decades.set(key, (decades.get(key) ?? 0) + 1);
    const genre = primaryGenre(rec.track) ?? 'unknown';
    genres.set(genre, (genres.get(genre) ?? 0) + 1);
  }
  const render = (m: Map<string, number>): string =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, v]) => `${k} ×${v} (${pct(v / results.length)})`)
      .join(' · ');
  return [
    `**decades** (${decades.size} distinct) — ${render(decades)}`,
    '',
    `**primary genre labels** (${genres.size} distinct) — ${render(genres)}`,
  ].join('\n');
}

/**
 * The checks a machine can make. Everything else — whether the picks are any good — is the
 * human's job, against the `passing` / `failing` notes at the top of the report.
 */
function automatedFlags(
  run: RunRecord,
  seed: TrackRecord,
  helpers: {
    isSameArtist: (a: string, b: string) => boolean;
    bannedPhraseIn: (why: string) => string | null;
  },
): Flag[] {
  const flags: Flag[] = [];

  for (const rec of run.results) {
    if (helpers.isSameArtist(rec.track.artist, seed.artist)) {
      flags.push({
        level: 'fail',
        text: `SAME-ARTIST LEAK: ${rec.track.artist} — ${rec.track.title} is the seed's own act`,
      });
    }
  }

  for (const rec of run.results) {
    const phrase = helpers.bannedPhraseIn(rec.why);
    if (phrase) {
      flags.push({
        level: 'flag',
        text: `generic \`why\` ("${phrase}"): ${rec.track.artist} — ${rec.track.title} — “${rec.why}”`,
      });
    }
  }

  // A run that never got a fingerprint produced no results for a reason the report already
  // states at the top; flagging the empty list as well would bury the actual cause.
  if (run.fingerprint !== null && run.results.length < MIN_RESULTS) {
    flags.push({
      level: 'flag',
      text: `only ${run.results.length} result(s) — rule 6 asks for at least ${MIN_RESULTS} when `
        + `${MIN_RESULTS}+ survived verification`,
    });
  }

  for (const rec of run.results) {
    const hasLink = Object.values(rec.track.links).some((v) => typeof v === 'string' && v.length > 0);
    if (!rec.track.preview && !hasLink) {
      flags.push({
        level: 'flag',
        text: `no preview and no links: ${rec.track.artist} — ${rec.track.title} (nothing to play or open)`,
      });
    }
  }

  // Rule 0: a cover, remix or live take of the seed is the seed, not an answer to "what
  // else sounds like this". `rank.ts` cuts it; a leak here means the cut broke.
  for (const rec of run.results) {
    if (rec.flags.includes(FLAG_COVER)) {
      flags.push({
        level: 'fail',
        text: `COVER LEAK: ${rec.track.artist} — ${rec.track.title} is the seed's own song`,
      });
    }
  }

  // Rule 4b: the engine flagged this `why` as generic twice and shipped it anyway.
  for (const rec of run.results) {
    if (rec.flags.includes(FLAG_GENERIC_WHY)) {
      flags.push({
        level: 'fail',
        text: `GENERIC \`why\` SHIPPED: ${rec.track.artist} — ${rec.track.title} — “${rec.why}”`,
      });
    }
  }

  for (const rec of run.results) {
    if (rec.flags.includes(FLAG_NO_DISCRIMINATOR)) {
      flags.push({
        level: 'flag',
        text: `no counter-example for the \`why\`: ${rec.track.artist} — ${rec.track.title} `
          + `(answered “${rec.whyDiscriminates ?? ''}”)`,
      });
    }
    if (rec.flags.includes(FLAG_UNSOURCED_NUMBER)) {
      flags.push({
        level: 'flag',
        text: `unsourced measurement in the scoring text: ${rec.track.artist} — ${rec.track.title}`
          + ` — “${rec.why}”`,
      });
    }
  }

  const spread = run.stats.channelCSpread;
  if (spread && !spread.ok) {
    flags.push({
      level: 'flag',
      text: `Channel C spread: ${spread.decades.length} decade(s) `
        + `(${spread.decades.join(', ') || 'none dated'}) across ${spread.dated}/${spread.entries} `
        + `dated entries, ${pct(spread.topDecadeShare)} of them in one decade, `
        + `${spread.genres.length} genre family/ies — the spec asks for at least three of each`,
    });
  }

  const retry = run.stats.channelCRetry;
  if (retry && retry.firstDropRate > C_DROP_BUDGET) {
    flags.push({
      level: 'flag',
      text: `Channel C drop rate ${pct(retry.firstDropRate)} > ${pct(C_DROP_BUDGET)}`
        + (retry.retryDropRate === null
          ? ''
          : ` (tight retry: ${pct(retry.retryDropRate)})`),
    });
  }

  return flags;
}

function report(args: {
  seed: Seed;
  run: RunRecord;
  flags: Flag[];
  log: string[];
  decadeOf: (t: TrackRecord) => number | null;
  primaryGenre: (t: TrackRecord) => string | null;
}): string {
  const { seed, run, flags } = args;
  const degradedRun = run.results.length === 0 || run.fingerprint === null;

  const parts: string[] = [];
  parts.push(`# ${seed.artist} — ${seed.title}${seed.year ? ` (${seed.year})` : ''}`);
  parts.push(
    `\`${seed.id}\` · run \`${run.id}\` · engine \`${run.engineVersion}\` · `
      + `${run.stats.durationMs} ms · ${run.stats.modelCalls} model call(s)`
      + (run.stats.tokens
        ? ` · ${run.stats.tokens.input} in / ${run.stats.tokens.output} out tokens `
          + `(${run.stats.tokens.cacheRead} cache read)`
        : '')
      + `\n\nGenerated ${new Date(run.createdAt).toISOString()}.`,
  );

  if (degradedRun) {
    parts.push(
      '## ⚠️ This run was degraded\n\n'
        + 'The engine did not produce a full answer. This report records WHY rather than '
        + 'pretending the empty list is a result:\n\n'
        + (run.degraded.length > 0
          ? run.degraded.map((d) => `- ${d}`).join('\n')
          : '- (no reason recorded)'),
    );
  }

  parts.push(`## What it is\n\n${seed.what_it_is}`);
  parts.push(`## A passing answer\n\n${seed.passing.map((p) => `- ${p}`).join('\n')}`);
  parts.push(`## A failing answer\n\n${seed.failing.map((p) => `- ${p}`).join('\n')}`);

  parts.push(
    '## Automated flags\n\n'
      + (flags.length === 0
        ? '_None. (This says nothing about whether the picks are good — read the table.)_'
        : flags.map((f) => `- **${f.level === 'fail' ? 'FAIL' : 'flag'}** — ${f.text}`).join('\n')),
  );

  parts.push(`## The seed as resolved\n\n${seedBlock(run.seed)}`);
  parts.push(`## Fingerprint\n\n${fingerprintBlock(run.fingerprint)}`);
  parts.push(`## Channels\n\n${channelBlock(run)}`);
  parts.push(`## Results\n\n${resultsTable(run.results)}`);
  const traits = traitsBlock(run.results);
  if (traits) parts.push(`### Shared traits behind each \`why\`\n\n${traits}`);
  parts.push(`## Cut\n\n${cutBlock(run)}`);
  parts.push(`## Spread\n\n${spreadBlock(run.results, args.decadeOf, args.primaryGenre)}`);
  parts.push(
    '## Degraded notes\n\n'
      + (run.degraded.length === 0 ? '_None._' : run.degraded.map((d) => `- ${d}`).join('\n')),
  );
  if (args.log.length > 0) {
    parts.push(`## Stage log\n\n\`\`\`\n${args.log.join('\n')}\n\`\`\``);
  }
  return `${parts.join('\n\n')}\n`;
}

function seedBlock(track: TrackRecord): string {
  const lines = [
    `- **key** \`${track.key}\``,
    `- **artist / title** ${track.artist} — ${track.title}`,
    `- **year** ${track.year ? `${track.year.value} (${track.year.source.source})` : 'unknown'}`,
    `- **tempo** ${track.tempoBpm ? `${track.tempoBpm.value} BPM (${track.tempoBpm.source.source})` : 'unknown'}`,
    `- **tags** ${
      track.tags && track.tags.value.length > 0
        ? `${track.tags.source.source}: ${track.tags.value.slice(0, 8).map((t) => t.name).join(', ')}`
        : 'none'
    }`,
  ];
  if (track.degraded.length > 0) lines.push(`- **resolve degraded** ${track.degraded.join(' · ')}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------------------------ *
 * Running one seed
 * ------------------------------------------------------------------------------------ */

async function runSeed(seed: Seed): Promise<{ line: string; failed: boolean }> {
  const [itunes, { resolveTrack }, { runPipeline }, rank, score, normalize] = await Promise.all([
    import('@/lib/sources/itunes'),
    import('@/lib/resolve/resolveTrack'),
    import('@/lib/engine/pipeline'),
    import('@/lib/engine/rank'),
    import('@/lib/engine/score'),
    import('@/lib/util/normalize'),
  ]);

  // 1. iTunes search, first hit whose artist normalise-matches the seed's.
  const hits = await itunes.searchSongs(`${seed.artist} ${seed.title}`, { limit: 10 });
  const hit = hits.ok
    ? hits.value.find(
        (h) => normalize.artistOverlap(h.artist, seed.artist) && normalize.sameTitle(h.title, seed.title),
      ) ?? hits.value.find((h) => normalize.artistOverlap(h.artist, seed.artist))
    : undefined;

  // 2. Resolve. Without an iTunes id the resolver still works from the names.
  const resolved = await resolveTrack(
    hit
      ? {
          itunesId: hit.itunesId,
          artist: hit.artist,
          title: hit.title,
          ...(hit.durationMs === null ? {} : { durationMs: hit.durationMs }),
        }
      : { artist: seed.artist, title: seed.title },
  );

  if (!resolved.ok) {
    const line = `${seed.id.padEnd(14)} RESOLVE FAILED — ${resolved.reason} ${resolved.detail ?? ''}`;
    await writeFile(
      path.join(OUT_DIR, `${seed.id}.md`),
      `# ${seed.artist} — ${seed.title}\n\n`
        + `## ⚠️ Could not resolve the seed\n\n`
        + `\`${resolved.reason}\` ${resolved.detail ?? ''}\n\n`
        + 'The pipeline was never started, so there is nothing to review. Check the network '
        + 'and `npx tsx scripts/resolve.ts` before re-running.\n',
      'utf8',
    );
    return { line, failed: true };
  }

  // 3. The engine. `force` because a stored run is exactly what an eval must not read.
  const log: string[] = [];
  const run = await runPipeline({
    seedKey: resolved.track.key,
    options: { includeSameArtist: false },
    onEvent: () => {},
    onLog: (l) => log.push(l),
    force: true,
  });

  const flags = automatedFlags(run, run.seed, {
    isSameArtist: rank.isSameArtist,
    bannedPhraseIn: score.bannedPhraseIn,
  });

  await writeFile(path.join(OUT_DIR, `${seed.id}.json`), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  await writeFile(
    path.join(OUT_DIR, `${seed.id}.md`),
    report({
      seed,
      run,
      flags,
      log,
      decadeOf: rank.decadeOf,
      primaryGenre: rank.primaryGenre,
    }),
    'utf8',
  );

  const fails = flags.filter((f) => f.level === 'fail').length;
  const warns = flags.filter((f) => f.level === 'flag').length;
  const degraded = run.results.length === 0 || run.fingerprint === null;
  const line =
    `${seed.id.padEnd(14)} ${String(run.results.length).padStart(2)} results · `
    + `${run.stats.durationMs}ms · ${run.stats.modelCalls} model call(s) · `
    + `${fails} fail / ${warns} flag`
    + (degraded ? ` · DEGRADED: ${run.degraded[0] ?? 'no reason recorded'}` : '');
  return { line, failed: fails > 0 || degraded };
}

/* ------------------------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------------------------ */

/**
 * The per-host limiter's wait timer is `unref`'d (`src/lib/http/rateLimit.ts`) so it can
 * never hold the SERVER open. In a CLI that means Node can exit, silently and with code 0,
 * while requests are still queued behind the limiter.
 */
function keepProcessAlive(): () => void {
  const handle = setInterval(() => {}, 1_000_000);
  return () => clearInterval(handle);
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const file = JSON.parse(readFileSync(SEEDS_PATH, 'utf8')) as SeedsFile;
  const seeds = wanted.length > 0 ? file.seeds.filter((s) => wanted.includes(s.id)) : file.seeds;

  if (seeds.length === 0) {
    console.error(
      `no seed matched ${wanted.join(', ')}. known ids: ${file.seeds.map((s) => s.id).join(', ')}`,
    );
    process.exit(2);
  }

  await mkdir(OUT_DIR, { recursive: true });
  process.stdout.write(`eval: ${seeds.length} seed(s) -> ${path.relative(ROOT, OUT_DIR)}/\n\n`);

  const release = keepProcessAlive();
  let bad = 0;
  try {
    for (const seed of seeds) {
      try {
        const { line, failed } = await runSeed(seed);
        if (failed) bad += 1;
        process.stdout.write(`${line}\n`);
      } catch (error) {
        // One seed exploding must not take the other five with it.
        bad += 1;
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(`${seed.id.padEnd(14)} ERROR — ${message}\n`);
      }
    }
  } finally {
    release();
  }

  process.stdout.write(
    `\n${seeds.length - bad}/${seeds.length} seed(s) ran clean. `
      + `Read ${path.relative(ROOT, OUT_DIR)}/<id>.md against each seed's passing/failing notes.\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
