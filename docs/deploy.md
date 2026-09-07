# Deploying It Stings

This is a single-user app you are about to share with a few friends. Nothing below turns
it into a product: there are no accounts, no login, no per-user data. There is **one**
SQLite file, **one** set of API keys, **one** link. Anyone with the link is you, as far as
the app is concerned — so keep it to people you would lend your laptop to.

---

## Honesty first: what was and was not tested

Written on a machine with **no Docker and no flyctl installed**, so:

| Thing | Status |
|---|---|
| `next.config.ts` `output: 'standalone'` | Verified by a real `npm run build` in Part B: `.next/standalone/server.js` exists and serves, and better-sqlite3 is traced into `.next/standalone/node_modules/better-sqlite3` with its `prebuilds/` — the native binary the runner needs. |
| `Dockerfile` | **Never built.** Reasoned line by line from `docs/api-reality.md` §8 (better-sqlite3 ships glibc prebuilds; `node-gyp` is a no-op) and from Next's standalone `server.js` (which does `process.chdir(__dirname)`). Expect to fix a typo on the first `docker build`. |
| `fly.toml` | **Never deployed.** Field names taken from Fly's current schema; `fly launch` will happily rewrite it. |
| The invite gate (`src/proxy.ts`, `src/lib/gate.ts`) | Logic unit-tested (`src/lib/__tests__/gate.test.ts`). End-to-end HTTP behaviour is exercised by `scripts/smoke-prod.sh`, which runs a real production server — **run it before you deploy**. |
| The cost caps | Wired into `/api/recommend` and unit-tested end to end against a real SQLite database (`src/lib/__tests__/recommendRoute.test.ts`): a run that executes is charged, a run the cache replays is not, and an over-budget request gets the protocol's `error` event with the sentence below. Also **exercised end to end on 2026-09-06 against a local standalone production server** (`node .next/standalone/server.js`, `ITSTINGS_MAX_RUNS_PER_DAY=1`): the first uncached run streamed, the next one got `today's budget of 1 runs is used up — try tomorrow` and the page's receipt line ended in a red `stopped`. **Still not exercised against a deployed Fly machine.** |
| `scripts/smoke-prod.sh` | **Run, all checks passed, 0 failures** — last re-run 2026-09-06 (`--skip-build`, against a `npm run build` of the current tree made minutes earlier): `node .next/standalone/server.js` on :3199, health, typeahead, resolve, a 20-second `/api/recommend` stream, and the gate both ways. Still not a Docker image and not a Fly machine. |

Where a step below is a guess rather than something observed, it says so.

---

## What you get

- One Fly machine, 512 MB, that **sleeps when nobody is using it** and wakes on the next
  request (a cold start is a Node process starting, not a container building — a second or
  two, plus the first request being slower).
- One 1 GB volume holding `itstings.sqlite`: your playlists, the track cache, the evidence
  cache and every past run. It survives deploys and restarts. It is the only thing worth
  backing up.
- A `?key=` invite link, if you want one.
- Caps so a shared link cannot quietly spend your Anthropic balance.

---

## Costs, honestly

- **Fly requires a payment card even for small apps.** There is no card-free tier any
  more. Budget roughly **$2–5/month**: the machine bills only while it is awake (with
  `auto_stop_machines = "stop"` and `min_machines_running = 0` an idle app costs near
  nothing), the 1 GB volume is about **$0.15/month**, and outbound bandwidth for this app
  is negligible. These are list prices as understood at the time of writing — **check
  Fly's current pricing page**, not this document.
- **The real cost is the Anthropic API.** A cold recommendation run makes several model
  calls (fingerprint, Channel C prior, scoring in batches). Assume **a few cents to ~20
  cents per cold run**, depending on the model and how many candidates survive. This is an
  estimate: nothing here has been billed and measured. A repeat of the same seed is served
  from the SQLite run cache and costs **nothing**.
- That is what `ITSTINGS_MAX_RUNS_PER_DAY` exists for. The deployed default is 60 runs a
  day across the whole instance and 6 per hour per IP address. Cached replays do not
  count. Change them in `fly.toml` (`[env]`) and redeploy.

---

## Before you start: the keys

Every key is optional; each missing one degrades exactly one thing.

| Secret | Get it from | Missing → |
|---|---|---|
| `ANTHROPIC_API_KEY` | <https://console.anthropic.com/settings/keys> | **No recommendations at all.** Search, resolve, previews and playlists still work. This is the one key worth having. |
| `LASTFM_API_KEY` | <https://www.last.fm/api/account/create> | Channel A (statistical similarity + tag pivot) is skipped and the fingerprint loses crowd tags. Results get noticeably thinner. |
| `TAVILY_API_KEY` | <https://app.tavily.com> | Channel B (forum evidence) is skipped — no "someone on Reddit said this" trail. |
| `BRAVE_SEARCH_API_KEY` | <https://api-dashboard.search.brave.com/app/plans> (card required even on free) | Only used when Tavily is absent. |
| `SPOTIFY_CLIENT_ID` | <https://developer.spotify.com/dashboard> | The "push to Spotify" button on a playlist never appears; `GET /api/spotify/login` answers 400 `not_configured` and `POST /api/playlists/<id>/push` answers 400. Nothing else changes. |
| `SPOTIFY_REDIRECT_URI` | you set it, and it must be registered on the same dashboard app | Falls back to `http://127.0.0.1:3000/api/spotify/callback`, which is wrong on a deployed host — the login returns to your laptop instead of the server. **Set it on any deployment that has `SPOTIFY_CLIENT_ID`.** See "Spotify push on a deployed host" below. |
| `SPOTIFY_CLIENT_SECRET` | the same dashboard app | Spotify deep links fall back to a keyless `open.spotify.com/search/…` link. **This is not part of the push** — the PKCE flow is client-id only — so leaving it unset costs you deep links and nothing else. |
| `GETSONGBPM_API_KEY` | <https://getsongbpm.com/api> (browser only) | Tempo falls through to AcousticBrainz, or stays unknown. **If you set it, the UI must show the "Tempo data by GetSongBPM" backlink — that is their licence, not a preference.** |
| `ITSTINGS_ACCESS_TOKEN` | you make it up (see below) | No invite gate: anyone with the URL can use the app and spend your API budget. |

