# It Stings — architecture contract

Read `docs/spec.md` first, then `docs/api-reality.md`. This document fixes the module
boundaries, shared types, database schema, and streaming protocol so that work done in
parallel integrates without renegotiation. If you need to change a shared type, change it
here and say so in your report.

## Stack decisions

- Next.js (App Router, TypeScript, `src/` dir). No Tailwind: the visual system is hand-written
  CSS custom properties + inline SVG, specified in `docs/design.md` with reference mockups in
  `docs/design/final/`.
- `better-sqlite3`, single file at `data/itstings.sqlite` (git-ignored; `data/` is created
  on first run). Migrations are plain SQL run in order at startup by `src/lib/db/index.ts`.
- `@anthropic-ai/sdk` for the model. Model id `claude-opus-5` unless `ITSTINGS_MODEL`
  overrides it. Structured output via `output_config.format` + zod. See `docs/model.md`.
- `zod` for every boundary: env, external API responses, model outputs, SSE events.
- `vitest` for tests. Tests must not hit the network; sources are mocked at the
  `fetchExternal` seam.
- No client-side fetch of any third-party host. Ever.

## Directory layout

```
src/app/
  layout.tsx, page.tsx, globals.css
  playlists/page.tsx
  playlists/[id]/page.tsx
  api/health/route.ts            GET  -> which keys are present, which sources reachable
  api/search/route.ts            GET  ?q= -> typeahead hits (iTunes)
  api/resolve/route.ts           POST {itunesId|deezerId|isrc, title, artist} -> TrackRecord
  api/recommend/route.ts         GET  ?seed=<trackKey>&sameArtist=0|1 -> SSE stream (PipelineEvent)
  api/preview/route.ts           GET  ?key= -> { url, source, expiresAt } (re-mints Deezer preview)
  api/runs/[id]/route.ts         GET  -> `{ run }`: a cached run (RunRecord), previews hydrated
  api/playlists/route.ts         GET list, POST create
  api/playlists/[id]/route.ts    GET, PATCH (rename/reorder), DELETE
  api/playlists/[id]/items/route.ts  POST add, DELETE remove
  api/playlists/[id]/export/route.ts GET ?format=txt|json
src/lib/
  env.ts                 zod-validated process.env; exports `keys` presence flags
  types.ts               ALL shared types (below). Nothing else defines these.
  db/index.ts            singleton better-sqlite3 handle + migration runner
  db/migrations/NNN_*.sql
  db/repos/*.ts          typed queries: tracks, httpCache, runs, evidence, playlists
  http/fetchExternal.ts  the one seam: timeout, retry, per-host rate limit, SQLite cache
  http/rateLimit.ts      per-host token bucket / serial queue (MusicBrainz = strictly serial 1/s)
  sources/itunes.ts      each file exports typed functions; no other file calls fetch()
  sources/deezer.ts
  sources/musicbrainz.ts
  sources/acousticbrainz.ts
  sources/lastfm.ts
  sources/spotify.ts
  sources/websearch.ts
  sources/getsongbpm.ts
  resolve/resolveTrack.ts   join sources -> TrackRecord (+ cache)
  resolve/verifyCandidate.ts  (artist,title) -> TrackRecord | null   (Stage 4)
  engine/model.ts        Anthropic client wrapper: callStructured(schema, system, user, opts)
  engine/fingerprint.ts  Stage 2
  engine/channels/a.ts   Last.fm similar + tag pivot
  engine/channels/b.ts   web-search evidence + mention extraction
  engine/channels/c.ts   model prior (seed identity withheld)
  engine/score.ts        Stage 5 model scoring, batched
  engine/rank.ts         Stage 5 code-enforced rules (pure function, heavily unit-tested)
  engine/pipeline.ts     orchestrates stages; emits PipelineEvent; persists RunRecord
src/components/          UI (Phase 2+)
eval/seeds.json          eval harness seeds
eval/run.ts              runs the pipeline for each seed, dumps eval/out/<seed>.json + .md
scripts/                 dev utilities
data/                    SQLite file (git-ignored)
docs/
```

