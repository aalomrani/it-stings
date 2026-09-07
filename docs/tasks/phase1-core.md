# Phase 1 — task A: core foundation

Owner: one subagent. Runs FIRST; two other tasks build on top of it in parallel.

## Read first
`docs/spec.md`, `docs/architecture.md` (the contract you are implementing), `docs/api-reality.md`
sections 1, 2 and 8 (toolchain), `docs/model.md`.

## Goal
A running Next.js 16 app in the project directory with the database, environment, HTTP
seam, shared types and normalisation utilities in place, tested, and `npm run dev` /
`npm run build` green. No UI beyond the default page. No sources, no engine.

## Files you own (create exactly these; do not create files outside this list except
what create-next-app generates)
```
package.json, package-lock.json, tsconfig.json, next.config.ts, eslint config, .gitignore,
.env.example, README.md, vitest.config.ts,
src/app/layout.tsx, src/app/page.tsx, src/app/globals.css   (leave as scaffolded; Phase 2 replaces them)
src/app/api/health/route.ts
src/lib/env.ts
src/lib/types.ts
src/lib/util/normalize.ts
src/lib/util/ids.ts
src/lib/db/index.ts
src/lib/db/migrations/001_init.sql
src/lib/db/repos/{tracks,httpCache,fingerprints,evidence,mentions,verifications,runs,playlists}.ts
src/lib/http/fetchExternal.ts
src/lib/http/rateLimit.ts
src/lib/**/__tests__/*.test.ts
```

## Steps
1. Scaffold in the scratch dir, then copy into the project dir WITHOUT touching `docs/` or
   `eval/`:
   `npx --yes create-next-app@latest itstings --ts --app --eslint --no-tailwind --src-dir --import-alias "@/*" --use-npm --yes`
   (adapt flags if the current CLI differs; report the exact command). Do not use Tailwind.
2. `npm install better-sqlite3 zod @anthropic-ai/sdk` and
   `npm install -D @types/better-sqlite3 vitest tsx`. Run
   `npm install-scripts approve better-sqlite3` (npm 11.19 gate — see api-reality §8) and
   make sure the approval lands in package.json. Verify better-sqlite3 loads:
   `node -e "require('better-sqlite3')(':memory:').prepare('select 1 as x').get()"`.
3. Scripts in package.json: `dev`, `build`, `start`, `lint`, `test` (vitest run),
   `test:watch`, `typecheck` (tsc --noEmit), `eval` (tsx eval/run.ts — the file arrives in
   Phase 3; the script entry exists now), `db:reset` (deletes `data/itstings.sqlite`).
4. `.env.example` listing every var from architecture.md's Environment table with a comment
   and the signup URL from api-reality §1. `.gitignore` adds `data/`, `.env.local`,
   `eval/out/`.
5. `src/lib/types.ts`: the shared types from architecture.md VERBATIM (copy them; add
   nothing, rename nothing). Export zod schemas alongside for `PipelineEvent`,
   `RunOptions`, `Fingerprint`, `Recommendation`, `TrackRecord` (schemas mirror the types;
   use `z.infer` checks so a drift fails typecheck).
6. `src/lib/env.ts`: zod-parsed `process.env` → `{ anthropicApiKey, model, lastfmApiKey,
   tavilyApiKey, braveApiKey, spotifyClientId, spotifyRedirectUri, getsongbpmApiKey,
   fallbacks }` plus `keys: { anthropic: boolean; lastfm: boolean; websearch: 'tavily' |
   'brave' | null; spotify: boolean; getsongbpm: boolean }`. Never throw on missing keys.
   Never import this from a client component (add a top-of-file `import 'server-only'`).
7. `src/lib/db/index.ts`: lazy singleton `getDb()` opening `data/itstings.sqlite` (create
   `data/` if missing; honour `ITSTINGS_DB_PATH` for tests, `:memory:` allowed), `PRAGMA
   journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`, runs migrations from
   `migrations/*.sql` in filename order tracked in a `schema_migrations` table. The
   schema is architecture.md's verbatim. Safe under Next dev hot reload (stash the handle on
   `globalThis`).
8. Repos: small typed functions, synchronous (better-sqlite3 is sync), JSON columns parsed
   with the zod schemas from types.ts. `tracks.upsert/get/getMany/findByNorm`,
   `httpCache.get/set/purgeExpired`, `fingerprints.get/set`, `evidence.find/insert`,
   `mentions.findBySeed/insertMany`, `verifications.get/set`, `runs.find/save/get`,
   `playlists.list/create/get/rename/delete/addItem/removeItem/reorder/items`. Playlist
   ids and run ids from `util/ids.ts` (`crypto.randomUUID()` based, prefixed `pl_` / `run_`).