`GET /api/health` on the deployed app tells you which of these actually arrived — with one
trap: `keys.spotify` there means *both* `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`,
because that is what the deep-link search needs. An instance with only the client id will
report `spotify: false` and still push playlists perfectly well. `GET /api/spotify/status`
is the honest answer for the push: `{ configured, loggedIn, displayName }`.

---

## Spotify push on a deployed host

Skip this whole section unless you want the "push to Spotify" button. Everything else in
the app works without it.

**One dashboard app, two unrelated features.** The push is Authorization Code + PKCE and
needs **only `SPOTIFY_CLIENT_ID` plus a registered `SPOTIFY_REDIRECT_URI`**. The separate
`SPOTIFY_CLIENT_SECRET` drives client-credentials search for `open.spotify.com/track/<id>`
deep links and is never sent by the push. Do not put a secret in a browser-facing flow
because a table once listed the two vars together.

**The redirect URI.** It must match a URI registered in the dashboard character for
character, and Spotify's rules are narrow: for an `http://` origin only a **loopback IP
literal** is accepted — `http://127.0.0.1:PORT/api/spotify/callback` — and `localhost` is
rejected outright. That is why local development uses `127.0.0.1` and not `localhost`, and
why the default is `http://127.0.0.1:3000/api/spotify/callback`.

**On a deployed host the loopback rule does not bite, because you are not on `http`.**
Spotify allows any `https` redirect URI on a non-loopback host. So for Fly the dashboard
entry and the secret are both the public HTTPS callback:

```bash
fly secrets set \
  SPOTIFY_CLIENT_ID=… \
  SPOTIFY_REDIRECT_URI=https://<your-app>.fly.dev/api/spotify/callback
```

and `https://<your-app>.fly.dev/api/spotify/callback` goes into **Redirect URIs** in the
dashboard, exactly as written. A dashboard app may hold several, so keep the local
`http://127.0.0.1:3000/api/spotify/callback` alongside it and both environments work.

