# Phase 7 — ship it (shareable deployment)

The user wants to send the app to other people. The original brief was local-only; this
phase adds what a shared instance needs without turning it into a multi-user product: no
login system, no accounts, one SQLite file, one set of API keys, one shared link.

## Part A — deployable build (can run before the UI/engine land; disjoint files)

Files you own: `Dockerfile`, `.dockerignore`, `fly.toml`, `docs/deploy.md`, `src/proxy.ts`,
`src/lib/gate.ts`, `src/app/gate/page.tsx` (+ its CSS module), `README.md` (rewrite),
`next.config.ts` (minimal edits), `.env.example` (append), `scripts/smoke-prod.sh`.

1. **Production build config.** `next.config.ts`: `output: 'standalone'`. Confirm
   better-sqlite3's native binary is traced into `.next/standalone` (it is on Next's
   serverExternalPackages list; verify by listing `.next/standalone/node_modules/better-sqlite3`
   after a build — but do NOT run `next build` while another agent's dev server or build is
   running; check `lsof -nP -iTCP -sTCP:LISTEN | grep -E ':31[0-9][0-9]'` and `ps aux | grep
   "next build"` first, and wait if busy).
2. **Dockerfile** (multi-stage, `node:24-bookworm-slim`, NOT alpine — better-sqlite3 ships
   glibc prebuilds): deps → build → runner; runner copies `.next/standalone`, `.next/static`,
   `public`; runs as non-root; `ENV ITSTINGS_DB_PATH=/data/itstings.sqlite`, `PORT=3000`,
   `HOSTNAME=0.0.0.0`; `VOLUME /data`; healthcheck `GET /api/health`. `.dockerignore` excludes
   `node_modules`, `.next`, `data`, `eval/out`, `docs/design/proposals`, `.env*`.
   Docker is not installed on this machine: you cannot build the image here. Write it
   carefully, keep it boring, and note in `docs/deploy.md` that it was not built locally.
3. **fly.toml** for Fly.io: app name placeholder `itstings`, primary region `ams` (or
   whatever `fly launch` picks), `[mounts] source="itstings_data" destination="/data"`,
   `[http_service] internal_port=3000 force_https=true auto_stop_machines="stop"
   auto_start_machines=true min_machines_running=0`, `[[vm]] size="shared-cpu-1x" memory="512mb"`,
   `[checks]` on `/api/health`. SSE must not be buffered: Fly's proxy passes it through;
   the route already sets `X-Accel-Buffering: no`.
4. **Access gate** (`ITSTINGS_ACCESS_TOKEN`, optional). `src/proxy.ts` (Next 16 proxy
   convention — never also create middleware.ts): when the env var is set and the request
   is not to `/api/health`, `/gate`, `/_next/*`, or static assets: accept if the `itstings`
   cookie equals the token; else if `?key=<token>` is present, set the cookie (httpOnly,
   sameSite lax, 180 days) and redirect to the same URL without the query; else redirect to
   `/gate`. `/gate` is a drawn page in the design system: the wordmark, one line of copy
   ("this one's invite-only — ask whoever sent you for the link") on an opaque patch, and
   nothing else. API routes without the cookie return 401 JSON. Unset → no gate. Constant-
   time comparison. Document the invite link format `https://<app>/?key=<token>`.
5. **Cost caps** (`src/lib/gate.ts` also exports these; wiring into
   `src/app/api/recommend/route.ts` happens in Part B): `ITSTINGS_MAX_RUNS_PER_DAY` (default 60
   when deployed, unlimited locally = when unset), `ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR` (default
   6). Counters in SQLite (`run_counters` table via migration `003_counters.sql`) so they
   survive restarts. Cached replays don't count. When exceeded, `/api/recommend` emits the
   protocol's `error` event with a human sentence ("today's budget of 60 runs is used up —
   try tomorrow") and closes.
6. **docs/deploy.md**: step by step for a non-expert: create a Fly account (card required
   for Fly even on small apps — say so), install `flyctl`, `fly launch --no-deploy` (accept
   the generated config or use ours), `fly volumes create itstings_data --size 1`, `fly secrets
   set ANTHROPIC_API_KEY=… LASTFM_API_KEY=… TAVILY_API_KEY=… ITSTINGS_ACCESS_TOKEN=…`,
   `fly deploy`, `fly open`, how to read logs, how to back up the SQLite file (`fly ssh
   console` + `sqlite3 .backup`), expected cost, and what each missing key degrades. Also a
   short "alternatives" section: Railway (volume + Dockerfile), a VPS with Docker Compose
   (include a `docker-compose.yml` snippet inline), and why Vercel does not fit (no
   persistent filesystem for SQLite). Keep it honest about what was and wasn't tested here.
7. **README.md**: what it is (three sentences, the name unexplained), local run
   (`npm install`, `.env.local`, `npm run dev`), keys table with signup links, eval harness,
   deploy pointer, credits required by API terms (Last.fm, GetSongBPM when used, Deezer/iTunes
   previews). No marketing.
8. **scripts/smoke-prod.sh**: builds (`npm run build`), starts `node .next/standalone/server.js`
   on port 3199 with `ITSTINGS_DB_PATH=$SCRATCH/smoke.sqlite`, curls `/api/health`,
   `/api/search?q=the%20cure%20lovecats`, resolves the top hit, streams
   `/api/recommend` for 20 s and asserts at least the `run`/`stage`/`seed` events arrived,
   with and without `ITSTINGS_ACCESS_TOKEN` (expect 401 / redirect without the cookie),
   then kills the server. Run it only when no other build/dev server is active.

## Part B — after the UI and engine land

Owner: one subagent. Files: `src/app/api/recommend/route.ts` (wire the caps), a "copy link"
control on the results header (`src/components/ShareLink.tsx`; copies the current
`/?seed=<key>` URL — cached runs make it instant for the recipient), the provenance foot
gains "invite-only instance" when the gate is on, `docs/deploy.md` final check, and the
full `scripts/smoke-prod.sh` run in production mode. Also run the whole test suite, lint,
typecheck, build. Report exact outcomes.