## Shared types (`src/lib/types.ts`)

Every displayed number carries provenance. If you cannot fill `source`, the value is null.

```ts
export type SourceName =
  | 'itunes' | 'deezer' | 'musicbrainz' | 'acousticbrainz' | 'lastfm'
  | 'spotify' | 'getsongbpm' | 'web' | 'model' | 'user';

export interface SourceRef { source: SourceName; id?: string; url?: string; field?: string }
export interface Sourced<T> { value: T; source: SourceRef }

export interface TrackRecord {
  key: string;                 // `isrc:<ISRC>` when Deezer gave us one, else `deezer:<id>`, else `itunes:<id>` (iTunes never returns ISRC — verified)
  isrc: string | null;
  title: string;
  artist: string;
  album: string | null;
  year: Sourced<number> | null;
  durationMs: Sourced<number> | null;
  artwork: { small: string; large: string; source: SourceRef } | null;
  preview: { url: string; source: SourceRef; expiresAt: number | null } | null;   // best available preview; Deezer URLs are HMAC-signed and expire 15 min after minting — never persist them (see "Preview audio")
  tempoBpm: Sourced<number> | null;                     // first non-zero of deezer -> getsongbpm -> acousticbrainz
  keySignature: Sourced<string> | null;                 // e.g. "F# minor", from acousticbrainz/getsongbpm only
  links: { itunes?: string; deezer?: string; spotify?: string; musicbrainz?: string; lastfm?: string };
  ids: { itunes?: number; deezer?: number; spotify?: string; mbid?: string };
  tags: Sourced<{ name: string; count: number }[]> | null;   // Last.fm top tags
  features: { source: SourceRef; danceability?: number; moodHappy?: number; moodAggressive?: number;
              moodRelaxed?: number; moodSad?: number; genreLabels?: string[] } | null;  // AcousticBrainz high-level
  resolvedAt: number;          // epoch ms
  degraded: string[];          // sources that failed/skipped during resolve, human-readable
}

export type TempoFeel = 'dragging' | 'relaxed' | 'walking' | 'bouncing' | 'driving' | 'frantic';
export type Confidence = 'low' | 'medium' | 'high';

export interface Fingerprint {
  tempo_bpm: number | null;            // copied from TrackRecord.tempoBpm, never model-invented
  tempo_feel: TempoFeel;
  rhythmic_character: string;
  instrumentation: string[];
  vocal_delivery: string;
  harmonic_language: string;
  emotional_register: string;
  production_texture: string;
  era: number | null;                  // copied from TrackRecord.year, never model-invented
  scene_context: string;
  signature_hook: string;
  genre_labels: string[];              // model's own labels, used only for spread + "genre-only" cut
  confidence: Record<
    'tempo_feel' | 'rhythmic_character' | 'instrumentation' | 'vocal_delivery' | 'harmonic_language'
    | 'emotional_register' | 'production_texture' | 'scene_context' | 'signature_hook', Confidence>;
  grounded_on: string[];               // human-readable list of hard data used ("Deezer bpm 132", "Last.fm tags: ...")
  model: string;                       // model id that produced it
}

export type Channel = 'A' | 'B' | 'C';

export interface Candidate {                 // pre-verification
  artist: string;
  title: string;
  channels: Channel[];
  hints: { lastfmMatch?: number; tag?: string; sourceUrl?: string; sentence?: string; enthusiasm?: 'high' | 'medium' | 'low'; modelNote?: string }[];
}

export interface Evidence {
  channel: Channel;
  fetchedAt?: number;          // epoch ms when the underlying search result / Last.fm answer was fetched; the UI stamps "cached <date>" from it
  live?: boolean;              // true when the channel that produced it ran live in this run
  kind: 'lastfm_similar' | 'lastfm_tag' | 'forum' | 'model_prior';
  url?: string;                // forum thread / lastfm page
  title?: string;              // page title
  sentence?: string;           // the surrounding sentence for forum mentions
  enthusiasm?: 'high' | 'medium' | 'low';
  detail?: string;             // e.g. "Last.fm match 0.42", "tag: swing revival"
}

export interface DimensionScore { dimension: keyof Fingerprint['confidence'] | 'era'; score: number; note: string } // score 0-1; the model returns all nine, always

export interface Recommendation {
  track: TrackRecord;
  channels: Channel[];
  evidence: Evidence[];
  dimensions: DimensionScore[];
  modelScore: number;          // 0-1, weighted mean of `dimensions` (weights in rank.ts), computed in code
  finalScore: number;          // after code-enforced rules (bonuses/penalties), what we sort by
  why: string;                 // ONE sentence naming the specific shared trait
  sharedTraits: string[];      // 2-5 concrete traits behind `why` (rule 4's input; Phase 1 task C)
  sameArtist: boolean;
  flags: string[];             // e.g. 'multi-channel', 'genre-only-cut', 'same-artist-high-bar'
}

export type FingerprintField = keyof Fingerprint['confidence'];
export interface RunOptions {
  includeSameArtist: boolean;
  corrections?: Partial<Record<FingerprintField, 'wrong' | string>>;   // user disagreed with the fingerprint: 'wrong' = re-interpret this field; a string = use this instead
}

export interface RunStats {
  perChannel: Record<Channel, { found: number; verified: number; dropped: number; skipped?: string }>;
  durationMs: number;
  modelCalls: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheCreation: number };   // Phase 3: this run's model spend
  cut?: { key: string; artist: string; title: string; reason: string }[];                 // Phase 3: what rank.ts removed, and why
  channelCRetry?: { firstDropRate: number; retryDropRate: number | null; added: number }; // Phase 3: Stage 4's ~20% guard on Channel C
  channelCSpread?: { decades: number; maxDecadeShare: number; ok: boolean; reason?: string }; // engine-2: measured from the years Channel C returned, not its self-report
}

export interface RunRecord {
  id: string;
  seed: TrackRecord;
  options: RunOptions;
  fingerprint: Fingerprint | null;
  results: Recommendation[];
  degraded: string[];          // e.g. "Channel B skipped: no TAVILY_API_KEY"
  stats: RunStats;
  engineVersion: string;       // bump when ranking logic changes; part of the run cache key
  createdAt: number;
}

export type PipelineStage = 'resolve' | 'fingerprint' | 'channels' | 'verify' | 'score' | 'rank' | 'done';

export type PipelineEvent =
  | { type: 'run'; runId: string; cached: boolean }
  | { type: 'stage'; stage: PipelineStage; status: 'start' | 'done' | 'error'; message?: string }
  | { type: 'seed'; track: TrackRecord }
  | { type: 'fingerprint'; fingerprint: Fingerprint }
  | { type: 'channel'; channel: Channel; status: 'start' | 'done' | 'skipped' | 'error'; found?: number; reason?: string }
  | { type: 'verified'; channel: Channel; kept: number; dropped: number }
  | { type: 'result'; item: Recommendation; provisional: true }    // streamed as batches are scored
  | { type: 'final'; results: Recommendation[]; degraded: string[]; stats: RunRecord['stats'] }
  | { type: 'error'; message: string };
```

