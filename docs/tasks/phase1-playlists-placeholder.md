# Phase 1 — task C: playlist API, run API, placeholder recommender, SSE route

Owner: one subagent. Starts after task A (core) has landed. Runs in parallel with task B —
touch ONLY the files listed under "Files you own". Task B is simultaneously building
`src/lib/sources/*` and `src/lib/resolve/*`; code against the signatures written in
`docs/tasks/phase1-sources.md` and do not create those files yourself. If they are not on
disk yet when you need to run something, wait and retry (poll every 30 s for up to 20 min)
rather than stubbing them.

## Read first
`docs/spec.md` (Playlist, Interface → streaming, The engine → Stage 5 ranking rules),
`docs/architecture.md` (Shared types, Streaming protocol, Pipeline behaviour, Code-enforced
ranking rules, Database schema), the code task A produced under `src/lib`.

## Goal
1. Complete playlist CRUD + export API (this IS the Phase 4 backend; Phase 4 adds UI).
2. The run API and the SSE recommend route that speak the exact `PipelineEvent` protocol.
3. `engine/rank.ts` — the pure, code-enforced ranking rules, fully unit-tested now so the
   Phase 3 engine drops onto a proven ranker.
4. A PLACEHOLDER recommender so Phase 2 can ship a usable UI before the engine exists. It
   must exercise the whole streaming protocol honestly and label itself as a placeholder.

## Files you own
```
src/app/api/playlists/route.ts
src/app/api/playlists/[id]/route.ts
src/app/api/playlists/[id]/items/route.ts
src/app/api/playlists/[id]/export/route.ts
src/app/api/runs/[id]/route.ts
src/app/api/recommend/route.ts
src/lib/engine/rank.ts
src/lib/engine/pipeline.ts            (placeholder implementation; Phase 3 replaces the body, keeps the signature)
src/lib/engine/placeholder.ts
src/lib/engine/__tests__/rank.test.ts
src/lib/engine/__tests__/pipeline.test.ts
src/lib/sse.ts                        (helper: ReadableStream + encoder for text/event-stream)
scripts/recommend.ts                  (CLI: streams events for a seed to stdout)
```

## Playlists API
- `GET /api/playlists` → `{ playlists: [{ id, name, count, createdAt, updatedAt }] }`
- `POST /api/playlists` `{ name }` → `{ playlist }` (name trimmed, 1–80 chars, duplicates allowed)
- `GET /api/playlists/[id]` → `{ playlist, items: [{ id, position, track: TrackRecord (preview hydrated), why, seedKey, addedAt }] }`
- `PATCH /api/playlists/[id]` `{ name? , order?: number[] (item ids in new order) }` → `{ playlist }`
- `DELETE /api/playlists/[id]` → `{ ok: true }`
- `POST /api/playlists/[id]/items` `{ trackKey, why?, seedKey? }` → `{ item }` (track must exist in `tracks`; append at end; adding the same track twice is a no-op returning the existing item)
- `DELETE /api/playlists/[id]/items` `{ itemId }` → `{ ok: true }` (re-pack positions)
- `GET /api/playlists/[id]/export?format=txt|json`: txt is one line per item
  `Artist — Title (Year)` with a header line naming the playlist; json is
  `{ playlist, items: [{ artist, title, year, isrc, links, why, seedKey }] }`. Set
  `Content-Disposition: attachment; filename="<slug>.txt|json"`.
All bodies zod-validated; errors are JSON with proper status codes; ids that don't exist → 404.