Behind Fly's proxy the app must also see `X-Forwarded-Proto: https` (it already does — see
Troubleshooting), because that header is what decides the `Secure` flag on the three
short-lived handshake cookies. The callback itself redirects to a *relative* path on
purpose, so the browser stays on the origin it started on and keeps those cookies.

**Development Mode — read this before you promise anyone the feature.** A newly created
Spotify app is in Development Mode and stays there until Spotify approves an extension
request. In that mode:

- the **app owner's own Spotify account must be Premium**;
- only the **5 accounts you add to the app's user allowlist** (name + the email on the
  account) can log in at all — everybody else gets a 403 and the push reports
  `Spotify refused the write (403). In Development Mode only accounts added to the app's
  allowlist may use it, and the app owner needs Premium.`;
- search `limit` is capped at 10, which is what the push already asks for.

The UI states the cap verbatim before offering a login. Leave that sentence alone.

**Scope and storage.** One scope, `playlist-modify-private`: create a private playlist and
add items to it, nothing readable. The refresh token is stored server-side in SQLite
(migration `005_spotify_auth.sql`, a single enforced row) on the mounted volume, is never
sent to the browser and is never logged. `POST /api/spotify/logout` forgets it here;
Spotify has no revocation endpoint, so removing the app from the account itself is done at
<https://www.spotify.com/account/apps/>.

---

## Fly.io, step by step

### 1. Make a Fly account

<https://fly.io/app/sign-up>. You will be asked for a card. Fly does not run apps without
one; this is not something the app can avoid.

### 2. Install flyctl

```bash
# macOS
brew install flyctl
# or, anywhere
curl -L https://fly.io/install.sh | sh

fly version
fly auth login          # opens a browser
```

### 3. Create the app (but do not deploy yet)

From the project directory:

```bash
fly launch --no-deploy
```

It will detect the `Dockerfile`, ask for an app name and a region, and then **offer to
overwrite `fly.toml`**. Either answer:

- **Keep ours** (recommended): say no to its config, then edit `app = "itstings"` and
  `primary_region = "ams"` in `fly.toml` to the name it created and the region you picked.
- **Take theirs**: let it write its own, then copy the `[mounts]`, `[checks]`, `[env]` and
  `[[vm]]` blocks out of our `fly.toml` into it. The three that matter are the mount
  (without it your database vanishes on every deploy), the healthcheck path, and
  `internal_port = 3000`.

### 4. Create the volume

```bash
fly volumes create itstings_data --size 1 --region ams   # same region as the app
```

`itstings_data` must match `[mounts] source` in `fly.toml`, and 1 GB is generous: the
database is a few MB even after heavy use.

> **One machine only.** A Fly volume attaches to exactly one machine. If you ever run
> `fly scale count 2`, the second machine gets an *empty* database and the two disagree
> about everything. Keep it at one: `fly scale count 1`.

### 5. Make an invite token (optional but recommended)

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

Save the output. It is the whole security model.

### 6. Set the secrets

```bash
fly secrets set \
  ANTHROPIC_API_KEY=sk-ant-… \
  LASTFM_API_KEY=… \
  TAVILY_API_KEY=… \
  ITSTINGS_ACCESS_TOKEN=the-token-you-just-generated
```

Optional, and only if you want the Spotify push — the client id and the **public HTTPS**
callback, no client secret (see "Spotify push on a deployed host"):

```bash
fly secrets set \
  SPOTIFY_CLIENT_ID=… \
  SPOTIFY_REDIRECT_URI=https://<your-app>.fly.dev/api/spotify/callback
```

Add `SPOTIFY_CLIENT_SECRET=…` only if you also want `open.spotify.com/track/<id>` deep
links instead of search links; it plays no part in the push.

Secrets are encrypted, injected as environment variables at boot, and are **not** in
`fly.toml` (which is a committed file). Setting a secret restarts the machine. To remove
one: `fly secrets unset TAVILY_API_KEY`. To list names (never values): `fly secrets list`.

### 7. Deploy

```bash
fly deploy
```

This builds the `Dockerfile` (remotely, on Fly's builder, unless you pass
`--local-only`), pushes the image and starts the machine. First build is a few minutes;
later ones re-use the dependency layer.