## Streaming protocol

`GET /api/recommend?seed=<key>&sameArtist=0|1[&corrections=<urlencoded JSON>]` returns `text/event-stream`. Each event is
`data: <JSON PipelineEvent>\n\n`. The route handler must set `cache: 'no-store'` semantics
and flush per event. Order guarantee: `run` → `stage resolve` → `seed` → `stage fingerprint`
→ `fingerprint` → per-channel `channel start` → `channel done` → zero or more `result`
(provisional) → `verified` → `stage rank` → `final` → `stage done`. The client renders
provisional results as they arrive and re-sorts to `final.results` when it lands.

Every channel emits `channel start` (all three, in A/B/C order, as the channels are
launched) and exactly one terminal `channel done|skipped|error`. A channel that skipped or
errored emits no `verified` event; its reason is also in `degraded[]`.

`result` events come BEFORE that channel's `verified` tally, not after: they are emitted as
each candidate finishes Stage 4, and `kept`/`dropped` is not knowable until the last one
lands. Verification is the longest phase of a run (70 s of a 73 s cold run, measured), so
holding the results until the end of it is the dead window streaming exists to avoid.

Error path (the same guarantee, one branch): when the seed key resolves to nothing the
server emits `run` → `stage resolve start` → `seed` (a stand-in record with `degraded:
['not resolved']`) → `stage resolve error` → `error` → `final` (empty) → `stage done`, and
the run is NOT cached. A client that waits for `seed` before rendering is never stranded.

