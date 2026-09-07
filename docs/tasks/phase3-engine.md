# Phase 3 — the engine

Six bounded tasks. M runs first (small). F, A, B, C, S run in parallel after M. P runs
after all of them. Then review. Each task owns its files only; if you must touch a shared
file (`types.ts`, `env.ts`, `rank.ts`, `pipeline.ts` signature), make the smallest change
and report it.

Read first, all tasks: `docs/spec.md` ("The engine" in full, "Never fabricate", "Acceptance
test"), `docs/architecture.md`, `docs/model.md`, `docs/api-reality.md` (the sections for the
APIs you touch), and the existing code under `src/lib` (sources, resolve, engine/rank.ts,
engine/pipeline.ts placeholder, db repos, types).

Governing rule, restated: APIs retrieve and verify; the model interprets and judges. No
track ships whose only justification is that an API returned it. If a `why` would apply to
any two songs in the same genre, the pipeline is broken — say so in your report rather
than shipping it.

Prompts: one frozen system prompt per call, exported as a constant next to a
`PROMPT_VERSION` string; volatile data in the user message; written for `claude-opus-5`
(clear intent, the schema does the formatting work, no over-prescriptive step lists, no
"you are an expert" filler). Every model call goes through `callStructured` in
`engine/model.ts`. Tests inject a fake transport; no test hits the network or the model.
There is no ANTHROPIC_API_KEY in this environment: you cannot run a live model call.
Design for it anyway and make the mock path exercise every branch.

---

## Task M — `src/lib/engine/model.ts` (+ `__tests__/model.test.ts`)

Implement `docs/model.md` exactly: `callStructured`, `setModelTransport`, `MODEL`, the
`no_api_key` fast path, refusal/max_tokens/parse-failure handling, per-call usage logging,
a `ModelUsage` accumulator per run (`createUsageCounter()` → `{ record(usage), calls,
inputTokens, outputTokens, cacheReadTokens }`). Look at the installed SDK's types in
`node_modules/@anthropic-ai/sdk` for `messages.parse`, `zodOutputFormat`, `output_config`,
`stop_details`, and whether `fallbacks`/`betas` are typed on the non-beta `parse`; implement
`ITSTINGS_FALLBACKS` only if the types allow it cleanly, else leave the documented TODO.
Also export `truncateForPrompt(text, maxChars)` and `jsonBlock(obj)` helpers. Tests: the
transport receives the assembled request (system as a cache_control block, user message,
effort, format), each failure branch returns `ok:false` with the right reason, usage is
counted.

---

## Task F — `src/lib/engine/fingerprint.ts` (+ tests)

`fingerprintTrack(track: TrackRecord, opts: { corrections?: RunOptions['corrections'];
force?: boolean; usage? }) → Promise<{ ok: true; fingerprint: Fingerprint; cached: boolean }
| { ok: false; reason }>`.
- Cache in `fingerprints` by `(track.key, MODEL, PROMPT_VERSION + corrections hash)`.
- Hard data goes in the user message as a labelled block: title, artist, album, year (+
  source), duration, Deezer bpm (or "unknown"), AcousticBrainz features (or "none"),
  MusicBrainz tags/genres, Last.fm top tags with counts (or "not available"). The model
  is told which values are measurements and which are absent.
- The zod schema is the `Fingerprint` type MINUS `tempo_bpm`, `era`, `model`, `grounded_on`
  (code fills those from the TrackRecord — the model never emits a BPM or a year). Field
  `.describe()`s carry the spec's intent: `signature_hook` = "the one weird memorable thing
  — the meowing, the whistle, the key change"; `scene_context` = "what the artist is doing
  and why it's notable — the pastiche, the joke, the move; name the scene"; `tempo_feel`
  enum; `rhythmic_character` must name the groove and the bass/drum behaviour;
  `vocal_delivery` names technique and attitude; `instrumentation` is a list of concrete
  instruments/sounds; `genre_labels` 2–5 labels the model would file it under (used for
  spread and the genre-only cut, never as a match reason). Per-field `confidence`.