### 8. Open it, and share it

```bash
fly open                      # your app in a browser
fly status                    # machine state, region, health
curl https://<your-app>.fly.dev/api/health
```

The health endpoint is deliberately **outside** the gate so this keeps working, and it
makes no network calls — it answers instantly and offline. It reports which keys arrived
(presence only, never a value), `gate: true|false` — whether `ITSTINGS_ACCESS_TOKEN` is
set, never the token — and `caps: { perDay, perIpPerHour }`, the run budgets this instance
is actually enforcing (`null` = uncapped). The app reads the same answer: when `gate` is
true the provenance foot at the bottom of a results page says **invite-only instance** and
prints those numbers, so a listener can see the fence they are inside.

**The invite link is:**

```
https://<your-app>.fly.dev/?key=<ITSTINGS_ACCESS_TOKEN>
```

Opening it sets an `itstings` cookie (httpOnly, SameSite=Lax, Secure over https, 180 days)
and immediately redirects to the same URL **without** the key, so the token does not sit in
the address bar or in a screenshot. After that the friend just uses
`https://<your-app>.fly.dev/`. Anyone without the cookie sees `/gate`: the wordmark and one
line — *this one's invite-only — ask whoever sent you for the link*. API routes answer
`401 {"error":"invite_only"}` rather than redirecting, so a stale tab fails loudly instead
of getting an HTML page where it expected JSON.

**Sharing one track rather than the app.** A results page has a `copy link` control under
the seed card — above the results, so it is there whether or not the run found anything (on
a keyless instance, no run does). It copies `https://<your-app>.fly.dev/?seed=<track key>` — the bare
seed, deliberately without the sender's same-artist toggle or their fingerprint
corrections. That URL hits the run cache on the recipient's side, so it renders more or
less instantly and costs the instance nothing: cached replays are not charged against
either budget. The recipient still needs the invite cookie, so send them the `?key=` link
once first.

To **rotate** the token: `fly secrets set ITSTINGS_ACCESS_TOKEN=<new>`. Every existing
cookie stops working immediately; send the new link.
To **turn the gate off**: `fly secrets unset ITSTINGS_ACCESS_TOKEN`.

### 9. Logs

```bash
fly logs                      # live tail
fly logs -n                   # no follow, just the recent buffer
fly machine list              # ids
fly ssh console               # a shell inside the running machine
```

Inside the machine: the app is at `/app`, the database at `/data/itstings.sqlite`,
`ps aux` shows one `node server.js`.

### 10. Back up the database

The image is `node:24-bookworm-slim`, which has **no `sqlite3` binary**. Two ways:

**a. Use the app's own better-sqlite3 (no install, consistent snapshot):**

```bash
fly ssh console -C "node -e \"require('/app/node_modules/better-sqlite3')('/data/itstings.sqlite').backup('/data/backup.sqlite').then(()=>console.log('ok'))\""
fly ssh sftp get /data/backup.sqlite ./itstings-backup.sqlite
```

`.backup()` is SQLite's online backup API: safe while the app is running, unlike copying
the file out from under an active WAL. *(Untested from here — no flyctl on this machine.
If the module path is wrong, `fly ssh console` and `ls /app/node_modules | grep sqlite`.)*

**b. Install the CLI in the machine (ephemeral — it disappears on the next deploy):**

```bash
fly ssh console
apt-get update && apt-get install -y sqlite3
sqlite3 /data/itstings.sqlite ".backup '/data/backup.sqlite'"
exit
fly ssh sftp get /data/backup.sqlite ./itstings-backup.sqlite
```

Restoring is the reverse: `fly ssh sftp shell` → `put itstings-backup.sqlite
/data/itstings.sqlite`, with the machine stopped (`fly machine stop <id>`) so nothing is
writing. Do delete `/data/backup.sqlite` afterwards; it counts against your 1 GB.

### 11. Redeploying

`fly deploy` again. The volume — and therefore every playlist, cached track and past run —
is untouched by a deploy. Migrations run automatically at first database open, in filename
order, tracked in `schema_migrations`.

---