Client disconnect: the request's `AbortSignal` is threaded all the way INTO Stage-4
verification, not merely checked around it. A run whose client has gone away stops within
one in-flight lookup; everything it had already resolved stays cached.

If the run is served from cache, the server still emits the same sequence quickly (from
the stored `RunRecord`) with `cached: true`, so the UI needs one code path — including the
audio: every track in a replayed run passes back through `hydratePreview`, because the
stored record deliberately holds no preview URL. `GET /api/runs/[id]` answers `{ run }`
(the same wrapper shape as the sibling routes' `{ playlist }`, `{ track }`, `{ hits }`),
hydrated the same way.

## Resolver flow (resolve/resolveTrack.ts) — built on what recon verified

1. Typeahead: iTunes `/search?term=&entity=song&country=US&limit=8`. Always `country=US`;
   iTunes trackIds are storefront-specific. Show title, artist, artwork (rewrite
   `100x100bb` → `200x200bb`). No key, CORS-open, no rate limit observed, but keep a polite
   ≤20/min limiter anyway.
2. On selection (`POST /api/resolve` with the iTunes hit): match to Deezer with
   `/search?q=artist:"<artist>" track:"<title>"` (fallback: plain `q=<artist> <title>`),
   choose the hit whose normalised title matches and whose `duration` is within ±3 s of
   iTunes `trackTimeMillis/1000`, preferring non-live/non-remix/non-"Mixed" titles. Then
   `GET /track/{id}` for `isrc`, `bpm`, `release_date`, `preview`, `album.cover_xl`.
   Deezer BPM is per track id, not per recording; treat `0` as unknown.
3. ISRC → MusicBrainz `GET /isrc/{isrc}?inc=artist-credits+releases+tags+genres&fmt=json`
   (verified 13/15 hit rate). Fallback: recording search by artist + title, accept only if
   the top hit's artist and title both normalise-match. From the recording take the MBID,
   first-release-date (a year source), tags/genres.
4. MBID → AcousticBrainz `GET /api/v1/{mbid}/high-level` and `/low-level` (14/15 for
   pre-2022 recordings, nothing after 2022). Take `rhythm.bpm`, `tonal.key_key` +
   `tonal.key_scale`, high-level mood/danceability probabilities.
5. Last.fm `track.getTopTags` (needs key; skip cleanly if absent).
6. Spotify search (needs client credentials; skip cleanly if absent; store the track id and
   `open.spotify.com/track/<id>` link). Without credentials `links.spotify` is
   `https://open.spotify.com/search/<artist> <title>` (verified 200, keyless).
7. Tempo: `tempoBpm = deezer.bpm > 0 ? deezer : getsongbpm (if key) : acousticbrainz.rhythm.bpm : null`,
   with the source recorded. Year: iTunes `releaseDate` and Deezer `release_date` are the
   dates of the EDITION the hit sits on (compilations and reissues: "Golden Brown" shows
   1983 on iTunes, real year 1981), so the precedence is MusicBrainz recording
   `first-release-date` → MusicBrainz release-group first release → the EARLIER of the
   iTunes/Deezer edition dates, with `source.field` saying `edition date — may be a reissue`
   in that last case. If MB and the edition dates disagree, keep MB and note both in
   `degraded`. The UI prints the source stamp next to the year.
   The record's ARTIST and TITLE come from whichever source supplied the identity — iTunes
   first, then the Deezer credit. The caller's strings are a search QUERY only: labelling a
   row with them produced records carrying a name no upstream API ever attached to that
   recording (a "Sia — Titanium" row whose one id resolved to "Sia Momo — Titanium (2T21
   Edit)").
8. Persist the TrackRecord (minus the Deezer preview URL) in `tracks`. `RunRecord`s are
   persisted the same way and re-hydrated on the way out: the run cache is read back days
   later, and a stored Deezer preview URL is a 403 by then.

Stage 4 verification (`resolve/verifyCandidate.ts`) is the same match logic as step 2 run
on Deezer first (50 req/5 s, no key) and iTunes second, with the `verifications` cache.
A candidate is real only if a hit's normalised artist AND title both match (title match
allows parenthetical suffixes like "(Remastered)" but not a different song — and not a
different PERFORMANCE: a hit carrying live/karaoke/tribute/cover/instrumental/remix is
rejected when the candidate named no variant).