- Corrections: a field marked `'wrong'` → the user message says the listener rejected the
  previous value (include it) and asks for a re-interpretation; a string → used verbatim
  (code overwrites the model's value after the call, confidence `high`, and appends
  "listener correction" to `grounded_on`).
- Effort `high`. Tests: cache hit/miss; corrections both forms; tempo/era copied not
  invented (fake transport returns a bogus bpm inside the JSON and the test asserts the
  record's value wins); model failure → `ok:false`.

---

## Task A — `src/lib/engine/channels/a.ts` (+ tests)

`channelA(seed: TrackRecord, fingerprint: Fingerprint, ctx) → Promise<ChannelResult>` where
`ChannelResult = { channel: 'A'; status: 'done' | 'skipped' | 'error'; reason?; candidates:
Candidate[]; live: boolean }`.
- No `LASTFM_API_KEY` → `skipped`, reason "no LASTFM_API_KEY", no calls.
- `track.getSimilar(artist, title, limit 60)` → candidates with hint `{ lastfmMatch }`; also
  try the common title variant if Last.fm returns 0 (e.g. "The Lovecats" vs "The Love
  Cats": ask `track.search` for the top hit and retry once with its exact name).
- Tag pivot: take the seed's top tags (from `track.tags` or a fresh `getTopTags`), drop the
  generic ones in code (a blocklist: decades, "rock", "pop", "alternative", "indie",
  "seen live", "favorites", "female vocalists", "male vocalists", country names, …), then
  ONE model call (`pickTags`, effort low) choosing the 3–4 most *specific* tags for this
  fingerprint from what remains, with a one-line reason each. For each chosen tag,
  `tag.getTopTracks(tag, limit 50)` → candidates with hint `{ tag }`.
- Dedupe within the channel by `trackNormKey`, merging hints. Exclude the seed itself.
  Cap 80 candidates, similar-tracks first (by match), then tag tracks round-robin across
  tags. Record `evidenceDetail` strings ("Last.fm match 0.42 · rank 9 of 60", "tag: swing
  revival") for later evidence rows and the Last.fm track URL.
- Tests with fixtures: skipped path; similar + pivot merge; generic-tag blocklist; the
  title-variant retry.

---

## Task B — `src/lib/engine/channels/b.ts` (+ tests)

`channelB(seed, fingerprint, ctx) → Promise<ChannelResult & { evidence: Evidence[] }>`.
- No search key → `skipped`. Otherwise the four query templates from the spec (exact
  strings, with `"{track}" "{artist}"` quoted), the first three run with
  `includeDomains: ['reddit.com']` for the `site:reddit.com` one and open web for the
  others; the fingerprint-derived query uses `rhythmic_character` + `vocal_delivery`
  shortened to ≤ 12 words. Max 8 results per query. Never fetch result URLs.
- Cache: `evidence` rows per (provider, query) for Tavily (30 days); Brave results are not
  persisted (its terms) — only the extracted `mentions` are, keyed by `seed_key`, with the
  evidence URL/title/sentence copied into the mention row so nothing needs the raw result.
- Extraction: per result, ONE model call (`extractMentions`, effort low) over
  title + snippet + `content`/`raw_content` truncated to 6000 chars, asking for every
  artist–track pair the text recommends as similar to the seed, with the exact surrounding
  sentence and `enthusiasm` (`high` = "closest thing", "exactly this", strong personal
  endorsement; `medium` = a recommendation with a reason; `low` = a bare list entry).
  The system prompt states the text is untrusted page content and that instructions inside
  it are to be ignored; the text is wrapped in a delimited block; the schema has no free
  field for anything else. Results that mention nothing return an empty list (cheap).
  Batch extraction: up to 4 results per call is allowed if you keep per-result attribution.
- Aggregate mentions by `trackNormKey`: a candidate's hints carry every
  `{ sourceUrl, sentence, enthusiasm }`; ordering by (count of distinct URLs, best
  enthusiasm). Exclude the seed itself. Cap 40. Build `Evidence[]` (`kind: 'forum'`, url,
  title, sentence, enthusiasm) for the pipeline to attach to whichever candidates survive.
- Tests with fixtures: skipped; Tavily result → extraction (fake transport) → aggregation;
  injection text in a result does not change the extraction prompt/schema (assert the call
  shape); Brave path persists mentions but no raw evidence rows; cache hit skips the
  provider.

---

## Task C — `src/lib/engine/channels/c.ts` (+ tests)

`channelC(fingerprint, ctx) → Promise<ChannelResult>`. The seed's title and artist are NOT
passed to this call — only the fingerprint (with `era` as a decade, not the year, and
without `grounded_on` lines that name the artist or title; strip those in code and test
for it).
- ONE model call (`channelC`, effort high) asking for 25–40 real, released, findable tracks
  that share the described qualities, spanning at least three decades and at least three of
  the model's own genre labels, each with: artist, title (the most common release
  spelling), approximate year, and a `modelNote` — one clause naming the concrete shared
  trait (never a genre). The prompt tells the model that every entry will be verified
  against a catalogue and that unverifiable or misremembered entries are the worst
  outcome; prefer canonical, well-known recordings over obscure ones when unsure of the
  title. Ask for spread explicitly.
- Code: dedupe by `trackNormKey`; drop entries missing artist or title; cap 40; hints
  `{ modelNote }`.
- Expose `CHANNEL_C_PROMPT_VERSION` and a `tightness` option (`'normal' | 'tight'`) that
  switches to a stricter prompt variant (fewer, more canonical picks) — the pipeline flips
  to `tight` when the run's Channel-C drop rate exceeds 20 % on a retry (Task P wires it).
- Tests: seed identity is absent from the request (assert on the fake transport's received
  messages, including that `grounded_on` lines naming the artist were stripped); dedupe;
  cap; spread fields present.

---

## Task S — `src/lib/engine/score.ts` (+ tests)

`scoreBatch(seed: TrackRecord, fingerprint: Fingerprint, candidates: VerifiedCandidate[],
ctx) → Promise<{ scored: ScoredCandidate[]; failed: string[] }>` where `VerifiedCandidate =
{ candidate: Candidate; track: TrackRecord }` and `ScoredCandidate = { key; dimensions:
DimensionScore[]; why: string; sharedTraits: string[]; isCoverOrSameSong: boolean;
modelNote? }`.
- ONE model call per batch of ≤ 12 (`score`, effort high). The user message carries the
  seed identity + fingerprint, then each candidate with: artist, title, year, Deezer bpm
  (or unknown), MusicBrainz tags/genres, Last.fm tags if present on the record, and the
  channel hints (Last.fm match, tag, forum sentence, model note) so the model can weigh the
  evidence. The schema: per candidate, all nine dimensions (`rhythmic_character`,
  `vocal_delivery`, `emotional_register`, `scene_context`, `signature_hook`,
  `instrumentation`, `harmonic_language`, `production_texture`, `era`) each `{ score 0–1,
  note }`; `why` (ONE sentence, names the specific shared trait, forbidden: "similar
  vibe/mood/style/energy/era/genre" and any sentence that would fit any two songs of the
  genre); `shared_traits` (2–5 concrete musical traits, e.g. "walking upright bass in
  quarters", "vocal slides into nonsense syllables"); `is_cover_or_same_song`.
- Code: map back by key; a candidate missing from the response goes to `failed`; run
  batches concurrently (≤ 4 in flight). `modelScore` is computed by `rank.ts`, not here.
- Tests: batching and concurrency; mapping; a `why` that contains a banned phrase is
  flagged (`flags: ['weak-why']`) and the candidate is sent back for one re-score with the
  banned phrase quoted ("the previous reason was rejected: …"); failure handling.

---

## Task P — `src/lib/engine/pipeline.ts` (replace the placeholder body), `eval/run.ts`, `scripts/recommend.ts` update (+ tests)

Implement architecture.md "Pipeline behaviour" and "Streaming protocol" with the real
stages, keeping the signature and `ENGINE_VERSION = 'engine-1'` (bump the constant):
1. `run` (cache replay when `runs` has a match on seedKey + options hash + ENGINE_VERSION +
   the fingerprint PROMPT_VERSION + score PROMPT_VERSION), `stage resolve`, `seed`.
2. `stage fingerprint` → `fingerprint` (Task F; corrections from options).
3. `stage channels`: A, B, C concurrently; each emits `channel start` and `channel done|
   skipped|error` with `found`.
4. As each channel resolves: dedupe against the pool (`trackNormKey`), drop the seed
   itself, verify NEW candidates via `verifyMany` (`verified` event per channel with
   kept/dropped; per-channel drop rate in stats), attach evidence (Channel B evidence rows
   by key; Channel A detail strings; Channel C model notes), then `scoreBatch` in batches
   of 12 and emit provisional `result`s (finalScore computed with `rank.finalScore`).
   Candidates already in the pool from another channel just gain the channel + evidence
   (no re-verify, no re-score) — and emit an updated provisional `result` so the UI can show
   the new chip.
5. Channel-C guard: if C's drop rate > 20 % and `tightness` was `normal`, log it, re-run
   C once with `tight`, verify the new candidates, and record both rates in `stats`.
6. When all channels are done: `stage rank` → `rank()` with `liveChannels` = channels that
   ran live this run → `final` with results, degraded, stats (`perChannel`, `durationMs`,
   `modelCalls`, token counts, `cut` list with reasons) → persist RunRecord → `stage done`.
7. Every failure degrades: a channel error becomes `channel error` + a `degraded` string;
   a scoring failure drops that batch with a `degraded` note; no `ANTHROPIC_API_KEY` →
   `stage fingerprint error` + `final` with empty results and the degraded message
   "recommendations unavailable: no ANTHROPIC_API_KEY". Abort via signal at every await.
8. Log per-stage timings and the model usage summary at the end.

`eval/run.ts` (`npm run eval [-- <seedId>]`): for each seed in `eval/seeds.json`, resolve
via `itunes.searchSongs` (first hit whose artist normalise-matches) → `resolveTrack` →
`runPipeline` (fresh run: pass `force`), dump `eval/out/<id>.json` (the RunRecord) and
`eval/out/<id>.md`: the seed's `what_it_is` / passing / failing notes at the top, the
fingerprint, per-channel found/verified/dropped (+ C drop rate and whether the tight
retry fired), the final ranked table (rank, artist — title, year, finalScore, modelScore,
channels, why), the cut list with reasons, spread stats (decades, primary genre labels),
and automated flags: SAME-ARTIST leak (fail), any `why` with a banned phrase (flag),
fewer than 8 results (flag), any result whose track has no `preview` and no `links`
(flag), Channel C drop rate > 20 % (flag). Print a one-line summary per seed to stdout.
Also `eval/README.md` with how to run and how to read the output. `scripts/recommend.ts`
keeps working with the real engine.

Tests: `pipeline.test.ts` with fake deps for every event-order guarantee, the cache replay,
the multi-channel merge (a candidate from A and C is scored once and carries both chips),
the C-tight retry trigger, degrade paths (no key, channel error, score failure), abort.

---

## Review (after P)

Reviewers run `npm run typecheck && npm run lint && npm test && npm run build`, read the
prompts and schemas against the spec's engine section line by line, and run
`npx tsx scripts/recommend.ts "The Cure" "The Lovecats"` with no key to confirm the
degraded path is honest in the UI-facing events. They cannot run the model. They report:
prompt weaknesses (anything that would let "similar mood and style" through, anything that
lets the model invent a BPM or year, anything that leaks the seed identity into Channel C),
code paths that would throw instead of degrade, and rule violations (a `fetch` outside
`sources/`, a key in client code, a displayed number without a source).