## Before you deploy: run the smoke test locally

```bash
scripts/smoke-prod.sh
```

It refuses to run if another build or dev server is alive, then builds, starts
`node .next/standalone/server.js` on port 3199 against a throwaway database, and checks:
health, typeahead, resolve, a 20-second `/api/recommend` stream (the `run`/`stage`/`seed`
events), and the gate — 401 on an API route without the cookie, 307 to `/gate` for a page,
`/api/health` still 200, and the `?key=` link setting an httpOnly cookie and stripping the
key. This is the closest thing to the Fly runtime you can get without Docker.

---

## Streaming

`/api/recommend` is server-sent events, and a cold run takes ~70 seconds, most of it in
Stage 4 verification. That only works if nothing buffers the response. Two things make
sure of it:

- the route sets `Cache-Control: no-store, no-cache, no-transform` and
  `X-Accel-Buffering: no` (`src/lib/sse.ts`), plus a `: ping` comment every 15 s so an
  idle connection is not reaped;
- Fly's proxy passes response bodies through as they arrive; it does not buffer.

If you put something else in front of the app (nginx, Cloudflare), check it is not
buffering or your friends will stare at nothing for a minute and then get everything at
once. `X-Accel-Buffering: no` is exactly the header nginx reads for this.

---

## Alternatives to Fly

### Railway

Works the same way: it builds the `Dockerfile` and can attach a persistent volume.

1. New project → Deploy from GitHub repo (or `railway up` from the CLI).
2. It detects the `Dockerfile`. Set the service port to **3000**.
3. **Add a volume** mounted at `/data` — without it, SQLite is wiped on every deploy.
4. Add the same environment variables (`ANTHROPIC_API_KEY`, …, `ITSTINGS_ACCESS_TOKEN`,
   `ITSTINGS_DB_PATH=/data/itstings.sqlite`). For the Spotify push, `SPOTIFY_CLIENT_ID`
   and `SPOTIFY_REDIRECT_URI=https://<your-app>.up.railway.app/api/spotify/callback`,
   registered in the Spotify dashboard verbatim.

Untested. Railway's free allowance and sleep behaviour change often; check current terms.

### Any VPS with Docker Compose

A €4/month box is plenty. `docker compose up -d` with:

```yaml
services:
  itstings:
    build: .
    # or: image: ghcr.io/<you>/itstings:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"     # put a TLS terminator (Caddy/nginx) in front
    environment:
      ITSTINGS_DB_PATH: /data/itstings.sqlite
      ITSTINGS_MAX_RUNS_PER_DAY: "60"
      ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR: "6"
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      LASTFM_API_KEY: ${LASTFM_API_KEY}
      TAVILY_API_KEY: ${TAVILY_API_KEY}
      ITSTINGS_ACCESS_TOKEN: ${ITSTINGS_ACCESS_TOKEN}
      # Optional, for the Spotify push only. The redirect URI must be registered in the
      # dashboard verbatim: an https URL on the public host, or — for http — a 127.0.0.1
      # loopback literal. No client secret; PKCE does not use one.
      SPOTIFY_CLIENT_ID: ${SPOTIFY_CLIENT_ID}
      SPOTIFY_REDIRECT_URI: ${SPOTIFY_REDIRECT_URI}
    volumes:
      - itstings_data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  itstings_data:
```

Put the secrets in a `.env` file next to `docker-compose.yml` (Compose reads it for
`${...}` interpolation) and keep it out of git. If you terminate TLS in front, make sure
the proxy forwards `X-Forwarded-Proto: https` — the gate uses it to decide whether the
cookie may be `Secure` — and that it does not buffer SSE.

### Vercel — does not fit

Not a criticism of Vercel; the app is simply the wrong shape for it. Vercel's functions
have **no persistent writable filesystem**: `/tmp` is per-invocation and disappears. This
app's entire design leans on one long-lived SQLite file — the track cache, the HTTP cache,
the evidence cache, past runs, playlists. On Vercel every request would start from an
empty database: no cached run (so every seed is a fresh ~70 s, fully-billed pipeline), no
playlists that survive, no rate-limit state. Moving to Postgres/Turso would work but is a
different application than the one in `docs/architecture.md`.