"Artist matches" means `normalize.artistOverlap`, which is directional and joiner-aware:
the shorter name is accepted only when it is one of the other's credit SEGMENTS, i.e. the
extra text is another CREDITED ACT and never more of the same name. Whole-token containment
is NOT enough — it made every one-token act ("Sia", "Air", "Cream", "Hell", "Prince") match
any longer name containing it, and Stage 4 certified "Sia Momo — Titanium (2T21 Edit)" as
Sia's "Titanium" and cached it for 30 days. A candidate naming only a FEATURED artist also
matches, so "Haley Reinhart — Creep" reaches "…Postmodern Jukebox — Creep (feat. Haley
Reinhart)".

## Preview audio

- Deezer preview URLs (`cdnt-preview.dzcdn.net/...?hdnea=exp=...~hmac=...`) expire exactly
  900 s after the API response. Store only the Deezer track id. `GET /api/preview?key=<trackKey>`
  re-mints via `/track/{id}` (cached in `http_cache` for 13 minutes) and returns
  `{ url, source, expiresAt }`; every TrackRecord served by an API route has `preview`
  hydrated the same way. The player refreshes via `/api/preview` if `expiresAt` has passed
  or playback errors.
- iTunes `previewUrl` (30 s AAC m4a, CORS-open, range-capable) is the fallback and is stable
  enough to persist.
- Spotify embed iframe (`https://open.spotify.com/embed/track/<id>`) is only possible when
  a Spotify track id was resolved (needs credentials). Validate ids locally with
  `^[0-9A-Za-z]{22}$` (oEmbed answers 504 to malformed ids, 404 to unknown ones). Otherwise
  the card shows the "no preview" state and the deep link.
- A Deezer preview past its `exp` returns an Akamai 403 identical to a tampered URL, so the
  client compares `expiresAt` locally and re-mints before playing rather than probing.
- Note: from this machine's region iTunes returns "cleaned" editions for explicit tracks,
  so iTunes previews may be clean edits. Cosmetic; do nothing about it.

## External API behaviours that must be handled (all verified live)

- Deezer returns HTTP 200 for every error, including throttling:
  `{"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}`. The source
  inspects the body; on code 4 it waits 1.5 s and retries up to 3 times. Limit ≤45 req/5 s.
- MusicBrainz 503s ("server is currently busy", `retry-after: 0`) on 25–45% of requests even at
  1 req/s with a proper User-Agent, in runs of up to three. Client: strictly serial, ≥1100 ms
  spacing, User-Agent `ItStings/0.1 (local dev)`, retry 503 up to 5 times with 1.2 / 2.4 /
  4.8 / 6 / 6 s backoff. Missing User-Agent → 403; Next's route-handler `fetch` sends
  `user-agent: node` by default, so the seam MUST set the UA explicitly (it does).
  `first-release-date` can be `YYYY`, `YYYY-MM` or `YYYY-MM-DD` — take the 4-digit prefix.
  The Solr search path (`/recording?query=`) sheds load far more than `/isrc/` and
  `/recording/{mbid}` lookups; prefer the lookups.
