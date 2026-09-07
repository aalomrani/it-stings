/**
 * Records REAL upstream responses into `src/lib/sources/__fixtures__/` so the test suite
 * can be exact without ever touching the network.
 *
 * This is the one script in the project that is allowed to make live requests. Run it
 * only when a fixture needs refreshing:
 *
 *     npx tsx scripts/record-fixtures.ts            # everything
 *     npx tsx scripts/record-fixtures.ts deezer     # only names containing "deezer"
 *
 * Each fixture file holds the response body verbatim; `_manifest.json` records the URL,
 * the HTTP status and when it was captured. Keyed providers are recorded WITHOUT a key
 * on purpose: their auth-error shape is exactly what the clients have to handle here.
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'src', 'lib', 'sources', '__fixtures__');
const UA = 'ItStings/0.1 (local dev)';

interface Recipe {
  name: string;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Keep the response body small enough to read in a diff. */
  prune?: (body: unknown) => unknown;
  note: string;
}

/** AcousticBrainz low-level is 52 KB of Essentia statistics; we read four leaves. */
const pruneLowLevel = (body: unknown): unknown => {
  const b = body as Record<string, Record<string, unknown>>;
  return {
    rhythm: {
      bpm: b.rhythm?.bpm,
      danceability: b.rhythm?.danceability,
      beats_count: b.rhythm?.beats_count,
      onset_rate: b.rhythm?.onset_rate,
    },
    tonal: {
      key_key: b.tonal?.key_key,
      key_scale: b.tonal?.key_scale,
      key_strength: b.tonal?.key_strength,
      chords_key: b.tonal?.chords_key,
      chords_scale: b.tonal?.chords_scale,
      tuning_frequency: b.tonal?.tuning_frequency,
    },
    lowlevel: {
      average_loudness: b.lowlevel?.average_loudness,
      dynamic_complexity: b.lowlevel?.dynamic_complexity,
    },
    metadata: { audio_properties: (b.metadata as Record<string, unknown>)?.audio_properties },
    _pruned: 'lowlevel.{mfcc,gfcc,barkbands,melbands,erbbands,…} dropped by record-fixtures.ts',
  };
};

/** High-level classifiers carry a `version` block per classifier; drop those. */
const pruneHighLevel = (body: unknown): unknown => {
  const b = body as { highlevel?: Record<string, Record<string, unknown>>; metadata?: unknown };
  const highlevel: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(b.highlevel ?? {})) {
    highlevel[key] = { value: value.value, probability: value.probability, all: value.all };
  }
  return {
    highlevel,
    metadata: { audio_properties: (b.metadata as Record<string, unknown>)?.audio_properties },
    _pruned: 'highlevel.*.version dropped by record-fixtures.ts',
  };
};

const itunes = (term: string, extra: Record<string, string> = {}) =>
  `https://itunes.apple.com/search?country=US&entity=song&limit=8&media=music&term=${encodeURIComponent(term)}${
    Object.entries(extra)
      .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
      .join('')
  }`;

const deezerSearch = (q: string) =>
  `https://api.deezer.com/search?limit=10&q=${encodeURIComponent(q)}`;

