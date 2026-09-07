# Phase 1 — task B: external sources + resolver + verification

Owner: one subagent. Starts after task A (core) has landed. Runs in parallel with task C —
touch ONLY the files listed under "Files you own".

## Read first
`docs/spec.md`, `docs/architecture.md` (Shared types, Resolver flow, Preview audio,
External API behaviours, Rate limits and caching), `docs/api-reality.md` sections 3.1–3.5
and the Verified commands appendix, then the code task A produced in `src/lib/http`,
`src/lib/db`, `src/lib/util/normalize.ts`, `src/lib/types.ts`, `src/lib/env.ts`.

## Goal
Every external source wrapped as a typed, cached, rate-limited, failure-tolerant client;
the resolver that joins them into a `TrackRecord`; the Stage-4 candidate verifier; and the
three routes that expose them. Everything works with ZERO API keys (Last.fm/Spotify/
GetSongBPM/Tavily clients exist and degrade cleanly).

## Files you own
```
src/lib/sources/itunes.ts
src/lib/sources/deezer.ts
src/lib/sources/musicbrainz.ts
src/lib/sources/acousticbrainz.ts
src/lib/sources/lastfm.ts
src/lib/sources/spotify.ts
src/lib/sources/websearch.ts
src/lib/sources/getsongbpm.ts
src/lib/sources/__fixtures__/*.json          (recorded real responses, see Tests)
src/lib/sources/__tests__/*.test.ts
src/lib/resolve/resolveTrack.ts
src/lib/resolve/verifyCandidate.ts
src/lib/resolve/hydratePreview.ts
src/lib/resolve/__tests__/*.test.ts
src/app/api/search/route.ts
src/app/api/resolve/route.ts
src/app/api/preview/route.ts
scripts/resolve.ts                            (CLI: npx tsx scripts/resolve.ts "The Cure" "The Lovecats")
scripts/verify.ts                             (CLI: npx tsx scripts/verify.ts "Louis Prima" "Jump, Jive an' Wail")
```
If you need a change in a file you don't own (types, env, http seam), make the smallest
possible change and list it explicitly in your report.

## Source client rules (all of them)
- Every function goes through `fetchExternal`. No direct `fetch` anywhere in `sources/`.
- Every response is parsed with a zod schema that is PERMISSIVE (`.passthrough()`, optional
  fields) — we validate the fields we use, we don't reject responses for extra fields.
- Return shapes are `{ ok: true, value } | { ok: false, reason }`; never throw for network
  or upstream errors. A missing key returns `{ ok: false, reason: 'no_api_key' }` without
  making a request.
- TTLs from architecture.md. Deezer `/track/{id}` is cached 13 minutes when fetched for
  preview minting; the resolver's persisted TrackRecord stores the Deezer id, never the
  signed preview URL.
- Each client exports a `describe()` returning `{ name, needsKey, configured }` for
  `/api/health`.

### itunes.ts
`searchSongs(term, { limit=8, country='US' })` → typeahead hits `{ itunesId, title, artist,
album, artworkSmall (200x200), artworkLarge (600x600), previewUrl, durationMs, releaseYear,
url }`. `lookupById(id, country='US')`. Normalise the query string (trim, collapse spaces)
and sort params so Akamai edge caching hits (api-reality §3.1). Response body begins with
newlines — `JSON.parse` after `.trim()`.

### deezer.ts
`searchTrack(artist, title)` (advanced syntax first, plain fallback), `getTrack(id)`
(returns `isrc`, `bpm` as number|null with 0→null, `release_date`, `preview`, `duration`,
`title_short`, artist, album cover URLs, `link`), `getTrackByIsrc(isrc)`. Handle
HTTP-200-with-error bodies; `code 4` (quota) is retryable via `isRetryableBody`.
`pickBestMatch(hits, { artist, title, durationMs? })` implements the architecture.md rule:
normalised title must match; prefer duration within ±3 s; penalise titles containing
live|remix|mixed|karaoke|tribute|cover|instrumental unless the query contains them; prefer
the original artist name match; prefer higher `rank`.