- Last.fm: with no `api_key` the API returns error 6 (the same code as "not found"), so the
  source checks key presence locally and validates its own params before calling; only then
  is upstream error 6 treated as "not found". Error 10 = invalid key → surface in
  `/api/health`. The ToS requires a visible "powered by Last.fm" credit with links to the
  catalogue pages and forbids scraping Last.fm HTML; keep stored Last.fm data well under
  100 MB.
- Spotify (2026 Development Mode): owner needs Premium, 5 authorised users, search `limit`
  max 10, playlist items endpoint is `POST /v1/playlists/{id}/items`. Everything on
  `api.spotify.com` 401s without a token. Keep Spotify strictly optional.
- Web search: Tavily is primary (`TAVILY_API_KEY`), Brave is fallback (`BRAVE_SEARCH_API_KEY`).
  Reddit direct fetches are 403 (confirmed) and rateyourmusic is behind a Cloudflare
  challenge (confirmed): the app never fetches either host. Channel B works only from what
  the search API itself returns (Tavily `content`/`raw_content`, Brave snippets). Check
  `docs/api-reality.md` for each provider's caching terms before persisting raw results;
  our own extracted mentions are always cacheable.
- GetSongBPM lives at `https://api.getsong.co/` (the documented host now serves a Cloudflare
  challenge). 401 JSON without a key. Attribution backlink is mandatory when a key is used:
  render "Tempo data by GetSongBPM" linking to getsongbpm.com in the footer whenever the key
  is configured.
- Operational hazard (verified): a killed `next dev` leaves `.next/dev/types/*.ts` behind and
  the next `next build` fails type-checking on them; recovery is `rm -rf .next/dev`. The
  `typecheck` script runs `next typegen` first for the same reason. Never have both
  `middleware.ts` and `proxy.ts` (dev hangs).
