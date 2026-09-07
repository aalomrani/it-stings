# It Stings — production image.
#
# NOT BUILT LOCALLY: Docker is not installed on the machine this was written on, so every
# line below is reasoned from docs/api-reality.md §8 and the Next.js addendum rather than
# from a green build. docs/deploy.md says the same thing out loud.
#
# bookworm-slim, NOT alpine: better-sqlite3 13.x ships glibc prebuilds
# (prebuilds/linux-x64.node, prebuilds/linux-arm64.node) and musl ones only under the
# separate `linuxmusl-*` names — on alpine npm would fall back to compiling, which needs
# python3 + make + g++ in the image. Debian slim + the glibc prebuild needs none of that.

FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app


# ---------------------------------------------------------------------------
# deps — node_modules only, so this layer is re-used until the lockfile changes
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json package-lock.json ./

# --ignore-scripts on purpose. better-sqlite3's install script is `node-gyp rebuild`,
# which is a no-op when a prebuild exists (verified: "make only TOUCHed .stamp files, no
# C++ compilation") but still wants python3 and make. The binding is loaded lazily from
# `prebuilds/<platform>-<arch>.node` at `new Database()`, so skipping the script leaves a
# working module and keeps the image free of a toolchain.
RUN npm ci --ignore-scripts


# ---------------------------------------------------------------------------
# builder — next build, producing .next/standalone
# ---------------------------------------------------------------------------
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# No secrets are needed to build: every key is read at request time and every route is
# dynamic. Nothing in `.env*` is copied into the image (see .dockerignore).
RUN npm run build


# ---------------------------------------------------------------------------
# runner — the standalone server and nothing else
# ---------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ITSTINGS_DB_PATH=/data/itstings.sqlite \
    ITSTINGS_MAX_RUNS_PER_DAY=60 \
    ITSTINGS_MAX_RUNS_PER_IP_PER_HOUR=6

# The node images already ship an unprivileged `node` user (uid 1000).
RUN mkdir -p /data && chown node:node /data

# `.next/standalone` carries server.js + the traced node_modules (including
# better-sqlite3's prebuilt .node); static assets and public/ are never traced and have to
# be copied by hand. The generated server.js does `process.chdir(__dirname)`, so
# everything below lands relative to /app.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# The migration runner reads these at runtime from process.cwd() and nothing imports them,
# so they are not traced. next.config.ts also asks for them via outputFileTracingIncludes;
# this COPY is the one that is guaranteed to work.
COPY --from=builder --chown=node:node /app/src/lib/db/migrations ./src/lib/db/migrations

USER node

# The SQLite file, its -wal and -shm sidecars. Mount a real volume here in production
# (Fly: [mounts] source="itstings_data") or every deploy starts with an empty cache.
VOLUME ["/data"]

EXPOSE 3000

# Node 24 has a global fetch, so the healthcheck needs no curl in the image.
# /api/health makes no network calls and opens the database, so a pass means the volume
# is writable too. It is exempt from the invite gate by design.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