### musicbrainz.ts
`lookupByIsrc(isrc)` → recordings with artist-credit, first-release-date, tags, genres,
isrcs. `searchRecording(artist, title)` (Lucene query `recording:"..." AND artist:"..."`),
accept only a normalise-matched top hit. `getRecording(mbid)`. Strictly through the
limiter; retry 503 up to 5× (the http layer does this if you pass `retries: 5`), which is
the budget and the 1.2 / 2.4 / 4.8 / 6 / 6 s ladder docs/architecture.md fixes — api-reality
addendum B4 measured runs of three consecutive 503s, so 3 retries had no margin.
Fixed User-Agent constant. Never more than one MB request in flight.

### acousticbrainz.ts
`getHighLevel(mbid)`, `getLowLevel(mbid)` → `{ bpm, key, scale, danceability, moods:
{ happy, sad, aggressive, relaxed }, genreLabels }` picking the documented JSON paths from
api-reality §3.3. 404 → `{ ok:false, reason:'not_in_dataset' }` (not an error to surface).

### lastfm.ts
`getTopTags(artist,title)`, `getSimilar(artist,title,{limit=50})`, `getTagTopTracks(tag,
{limit=50})`, `getTrackInfo(artist,title)`. `autocorrect=1`. Key presence checked locally
first (api-reality §3.4: upstream error 6 is ambiguous). Error 10 → reason `invalid_api_key`.
Parse the real shapes from the docs (`similartracks.track[]`, `toptags.tag[]`, `tracks.track[]`).

### spotify.ts
Client-credentials token (cached in memory + http_cache until expiry) only if
`SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are set; `searchTrack(artist,title)` with
`limit=10` max → `{ id, url }`. Keyless helpers that always work: `searchDeepLink(artist,
title)` → `https://open.spotify.com/search/<encoded "artist title">`, `embedUrl(id)`,
`oembed(url)` (validates an id: 404 → invalid). PKCE/OAuth is Phase 6 — not here.

### websearch.ts
`search(query, { provider?, maxResults=8, includeDomains? })` → `{ provider, results: [{ url,
title, snippet, content?, score? }] }`. Tavily primary (`search_depth: 'basic'` pinned,
`include_raw_content: true`, `include_domains` when given), Brave fallback (web search,
`count`, `extra_snippets` if the plan allows). Provider selection from `env.keys.websearch`.
Tavily results may be cached (TTL 30 days). Brave results are `noStore: true` (its ToS
forbids retention — api-reality §1); Channel B will persist only its own extracted
mentions for Brave. Never fetch result URLs yourself; Channel B works only from what the
provider returns.

### getsongbpm.ts
Host `https://api.getsong.co/`. `lookup(artist,title)` → `{ bpm: number|null, key: string|null,
timeSig, url }` (`tempo` arrives as a string — parse; reject NaN/0). Export
`ATTRIBUTION = { text: 'Tempo data by GetSongBPM', href: 'https://getsongbpm.com' }` for the
footer. No request without a key.

## resolveTrack.ts
`resolveTrack(input: { itunesId?: number; deezerId?: number; isrc?: string; artist: string;
title: string; durationMs?: number }, opts?: { force?: boolean }) → Promise<{ ok: true;
track: TrackRecord } | { ok: false; reason }>` implementing architecture.md "Resolver flow"
step by step, in this order, each step optional-on-failure with the failure appended to
`track.degraded`:
1. iTunes lookup (if itunesId) for canonical title/artist/artwork/previewUrl/releaseDate/duration.
2. Deezer match → id, isrc, bpm, release_date, cover, link. Key = `isrc:<ISRC>` if isrc, else
   `deezer:<id>`, else `itunes:<id>`.
3. If a `tracks` row exists for the key and `!force` and it is < 30 days old → return it
   (hydrated preview) immediately.