- Toolchain (verified on this machine): Next 16.3.x with Turbopack for dev and build,
  better-sqlite3 13.x loads from its bundled prebuilt binary on Node 24.20 with no config
  (it is on Next's built-in serverExternalPackages list), `@anthropic-ai/sdk` 0.124+ exposes
  `client.messages.parse` + `zodOutputFormat`. npm 11.19 silently skips install scripts
  unless approved: run `npm install-scripts approve better-sqlite3` once and commit the
  resulting package.json field.

## Pipeline behaviour (engine/pipeline.ts)

1. Resolve the seed (cache hit expected — the UI already resolved it on selection).
2. Fingerprint (cached per track key + model + prompt version).
3. Start channels A, B, C concurrently. Each channel returns `Candidate[]` and never sees
   another channel's output. A channel that lacks its key resolves immediately with
   `status: 'skipped', reason`.
4. As each channel resolves: dedupe against the pool (normalised artist+title), verify new
   candidates (Stage 4) via Deezer-first then iTunes, and score the newly verified batch
   (Stage 5 model call, ≤12 candidates per call, calls in parallel). Emit provisional
   `result` events. Candidates that were already verified via another channel just gain a
   channel + evidence; they are not re-verified or re-scored.
5. When all channels are done: `rank.ts` applies the code-enforced rules and produces the
   final ordered list. Persist `RunRecord`. Emit `final`.

## Code-enforced ranking rules (engine/rank.ts — pure, unit-tested)

Input: `Recommendation[]` (scored), seed `TrackRecord`, `RunOptions`. Output: ordered list of 15–20.

0. Same song: a candidate the scorer marks `is_cover_or_same_song` (a cover, remix, live take
   or re-recording of the seed) is cut with reason `same-song`. Absolute; never relaxed.
1. Same artist (normalised comparison, also catches "The Cure" vs "Cure", featured artists):
   excluded unless `includeSameArtist`. If included, requires `modelScore ≥ 0.85` and the
   `why` to pass the genre-only check; flagged `same-artist-high-bar`.
2. One track per artist: keep the highest `finalScore` per artist, using the SAME same-act
   relation as rule 1 (`normalize.artistOverlap`). Keying this on exact `normArtist`
   instead let "Waldeck" and "The Avener & Waldeck" both survive as different artists while
   rule 1 would have cut either as the seed's own act — two rules, two answers about who is
   the same act.
3. Multi-channel bonus: `finalScore = modelScore + 0.12 × (channels − 1)`, capped at 1;
   an explicit forum mention with `enthusiasm: 'high'` from a channel that ran live this
   run adds a further `+0.05` (a cached mention that Channel B did not refresh earns
   nothing, and the UI says so).
   `modelScore` is NOT a free number from the model: it is the weighted mean of the
   per-dimension scores the model returns, computed in code with these weights (total 15):
   rhythmic_character ×3, vocal_delivery ×3, emotional_register ×2, scene_context ×2,
   signature_hook ×2, instrumentation ×1, harmonic_language ×1, production_texture ×1,
   era ×0 (era counts toward spread, never toward a match). The weights are constants in
   `rank.ts`, printed inline in the UI, and are the first thing Phase 5 tunes.
4. Genre-only cut: drop if `why` contains no concrete musical trait. Implemented as: the
   model returns `shared_traits: string[]` alongside `why`; a candidate with zero traits, or
   whose traits are all in the genre-label blocklist (genre names, decades, "vibe", "mood",
   "style", "energy", "feel", "sound"), is cut and flagged `genre-only-cut`. Also cut if
   `dimensions` has fewer than two entries ≥ 0.6.
4b. Generic why: a candidate whose `why` the scorer flagged as generic (banned phrase, or a
   `why_discriminates` self-test the model could not pass) and that a single re-score did
   not fix carries `weak-why-unfixed` and is cut with reason `generic-why`. Absolute; never
   relaxed by rule 6.
5. Spread: after sorting, apply a soft diversity pass — no more than 40% of the final list
   from a single decade, no more than 40% sharing the same primary genre label. Excess
   items are demoted below the diverse set rather than deleted, then the list is cut to 20.
   The 40% is of the list ACTUALLY emitted (`min(target, survivors)`), not of the target of
   20: sized to the target, a run that verified 10 candidates got a cap of 8 and no spread
   pass at all. Because demoted items are re-admitted below the diverse set, on a list
   shorter than the target the share is an ORDERING rule, not a guarantee about the final
   ratio. The primary genre label is the top crowd tag FIRST and an AcousticBrainz
   classifier label only as a fallback — api-reality.md §3.3 measured `genre_dortmund`
   returning `electronic` for every high-level hit in the sample, so it is dropped from
   `features.genreLabels` entirely and the remaining classifiers are weak signal.
6. Never emit fewer than 8 if 8+ survived verification (relax rule 5 first, then rule 4's
   dimension threshold, never rule 1/2/verification).

## Database schema (`src/lib/db/migrations/001_init.sql`)

```sql
CREATE TABLE tracks (
  key TEXT PRIMARY KEY, isrc TEXT, title TEXT NOT NULL, artist TEXT NOT NULL,
  norm_artist TEXT NOT NULL, norm_title TEXT NOT NULL,
  json TEXT NOT NULL,             -- full TrackRecord
  resolved_at INTEGER NOT NULL
);
CREATE INDEX tracks_norm ON tracks(norm_artist, norm_title);
CREATE INDEX tracks_isrc ON tracks(isrc);

CREATE TABLE http_cache (
  cache_key TEXT PRIMARY KEY,     -- sha1(method + url + relevant headers)
  url TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX http_cache_exp ON http_cache(expires_at);

CREATE TABLE fingerprints (
  track_key TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  json TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (track_key, model, prompt_version)
);

CREATE TABLE evidence (                -- Channel B raw search results (cache)
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, query TEXT NOT NULL,
  url TEXT NOT NULL, title TEXT, snippet TEXT, content TEXT,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX evidence_q ON evidence(provider, query);

CREATE TABLE mentions (                -- Channel B model-extracted mentions (cache)
  id INTEGER PRIMARY KEY, evidence_id INTEGER NOT NULL REFERENCES evidence(id),
  seed_key TEXT NOT NULL, artist TEXT NOT NULL, title TEXT NOT NULL,
  sentence TEXT, enthusiasm TEXT, model TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX mentions_seed ON mentions(seed_key);

CREATE TABLE verifications (           -- Stage 4 cache: (artist,title) -> track key or miss
  norm_artist TEXT NOT NULL, norm_title TEXT NOT NULL,
  track_key TEXT,                      -- NULL = verified miss
  checked_at INTEGER NOT NULL, PRIMARY KEY (norm_artist, norm_title)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY, seed_key TEXT NOT NULL, options_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX runs_seed ON runs(seed_key, options_hash, engine_version);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE playlist_items (
  id INTEGER PRIMARY KEY, playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_key TEXT NOT NULL REFERENCES tracks(key), position INTEGER NOT NULL,
  why TEXT, seed_key TEXT, added_at INTEGER NOT NULL
);
CREATE INDEX playlist_items_pl ON playlist_items(playlist_id, position);
```

Migrations are append-only; `001_init.sql` above is the starting point, not the current
shape. Since then:

- `003_counters.sql` — `run_counters (scope, bucket, count, updated_at)`, the durable half
  of the deployed instance's cost caps.
- `004_mention_source.sql` — a mention carries its own source. `mentions.evidence_id` is
  now NULLABLE and `mentions` gains `url` and `page_title`. A search provider whose terms
  forbid retaining its results (Brave) therefore writes NO `evidence` row at all: the
  mention's `url` is the attribution its quotation needs, and `page_title` stays NULL
  wherever the provider's text may not be stored. Tavily is unchanged — its results are
  still cached in `evidence` for 30 days and its mentions still point at them.

## Environment (`src/lib/env.ts`)

Read from `.env.local`. All optional except the model key; missing keys degrade features
and are reported by `GET /api/health` and in the UI.

| Var | Used by | Missing → |
|---|---|---|
| `ANTHROPIC_API_KEY` | engine | recommendations unavailable; search/resolve/preview/playlists still work |
| `ITSTINGS_MODEL` | engine | defaults to `claude-opus-5` |
| `LASTFM_API_KEY` | Channel A, tags | Channel A skipped; fingerprint loses tags |
| `TAVILY_API_KEY` (primary) / `BRAVE_SEARCH_API_KEY` (fallback) | Channel B | Channel B skipped |
| `ITSTINGS_FALLBACKS` | engine | defaults on; see docs/model.md |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | resolve (deep link) | Spotify link falls back to `open.spotify.com/search/...` |
| `GETSONGBPM_API_KEY` | tempo fallback | tempo falls through to AcousticBrainz or unknown |


## Rate limits and caching (http/fetchExternal.ts)

- `fetch` is called WITHOUT a `cache` option: Next's patched fetch never caches in route
  handlers by default, and `cache: 'no-store'` makes it add `cache-control: no-cache` +
  `pragma: no-cache` upstream, which bypasses iTunes' Akamai edge cache (verified).
- Every `/api/*` response sets `Cache-Control: no-store` explicitly (Next adds none).

- MusicBrainz: strictly serial, ≥1100 ms between requests, fixed User-Agent.
- Deezer: ≤45 requests per 5 s. iTunes: ≤20 requests per minute *for typeahead*; the
  verifier prefers Deezer and only falls back to iTunes on a miss.
- Last.fm: ≤4 requests per second. Web search: ≤1 request per second.
- TTLs: iTunes/Deezer search 7 days; track lookups 30 days; MusicBrainz/AcousticBrainz 90
  days; Last.fm similar/tags 30 days; web search 30 days; Spotify search 30 days; Deezer `/track/{id}` 13 minutes when
  used for preview minting (the metadata fields are also persisted in `tracks`).
- Every external failure is caught at the source layer and returned as `{ ok: false,
  reason }`; nothing above `sources/` throws on a network error.
