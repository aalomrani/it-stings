# It Stings

A web app that answers one question: *I love this specific song — what else sounds like
**this**?* You pick the exact track, the engine works out what makes it feel the way it
feels, and then it goes looking for that same thing across genres, decades and scenes.
Every recommendation comes with one sentence naming the specific trait it shares with your
song, and if it cannot name one, the track is cut.

`docs/spec.md` is the source of truth for the product. `docs/architecture.md` fixes the
module boundaries, shared types, database schema and streaming protocol.
`docs/api-reality.md` records what every external API actually did when we probed it.
`docs/design.md` is the visual contract. `docs/deploy.md` is how to put it on the internet.

## Requirements

- Node 24.x (verified on 24.20.0) and npm 11.x
- No API key is required. The recommendation engine is fully deterministic and keyless
  (`engine-3-keyless`): it browses Deezer related artists and MusicBrainz tag cohorts for
  candidates, then judges them on tempo, musical key, mood and shared tags from
  AcousticBrainz — no LLM. Every key below is optional and only sharpens one signal.

## Run it locally

```bash
npm install
npm install-scripts approve better-sqlite3   # only if npm reports it as skipped
cp .env.example .env.local                   # then fill in the keys you have
npm run dev                                  # http://localhost:3000
curl -s http://127.0.0.1:3000/api/health     # keys present + database counts
```

The SQLite database is created on first use at `data/itstings.sqlite` (git-ignored). Set
`ITSTINGS_DB_PATH` to move it; `:memory:` is allowed and is what the tests use.

## Keys

All optional, all in `.env.local`, none of them ever reaching the browser — `src/lib/env.ts`
is `server-only` and every third-party call goes through a server route.
`GET /api/health` reports which are present, never their values.

| Var | Sign up | Missing → |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **not used by the engine.** Recommendations are deterministic and keyless as of `engine-3-keyless`; the model seam in `src/lib/engine/model.ts` is dead on the recommend path and kept only for legacy tests |
| `ITSTINGS_MODEL` | — | unused (no model is called) |
| `LASTFM_API_KEY` | <https://www.last.fm/api/account/create> | Channel A skipped. Optional booster only: a **free** key adds Last.fm similar-tracks as extra candidates. The engine works fully without it |
| `TAVILY_API_KEY` | — | **no longer used.** Channel B is now keyless MusicBrainz tag-cohort discovery |
| `BRAVE_SEARCH_API_KEY` | — | **no longer used** (see `TAVILY_API_KEY`) |
| `SPOTIFY_CLIENT_ID` | <https://developer.spotify.com/dashboard> | no "push to Spotify" on a playlist — the PKCE login is hidden and `/api/spotify/login` answers 400 |
| `SPOTIFY_REDIRECT_URI` | — | defaults to `http://127.0.0.1:3000/api/spotify/callback`. Must match the dashboard entry character for character. Over `http` it must be a **`127.0.0.1` loopback literal** — Spotify rejects `localhost`; over `https` any host is allowed, so a deployed instance uses `https://<app>.fly.dev/api/spotify/callback` |
| `SPOTIFY_CLIENT_SECRET` | same dashboard app | Spotify deep links fall back to a keyless `open.spotify.com/search/…` link. **Not used by the push** — PKCE needs no secret |
| `GETSONGBPM_API_KEY` | <https://getsongbpm.com/api> | tempo falls through to AcousticBrainz, or stays unknown |
| `ITSTINGS_FALLBACKS` | — | defaults on (`docs/model.md`) |
| `ITSTINGS_ACCESS_TOKEN` | you generate it | no invite gate — see `docs/deploy.md` |
| `ITSTINGS_MAX_RUNS_PER_DAY`, `ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR` | — | unlimited locally; the deployed image sets 60 and 6 |

### The two Spotify features are separate

They come from the same dashboard app and are otherwise unrelated, so read the rows above
as two independent switches:

- **Push a playlist to Spotify** (Phase 6). `SPOTIFY_CLIENT_ID` + `SPOTIFY_REDIRECT_URI`,
  **no client secret** — it is an Authorization Code + PKCE flow, which is the whole reason
  PKCE exists. Routes: `GET /api/spotify/login` (302 to `accounts.spotify.com/authorize`),
  `GET /api/spotify/callback` (always redirects back to the playlist with
  `?spotify=connected` or `?spotify=error&spotify_reason=…`, never renders),
  `POST /api/spotify/logout`, `GET /api/spotify/status`, and
  `POST /api/playlists/<id>/push`. The one scope is `playlist-modify-private`: it can
  create a private playlist and add items, and can read nothing. The refresh token lives in
  SQLite (`005_spotify_auth.sql`, one row) and never reaches the browser.