9. `src/lib/http/rateLimit.ts`: `getLimiter(host)` returning `{ schedule<T>(fn) }`. Policies
   keyed by hostname: `musicbrainz.org` strictly serial with ≥1100 ms between request
   STARTS; `api.deezer.com` ≤45 per 5 s sliding window; `itunes.apple.com` ≤20 per 60 s;
   `ws.audioscrobbler.com` ≤4 per s; `api.tavily.com` and `api.search.brave.com` ≤1 per s;
   `acousticbrainz.org` ≤5 per s; default ≤10 per s. Process-wide singleton (globalThis),
   works under hot reload.
10. `src/lib/http/fetchExternal.ts` — THE seam. Signature:
    ```ts
    export interface ExternalRequest {
      url: string; method?: 'GET' | 'POST'; headers?: Record<string,string>; body?: string;
      ttlMs: number;                 // 0 = don't cache
      cacheKeyExtra?: string;        // e.g. provider name when the URL is not unique
      timeoutMs?: number;            // default 10000
      retries?: number;              // default 2, on network error / 5xx / 429 / 503 with backoff 1.2s, 2.4s, 4.8s
      okStatuses?: number[];         // default 200-299
      isRetryableBody?: (status: number, text: string) => boolean;   // e.g. Deezer code 4 in a 200
      noStore?: boolean;             // set for providers whose terms forbid caching (Brave/Exa)
    }
    export type ExternalResult =
      | { ok: true; status: number; text: string; json<T>(): T; fromCache: boolean; fetchedAt: number }
      | { ok: false; status: number | null; reason: string; fromCache: false };
    export async function fetchExternal(req: ExternalRequest): Promise<ExternalResult>
    export function setFetchImpl(fn: typeof fetch | null): void   // tests inject a fake
    ```
    Behaviour: cache lookup in `http_cache` (key = sha1 of method+url+body+cacheKeyExtra)
    → limiter for the URL's host → `fetch` with `cache: 'no-store'`, an AbortController
    timeout, and a default `User-Agent: ItStings/0.1 (local dev)` (constant) → retries →
    store on success when `ttlMs > 0 && !noStore`. Never throws; every failure is an
    `ok:false` with a human-readable `reason`. Log one line per real network call at
    debug level: host, status, ms, fromCache.
11. `src/lib/util/normalize.ts` (shared by resolver, verifier, dedupe and ranking — get it
    right and test it hard):
    - `normTitle(s)`: NFKD → strip combining marks → lowercase → replace `&` with `and` →
      remove any parenthetical/bracketed segment whose content matches
      /remaster|remastered|live|remix|edit|version|mono|stereo|feat\.?|featuring|demo|mix|radio|single|album|deluxe|explicit|clean|bonus|anniversary|\d{4}/ →
      remove a trailing ` - <anything matching the same list>` → strip punctuation except
      internal apostrophes are deleted (`don't` → `dont`) → collapse whitespace → trim.
    - `normArtist(s)`: same pipeline, then also cut at the first ` feat. | ft. | featuring | with | x | & | , | and ` (case-insensitive, whole-word) to get the PRIMARY artist, and drop a leading `the `.
    - `sameArtist(a,b)`, `sameTitle(a,b)`: equality of the normalised forms, plus `sameTitle`
      accepts one being a prefix of the other when the remainder is ≤ 4 chars of punctuation/space.
    - `trackNormKey(artist,title)` = `${normArtist}|${normTitle}`.
    Tests: "The Lovecats"/"The Love Cats" are NOT the same title (that's a real Last.fm
    ambiguity; the resolver handles it, not normalisation); "Golden Brown - 2018 Remaster"
    ≈ "Golden Brown"; "Kali Uchis feat. ..." → "kali uchis"; "The Cure" ≈ "Cure";
    "bad guy" ≈ "Bad Guy"; "telepatía" ≈ "telepatia"; "Jump, Jive an' Wail" ≈
    "Jump Jive An' Wail" ≈ "jump jive an wail".
12. `src/app/api/health/route.ts`: GET → `{ ok: true, keys, db: { path, tracks: n, runs: n },
    version }`. No network calls.
13. Tests (vitest, node environment, `ITSTINGS_DB_PATH=':memory:'`): migrations run twice
    idempotently; every repo round-trips; http cache hit/miss/expiry; rate limiter enforces
    MusicBrainz spacing (fake timers) and Deezer window; fetchExternal retries on 503 then
    succeeds, respects `noStore`, calls `isRetryableBody`; normalize cases above.
14. Prove it: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then
    `PORT=3123 npm run dev` in the background, `curl -s http://127.0.0.1:3123/api/health`,
    kill the dev server (and confirm nothing is left listening on 3123).

## Report back (data for the orchestrator)
Exact commands run and their outcomes; the final `package.json` scripts and dependency
versions; the health endpoint JSON; any deviation from architecture.md with the reason;
anything left undone.