## rank.ts (pure; the most important code in this task)
```ts
export const DIMENSION_WEIGHTS: Record<DimensionScore['dimension'], number> = {
  rhythmic_character: 3, vocal_delivery: 3, emotional_register: 2, scene_context: 2,
  signature_hook: 2, instrumentation: 1, harmonic_language: 1, production_texture: 1, era: 0 };
export const CHANNEL_BONUS = 0.12; export const ENTHUSIASM_BONUS = 0.05;
export const SAME_ARTIST_MIN_SCORE = 0.85;
export const GENRE_ONLY_TERMS = [ ...genre names, decades ('80s','1980s'), 'vibe','vibes','mood','style','energy','feel','sound','similar','era','genre','indie','alternative','rock','pop','jazz','punk','swing','electronic','dance', ... ];
export function modelScore(dimensions: DimensionScore[]): number   // weighted mean, 2-dp
export function finalScore(rec, opts: { liveChannels: Channel[] }): number   // modelScore + CHANNEL_BONUS*(channels-1) + ENTHUSIASM_BONUS if a forum evidence with enthusiasm 'high' came from a channel in liveChannels; cap 1
export function isGenreOnly(rec): boolean        // sharedTraits empty or all in GENRE_ONLY_TERMS, OR fewer than 2 dimensions >= 0.6
export function rank(recs: Recommendation[], seed: TrackRecord, opts: RunOptions & { liveChannels: Channel[] }): { results: Recommendation[]; cut: { rec: Recommendation; reason: string }[] }
```
`rank` applies architecture.md rules 1–6 in order and records every cut with its reason
(`same-artist`, `same-artist-below-bar`, `duplicate-artist`, `genre-only`, `spread-demoted`).
`Recommendation` gains `sharedTraits: string[]` (add it to `types.ts` — a small owned
change; report it). Spread pass: sort by finalScore; walk the list keeping a running count
per decade and per primary genre label; an item that would push either bucket above 40% of
the target length (20) is demoted to a second pass; second-pass items fill remaining slots
in score order; cut to 20; never fewer than 8 if 8 survived (relax spread first, then the
dimension threshold). Tests cover every rule with hand-built fixtures, including "The Cure"
vs "Cure" vs "The Cure feat. X" same-artist detection, the higher bar when
`includeSameArtist`, the +0.12/+0.05 arithmetic, genre-only cuts ("similar mood and style"
→ cut), and spread demotion.

## pipeline.ts (signature is the contract; Phase 3 keeps it)
```ts
export const ENGINE_VERSION = 'placeholder-0';
export interface PipelineDeps { /* injected for tests: resolveTrack, verifyMany, sources, model */ }
export async function runPipeline(args: { seedKey: string; options: RunOptions; onEvent: (e: PipelineEvent) => void; signal?: AbortSignal; deps?: Partial<PipelineDeps> }): Promise<RunRecord>
```
Behaviour now (placeholder): emit `run` (checking `runs` cache first: same seedKey +
options hash + ENGINE_VERSION → replay the stored RunRecord as the full event sequence with
`cached: true`), `stage resolve` → `seed` (via `resolveTrack`/tracks repo), `stage
fingerprint` → a `fingerprint` whose text fields all read "placeholder — engine not built
yet", `confidence` all `low`, `tempo_bpm`/`era` copied from the record (never invented),
then a single channel `C` marked `status:'done'` whose candidates come from
`engine/placeholder.ts`: Deezer `artist/{id}/related` top tracks (keyless) → up to 15
candidates → `verifyMany` → `Recommendation`s with `why: "placeholder: same Deezer related-artist cluster — not a musical judgement"`,
`dimensions` all 0.5 with note "placeholder", `sharedTraits: []`, channels `['C']`. Run them
through `rank` with `isGenreOnly` DISABLED for the placeholder (pass an option) so the UI
has something to render, emit provisional `result`s as they verify, then `final` with
`degraded: ['placeholder recommender — the real engine arrives in Phase 3']`, persist the
RunRecord, emit `stage done`. Same-artist exclusion and one-per-artist ARE enforced even
in the placeholder.

## recommend route + sse.ts
`GET /api/recommend?seed=<key>&sameArtist=0|1` → `text/event-stream`; `data: <json>\n\n`
per event; heartbeat comment `: ping\n\n` every 15 s while running; closes after `stage
done`; aborts the pipeline via `AbortSignal` when the client disconnects; headers
`Cache-Control: no-store`, `X-Accel-Buffering: no`. Verify in dev with
`curl -N 'http://127.0.0.1:3123/api/recommend?seed=<key>'` that events arrive
incrementally (not all at once at the end) — api-reality §8 confirms streaming works in
Next dev; if buffering appears, fix it (e.g. `export const dynamic = 'force-dynamic'`).
`GET /api/runs/[id]` → the RunRecord.

## scripts/recommend.ts
`npx tsx scripts/recommend.ts "The Cure" "The Lovecats"` resolves the seed then runs the
pipeline printing one line per event and the final table (rank, artist — title, year,
finalScore, channels, why).

## Tests
rank.test.ts as above; pipeline.test.ts drives `runPipeline` with injected fake deps and
asserts the exact event ORDER from architecture.md "Streaming protocol", the cache replay
path (`cached: true`, identical results), and abort handling.

## Prove it
`npm run typecheck && npm test && npm run build`; start dev on 3123; create a playlist,
add the Lovecats track (resolve it first via `POST /api/resolve`), reorder, export txt and
json, delete; stream a placeholder recommendation for it with `curl -N`; kill the dev
server; confirm nothing left listening.

## Report back
Commands and outcomes; the curl transcript of the SSE stream (first 10 events + last 3);
the export txt output; the list of rank rules with their test names; any change to files
you don't own; anything undone.