4. MusicBrainz by ISRC, else search. 5. AcousticBrainz. 6. Last.fm tags (if key).
7. Spotify (if creds) else deep link. 8. Tempo/year/key resolution with `Sourced` provenance
   exactly as architecture.md says. 9. Upsert into `tracks`. 10. Return with `hydratePreview`.

Steps 4–7 run concurrently where they don't depend on each other (MB → AB is sequential;
Last.fm and Spotify are independent). Total wall time for a cold resolve should be under
~6 s with all keyless sources reachable; log per-step timings.

## hydratePreview.ts
`hydratePreview(track)`: if the record has a Deezer id, mint a fresh preview via
`deezer.getTrack` (13-min cache) → `{ url, source: {source:'deezer', id}, expiresAt:
fetchedAt + 14*60*1000 }`; else iTunes previewUrl with `expiresAt: null`; else `null`.
Never persists the Deezer URL.

## verifyCandidate.ts
`verifyCandidate({ artist, title }) → Promise<{ ok: true; track: TrackRecord } | { ok: false;
reason: 'not_found' | 'ambiguous' | 'error' }>`: check `verifications` cache (30-day TTL,
misses cached too) → `tracks.findByNorm` → Deezer search + `pickBestMatch` (require artist
AND title normalise-match) → on Deezer miss, iTunes search with the same match rule → on
hit, run `resolveTrack` (which caches) → write the verification row. Concurrency-safe: a
`verifyMany(candidates, { concurrency: 6 })` helper that dedupes by `trackNormKey` before
fanning out. Log a per-call line `verify <artist> — <title>: hit deezer:<id> | miss`.

## Routes
- `GET /api/search?q=` → `{ hits: TypeaheadHit[] }`; `q` shorter than 2 chars → `{ hits: [] }`
  without calling iTunes; 8 results; `Cache-Control: no-store`.
- `POST /api/resolve` body `{ itunesId, artist, title, durationMs }` (zod-validated) →
  `{ track: TrackRecord }` or `{ error }` with 4xx/5xx.
- `GET /api/preview?key=` → `{ url, source, expiresAt } | { url: null }`.
All three: no key ever leaves the server; every error is JSON.

## Tests (vitest, no network)
Record real responses ONCE with a script (`scripts/record-fixtures.ts`, allowed to hit the
network) into `__fixtures__/` for: iTunes search "the cure lovecats"; Deezer search +
/track for The Lovecats, "vampire" (bpm 0), and a "Lone Digger (Mixed)" style wrong-hit
case; MusicBrainz /isrc for The Lovecats' ISRC; AcousticBrainz high/low-level for its MBID
and a 404 case; a Deezer `code 4` quota body; a Last.fm error-6 and error-10 body; a Tavily
401 body. Tests inject the fixtures via `setFetchImpl` and cover: every client's happy path
and failure path; `pickBestMatch` preferring the original over the "(Mixed)" DJ edit and
over a live version; the resolver assembling a full TrackRecord with correct `Sourced`
provenance and `degraded` entries when MB/AB fail; `hydratePreview` never persisting the
URL; `verifyCandidate` caching misses and rejecting a wrong-song title match.

## Prove it live (allowed: real network, keyless)
`npx tsx scripts/resolve.ts "The Cure" "The Lovecats"` prints the TrackRecord with
`isrc`, `tempoBpm` (with source), `year` (with source), `ids.mbid`, AB features, preview
URL. Also run it for "Olivia Rodrigo" "vampire" (expect tempo unknown, no AB) and "Louis
Prima" "Jump, Jive an' Wail". Then `npx tsx scripts/verify.ts` for three real and three
invented tracks (e.g. "The Cure" "Purple Marmalade Sunrise") — the invented ones must miss.
Run `npm run typecheck && npm test && npm run build` last.

## Report back
Commands run and outcomes; the printed TrackRecord for The Lovecats; verify results for the
six candidates; timings; fixture list; any change to files you don't own; anything undone.