- **Deep links and keyless search** (Phase 1). `SPOTIFY_CLIENT_ID` +
  `SPOTIFY_CLIENT_SECRET`, the client-credentials flow, used only to turn a track into an
  `open.spotify.com/track/<id>` link. This is also the pair `GET /api/health` reports as
  `keys.spotify`, so health can say `spotify: false` on an instance whose push works fine.

**Development Mode.** A new dashboard app starts in Development Mode and stays there until
Spotify grants an extension: the **app owner needs Spotify Premium**, and only the
**5 accounts** added to the app's user allowlist may log in at all. Anyone else gets a 403
and the push says so. The UI prints this before offering the login; do not remove it.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next dev server (Turbopack) |
| `npm run build` | Production build (`output: 'standalone'`) |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm test` | Vitest, one pass. No network, in-memory database |
| `npm run test:watch` | Vitest in watch mode |
| `npm run eval` | Eval harness over `eval/seeds.json` |
| `npm run db:reset` | Delete the SQLite file and its WAL sidecars |
| `scripts/smoke-prod.sh` | Build, run the production server, exercise health / search / resolve / the SSE stream / the invite gate |

## Eval harness

`eval/seeds.json` holds a handful of seed tracks with notes on what a good answer looks
like — "The Lovecats" by The Cure is seed one, and the acceptance test in `docs/spec.md`
is written against it. `npm run eval` runs the whole pipeline for each seed and dumps
`eval/out/<seed>.json` and `.md` for manual reading. It costs real API calls; it is for
judging result quality, not for CI.

## Sharing it with other people

`docs/deploy.md`. Short version: a `Dockerfile` and a `fly.toml` are in the repo, the app
wants one machine and one volume mounted at `/data`, and setting `ITSTINGS_ACCESS_TOKEN`
turns on an invite gate whose link is `https://<your-app>/?key=<token>` (it sets an
httpOnly cookie for 180 days and strips the key from the URL). Two run caps
(`ITSTINGS_MAX_RUNS_PER_DAY`, `ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR`, counted in SQLite so
they survive restarts) keep a shared link from spending your Anthropic balance. Both are
off when unset, so a local run is unchanged.

## Layout

```
src/app/api/            server routes: health, search, resolve, recommend (SSE), preview, playlists, runs
src/app/api/spotify/    login / callback / logout / status — the PKCE handshake, client id only
src/app/gate/           the invite wall
src/proxy.ts            the invite gate (Next 16 proxy convention — never also middleware.ts)
src/lib/types.ts        ALL shared types (verbatim from docs/architecture.md)
src/lib/env.ts          server-only, zod-parsed environment
src/lib/gate.ts         invite gate + cost cap rules (pure; no db, no server-only imports)
src/lib/db/             better-sqlite3 singleton, migrations, typed repos
src/lib/http/           THE seam: cache -> rate limit -> fetch -> retry, per-host policies
src/lib/sources/        one file per external API; nothing else calls fetch()
src/lib/spotify/        the PKCE push: pkce.ts (verifier/challenge/state), session.ts
                        (handshake cookies), client.ts (tokens, create, add) — no secret
src/lib/engine/         fingerprint, the three candidate channels, scoring, ranking
docs/                   spec, architecture, API reality, design, deploy, task contracts
eval/                   eval seeds and harness
```

## Rules that are not negotiable

- No API key ever reaches the browser, and no third-party host is called from client code.
  Every external request goes through a server route and through `fetchExternal`.
- Rate limits are respected, especially MusicBrainz (strictly serial, ≥1100 ms apart, with
  the fixed `ItStings/0.1 (local dev)` User-Agent).
- Everything external is cached in SQLite. The same seed twice is near-instant.
- Tests never hit the network: the transport is replaced at the `fetchExternal` seam.
- Every displayed number traces to a named source. Unknown means unknown; never fabricate
  a BPM, a key or a year.

## Attribution

These are licence terms, not decoration. When `LASTFM_API_KEY` is configured the UI
carries a visible "powered by Last.fm" credit linking to the relevant catalogue pages, and
Last.fm HTML is never scraped. When `GETSONGBPM_API_KEY` is configured the UI carries a
visible "Tempo data by GetSongBPM" link to <https://getsongbpm.com>. Preview audio is
served from Deezer's and Apple's own CDNs, unmodified, 30 seconds, as those APIs intend;
metadata comes from iTunes, Deezer, MusicBrainz, AcousticBrainz, Last.fm and Spotify.