Same reasoning rules out Netlify Functions, Cloudflare Workers (no native modules —
better-sqlite3 cannot run there at all) and anything else that treats the filesystem as
disposable.

---

## Troubleshooting

**`/api/health` is 200 but everything else is 401.** The gate is on and your browser has
no cookie. Open `https://<app>/?key=<token>` once.

**Everyone sees `/gate` and the key link does nothing.** The token in the URL is not the
token in the secret. `fly secrets list` shows the name and a digest; if in doubt, set a
new one and re-send the link.

**"today's budget of 60 runs is used up".** That is `ITSTINGS_MAX_RUNS_PER_DAY`, counted
in `run_counters` in your SQLite file, UTC days. It arrives as the stream's `error` event,
so the page shows it in the degraded notice rather than failing silently. Raise it in
`fly.toml` `[env]` and redeploy, or set it to `0` for no cap.

**"that's 6 runs from here in the last hour".** The per-IP cap,
`ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR`, bucketed by `fly-client-ip` (falling back to the first
`x-forwarded-for` entry). Everyone behind one NAT shares a bucket; so does everyone whose
IP is unknown. It is a spending limit, never an identity check.

**The machine boots, then dies.** `fly logs`. The most likely cause is the volume: if
`/data` is not mounted, the app cannot create `/data/itstings.sqlite` and the healthcheck
never passes. `fly volumes list` and check `[mounts]`.

**`next build` fails inside `.next/dev/types/`.** A killed `next dev` left stale generated
types behind. `rm -rf .next/dev` and build again (`docs/api-reality.md`, Next.js addendum
§(e)).

**The Spotify login bounces back with `?spotify=error&spotify_reason=…`.** The reason is a
whole sentence; read it. `INVALID_CLIENT: Invalid redirect URI` means `SPOTIFY_REDIRECT_URI`
and the dashboard entry differ — a trailing slash, `http` vs `https`, or `localhost` where
Spotify demands the `127.0.0.1` literal. On a deployed host both must be
`https://<app>.fly.dev/api/spotify/callback`; Spotify accepts any https non-loopback URI,
so the loopback rule only constrains local development. "that login could not be matched to
this browser" means the handshake cookies were dropped: check the proxy is passing
`X-Forwarded-Proto: https`, since that is what sets `Secure` on them.

**Spotify says 403 for everyone except you.** Development Mode. The app owner needs
Premium, and only the 5 accounts on the app's user allowlist in the dashboard may
authorise it. Add the person, or request an extension from Spotify.

**`/api/health` says `spotify: false` but the push works.** Correct, and not a bug: health
reports the deep-link pair (`SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`), while the push
needs only the id. `GET /api/spotify/status` is the push's own answer.

**Recommendations are missing / thin.** `GET /api/health` lists which keys arrived. No
`ANTHROPIC_API_KEY` means no recommendations at all; no `LASTFM_API_KEY` or
`TAVILY_API_KEY` means whole candidate channels are skipped, and the run says so in its
`degraded` list.

**The key is set and health says `anthropic: true`, but every run degrades.** Read the
`degraded` line: the account, not the key, is the usual answer. "the Anthropic account
behind ANTHROPIC_API_KEY has no credit" is a billing failure — add credits under Plans &
Billing at console.anthropic.com, and note that the balance is per ACCOUNT, so a key that
worked last week can stop working with nothing deployed changing. "ANTHROPIC_API_KEY was
rejected by Anthropic" is the key itself: re-set it with `fly secrets set`, since the
image contains no `.env.local` to check. "this account hit the Anthropic rate limit" and
"Anthropic did not answer" both clear on their own; run the seed again.

---

## Credit where the APIs require it

Deploying this in public means the attribution obligations are live, not theoretical:
a visible "powered by Last.fm" credit linking to the catalogue pages whenever
`LASTFM_API_KEY` is set, and "Tempo data by GetSongBPM" linking to getsongbpm.com whenever
`GETSONGBPM_API_KEY` is set. Previews are Deezer's and Apple's and are played from their
CDNs, unmodified, 30 seconds, as those APIs intend.