const RECIPES: Recipe[] = [
  {
    name: 'itunes-search-lovecats',
    url: itunes('the cure the lovecats'),
    note: 'body begins with three newlines; no isrc field anywhere',
  },
  {
    name: 'itunes-lookup-1288102536',
    url: 'https://itunes.apple.com/lookup?country=US&entity=song&id=1288102536',
    note: 'the US Lovecats trackId; the same id 404s (resultCount 0) in the GB storefront',
  },
  {
    name: 'itunes-search-vampire',
    url: itunes('olivia rodrigo vampire'),
    note: 'explicit tracks arrive as "cleaned" edits from this IP',
  },
  {
    name: 'deezer-search-lovecats-advanced',
    url: deezerSearch('artist:"The Cure" track:"The Lovecats"'),
    note: 'advanced syntax; total 4',
  },
  {
    name: 'deezer-search-lovecats-plain',
    url: deezerSearch('The Cure The Lovecats'),
    note: 'plain query; top hit 1143631 on Greatest Hits, isrc GBALB8300001',
  },
  {
    name: 'deezer-track-1143631',
    url: 'https://api.deezer.com/track/1143631',
    note: 'bpm 91.9, isrc GBALB8300001, release_date 2001-11-12 (the edition, not the song)',
  },
  {
    name: 'deezer-search-lone-digger-plain',
    url: deezerSearch('Caravan Palace Lone Digger'),
    note: 'THE wrong-hit case: plain search leads with "Lone Digger (Mixed)", a 2025 DJ mix, bpm 0',
  },
  {
    name: 'deezer-search-lone-digger-advanced',
    url: deezerSearch('artist:"Caravan Palace" track:"Lone Digger"'),
    note: 'advanced syntax rescues the original 109590416 (bpm 124.2)',
  },
  {
    name: 'deezer-search-vampire-plain',
    url: deezerSearch('Olivia Rodrigo vampire'),
    note: '2023 track: Deezer bpm is 0 and AcousticBrainz has nothing',
  },
  {
    name: 'deezer-track-2440763155',
    url: 'https://api.deezer.com/track/2440763155',
    note: 'bpm 0 = unknown, never zero beats per minute',
  },
  {
    name: 'deezer-track-not-found',
    url: 'https://api.deezer.com/track/0',
    note: 'HTTP 200 with {"error":{"code":800}} — Deezer never uses HTTP status for errors',
  },
  {
    name: 'mb-isrc-GBALB8300001',
    url: 'https://musicbrainz.org/ws/2/isrc/GBALB8300001?fmt=json&inc=artist-credits%2Bisrcs%2Btags',
    note: 'the ISRC join: recording 1c19fbb9…, first-release-date 1983-11-28',
  },
  {
    name: 'mb-isrc-not-found',
    url: 'https://musicbrainz.org/ws/2/isrc/USCA29900213?fmt=json&inc=artist-credits%2Bisrcs',
    note: 'HTTP 404 — 2 of 15 sample ISRCs miss',
  },
  {
    name: 'mb-search-lovecats',
    url: 'https://musicbrainz.org/ws/2/recording?fmt=json&limit=5&query=recording%3A%22The%20Lovecats%22%20AND%20artist%3A%22The%20Cure%22',
    note: 'the fallback when the ISRC misses; several recordings share score 100',
  },
  {
    name: 'ab-high-level-1c19fbb9',
    url: 'https://acousticbrainz.org/api/v1/1c19fbb9-edce-49e1-a934-de6071dd7964/high-level',
    prune: pruneHighLevel,
    note: 'mood/danceability probabilities under highlevel.<classifier>.all',
  },
  {
    name: 'ab-low-level-1c19fbb9',
    url: 'https://acousticbrainz.org/api/v1/1c19fbb9-edce-49e1-a934-de6071dd7964/low-level',
    prune: pruneLowLevel,
    note: 'rhythm.bpm 91.7, tonal.key_key F major',
  },
  {
    name: 'ab-high-level-not-found',
    url: 'https://acousticbrainz.org/api/v1/0c846a8e-debd-4a63-bb93-6c57f5178b45/high-level',
    note: 'HTTP 404 for vampire (2023): the dataset was frozen in 2022',
  },
  {
    name: 'lastfm-error-6',
    url: 'https://ws.audioscrobbler.com/2.0/?method=track.getTopTags&artist=The%20Cure&track=The%20Lovecats&format=json&autocorrect=1',
    note: 'NO api_key -> HTTP 400 error 6, the SAME code as "not found" (hence the local key check)',
  },
  {
    name: 'lastfm-error-10',
    url: 'https://ws.audioscrobbler.com/2.0/?method=track.getTopTags&artist=The%20Cure&track=The%20Lovecats&format=json&autocorrect=1&api_key=INVALID',
    note: 'bad key -> HTTP 403 error 10',
  },
  {
    name: 'tavily-401',
    url: 'https://api.tavily.com/search',
    method: 'POST',
    headers: { Authorization: 'Bearer INVALID', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'the lovecats sounds like', search_depth: 'basic' }),
    note: 'HTTP 401 {"detail":{"error":"Unauthorized: missing or invalid API key."}}',
  },
  {
    name: 'brave-422',
    url: 'https://api.search.brave.com/res/v1/web/search?count=8&q=the%20lovecats',
    headers: { Accept: 'application/json' },
    note: 'no key -> HTTP 422 (not 401)',
  },
  {
    name: 'getsongbpm-401',
    url: 'https://api.getsong.co/search/?type=both&lookup=song%3AThe%20Lovecats%20artist%3AThe%20Cure&limit=5',
    note: 'no key -> HTTP 401 {"error":"API Key is missing."} under a text/html content type',
  },
  {
    name: 'spotify-token-400',
    url: 'https://accounts.spotify.com/api/token',
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from('bogus:bogus').toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    note: 'HTTP 400 {"error":"invalid_client"}',
  },
  {
    name: 'spotify-oembed-lovecats',
    url: 'https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F6q2T5xXao6mTS6LLE88L84',
    note: 'keyless; a nonexistent id answers 404 with an empty body',
  },
];

/**
 * Deezer's throttle body cannot be recorded on demand (it needs a 70-request burst), so
 * it is written from the shape the probe captured verbatim.
 */
const HANDWRITTEN: Record<string, { status: number; body: unknown; note: string }> = {
  'deezer-quota-code-4': {
    status: 200,
    body: { error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } },
    note: 'HAND-WRITTEN from docs/api-reality.md §3.2 (needs a 70-request burst to trigger live)',
  },
};

/** The backoff ladder docs/architecture.md specifies for MusicBrainz 503s. */
const RETRY_BACKOFF_MS = [1200, 2400, 4800, 6000, 6000];

/**
 * This script is the ONE place allowed to call `fetch` directly (docs/tasks/phase1-sources.md
 * puts it outside `sources/`), so it has to reproduce the seam's 503 handling itself: a
 * fixture recorded from a "server is currently busy" body is a test that proves nothing.
 */
async function fetchWithRetry(recipe: Recipe): Promise<Response> {
  let res: Response | null = null;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    if (attempt > 0) {
      const wait = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
      process.stdout.write(`(HTTP ${res?.status}, retrying in ${wait}ms) `);
      await new Promise((r) => setTimeout(r, wait));
    }
    res = await fetch(recipe.url, {
      method: recipe.method ?? 'GET',
      headers: { 'User-Agent': UA, ...(recipe.headers ?? {}) },
      body: recipe.body,
    });
    if (res.status < 500 && res.status !== 429) return res;
  }
  return res as Response;
}

async function main(): Promise<void> {
  const filter = process.argv[2];
  fs.mkdirSync(DIR, { recursive: true });

  const manifestPath = path.join(DIR, '_manifest.json');
  const manifest: Record<string, unknown> = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : {};

  for (const [name, fixture] of Object.entries(HANDWRITTEN)) {
    if (filter && !name.includes(filter)) continue;
    fs.writeFileSync(path.join(DIR, `${name}.json`), `${JSON.stringify(fixture.body, null, 2)}\n`);
    manifest[name] = { status: fixture.status, note: fixture.note, source: 'hand-written' };
    console.log(`  ${name}: hand-written`);
  }

  for (const recipe of RECIPES) {
    if (filter && !recipe.name.includes(filter)) continue;
    process.stdout.write(`  ${recipe.name} … `);
    try {
      const res = await fetchWithRetry(recipe);
      const text = await res.text();
      // No recipe expects a 5xx: several deliberately record a 401/404/422 auth or
      // not-found SHAPE, but a "server is currently busy" body is an outage, not a
      // response worth testing against. MusicBrainz answers 503 to a quarter of even
      // compliant requests (api-reality.md addendum B4), so without this a 503 body would
      // silently replace a good fixture and the suite would test the outage.
      if (res.status >= 500) {
        console.log(`HTTP ${res.status} — NOT written (kept the fixture on disk)`);
        continue;
      }
      let body: unknown;
      try {
        body = JSON.parse(text.trim());
      } catch {
        body = { _nonJsonBody: text.slice(0, 500) };
      }
      if (recipe.prune && res.ok) body = recipe.prune(body);

      fs.writeFileSync(path.join(DIR, `${recipe.name}.json`), `${JSON.stringify(body, null, 2)}\n`);
      manifest[recipe.name] = {
        url: recipe.url,
        method: recipe.method ?? 'GET',
        status: res.status,
        note: recipe.note,
        recordedAt: new Date().toISOString(),
        ...(recipe.prune ? { pruned: true } : {}),
      };
      console.log(`HTTP ${res.status}, ${text.length} B`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    // MusicBrainz is 1 req/s and everything else is happier with a gap.
    await new Promise((r) => setTimeout(r, 1300));
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nwrote ${Object.keys(manifest).length} fixtures to ${DIR}`);
}

void main();
