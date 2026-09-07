#!/usr/bin/env bash
#
# smoke-prod.sh — build the production bundle, run the standalone server the way the
# Docker image does, and prove the four things that have to work on a deployed instance:
#
#   1. `/api/health` answers 200 with a database it just created,
#   2. `/api/search` returns typeahead hits and `/api/resolve` turns the top one into a
#      TrackRecord,
#   3. `/api/recommend` streams: the `run`, `stage` and `seed` events arrive within 20 s
#      (they arrive on the error path too, so this passes with no ANTHROPIC_API_KEY),
#   4. with `ITSTINGS_ACCESS_TOKEN` set, an API route without the cookie is 401, a page is
#      redirected to /gate, `/api/health` is still 200, and `/?key=<token>` sets the
#      cookie and redirects.
#
# Steps 2 and 3 talk to iTunes and Deezer over the network. With no network the script
# says so and keeps going with a fixed seed key, because the streaming protocol is
# testable either way.
#
# Run it ONLY when no other build or dev server is running: `next build` and the .next
# directory are not safe to share. The script checks and refuses.
#
# Usage:  scripts/smoke-prod.sh [--skip-build]
# Env:    SCRATCH=<dir>   where the throwaway SQLite file goes (default: mktemp -d)
#         PORT_SMOKE=…    override the port (default 3199)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT_SMOKE:-3199}"
SCRATCH="${SCRATCH:-$(mktemp -d "${TMPDIR:-/tmp}/itstings-smoke.XXXXXX")}"
DB="$SCRATCH/smoke.sqlite"
LOG="$SCRATCH/server.log"
TOKEN="smoke-token-$RANDOM$RANDOM"
BASE="http://127.0.0.1:$PORT"
SKIP_BUILD=0
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1

FAILURES=0
SERVER_PID=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   ok   %s\n' "$*"; }
warn() { printf '   warn %s\n' "$*"; }
bad()  { printf '   FAIL %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# --------------------------------------------------------------------------
# 0. refuse to fight another agent's dev server or build
# --------------------------------------------------------------------------
say "checking nothing else is building or serving"
if pgrep -fl 'next (build|dev)' >/dev/null 2>&1; then
  echo "   a 'next build' or 'next dev' is already running — refusing to touch .next" >&2
  pgrep -fl 'next (build|dev)' >&2 || true
  exit 2
fi
if lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -qE ":(31[0-9][0-9])\b"; then
  echo "   something is listening on a 31xx port — refusing to run:" >&2
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ":(31[0-9][0-9])\b" >&2 || true
  exit 2
fi
ok "clear"

# --------------------------------------------------------------------------
# 1. build
# --------------------------------------------------------------------------
if [ "$SKIP_BUILD" = "1" ]; then
  say "skipping build (--skip-build)"
else
  say "npm run build"
  npm run build
  ok "built"
fi

[ -f .next/standalone/server.js ] || {
  echo "   .next/standalone/server.js is missing — is output:'standalone' still in next.config.ts?" >&2
  exit 1
}

# The migration runner reads src/lib/db/migrations/*.sql at runtime relative to cwd, and
# the generated server.js chdir()s into .next/standalone. next.config.ts asks the tracer
# for them; if the tracer did not oblige, copy them, exactly as the Dockerfile does.
if [ ! -d .next/standalone/src/lib/db/migrations ]; then
  warn "migrations were not traced into .next/standalone — copying them (the Dockerfile does this too)"
fi
mkdir -p .next/standalone/src/lib/db
rm -rf .next/standalone/src/lib/db/migrations
cp -R src/lib/db/migrations .next/standalone/src/lib/db/migrations

# Static assets are never traced either — the Dockerfile copies these two by hand as well.
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static
cp -R .next/static .next/standalone/.next/static
if [ -d public ]; then
  rm -rf .next/standalone/public
  cp -R public .next/standalone/public
fi

start_server() {
  # $1 = the ITSTINGS_ACCESS_TOKEN value ("" for no gate)
  rm -f "$LOG"
  ITSTINGS_DB_PATH="$DB" \
  ITSTINGS_ACCESS_TOKEN="$1" \
  PORT="$PORT" HOSTNAME=127.0.0.1 NODE_ENV=production \
    node .next/standalone/server.js >"$LOG" 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null --max-time 2 "$BASE/api/health"; then return 0; fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "   server exited early:" >&2; cat "$LOG" >&2; return 1
    fi
    sleep 0.5
  done
  echo "   server never became healthy:" >&2; cat "$LOG" >&2; return 1
}

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}

status_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }

# ==========================================================================
# PART 1 — no gate
# ==========================================================================
say "starting the standalone server on :$PORT (no gate, db=$DB)"
start_server "" || exit 1
ok "up, pid $SERVER_PID"

say "GET /api/health"
HEALTH="$(curl -s --max-time 10 "$BASE/api/health")"
echo "$HEALTH" | head -c 400; echo
case "$HEALTH" in
  *'"ok":true'*) ok "health reports ok" ;;
  *) bad "health did not report ok" ;;
esac
[ -f "$DB" ] && ok "database created at $DB" || bad "no database file at $DB"

say "GET /api/search?q=the%20cure%20lovecats"
SEARCH="$(curl -s --max-time 25 "$BASE/api/search?q=the%20cure%20lovecats" || true)"
echo "$SEARCH" | head -c 300; echo
SEED_KEY=""
HIT="$(printf '%s' "$SEARCH" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const h=(JSON.parse(s).hits||[])[0];
      if (h) process.stdout.write(JSON.stringify({itunesId:h.itunesId,artist:h.artist,title:h.title,durationMs:h.durationMs}));
    } catch {}
  });' || true)"
if [ -n "$HIT" ]; then
  ok "top hit: $HIT"
  say "POST /api/resolve (the top hit)"
  RESOLVED="$(curl -s --max-time 60 -H 'content-type: application/json' -d "$HIT" "$BASE/api/resolve" || true)"
  echo "$RESOLVED" | head -c 300; echo
  SEED_KEY="$(printf '%s' "$RESOLVED" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const k=JSON.parse(s)?.track?.key; if (k) process.stdout.write(k); } catch {}
    });' || true)"
  if [ -n "$SEED_KEY" ]; then ok "resolved to $SEED_KEY"; else bad "resolve returned no track key"; fi
else
  warn "no typeahead hits (offline? iTunes down?) — continuing with a stand-in seed key"
fi
[ -n "$SEED_KEY" ] || SEED_KEY="itunes:1288102536"

say "GET /api/recommend?seed=$SEED_KEY (streaming, 20 s)"
STREAM="$SCRATCH/recommend.sse"
curl -sN --max-time 20 "$BASE/api/recommend?seed=$(printf '%s' "$SEED_KEY" | sed 's/:/%3A/g')" >"$STREAM" || true
printf '   %s bytes, %s frames\n' "$(wc -c <"$STREAM" | tr -d ' ')" "$(grep -c '^data: ' "$STREAM" || true)"
head -c 400 "$STREAM"; echo
for EVENT in run stage seed; do
  if grep -q "\"type\":\"$EVENT\"" "$STREAM"; then ok "saw the $EVENT event"; else bad "no $EVENT event in 20 s"; fi
done

stop_server
ok "server stopped"

# ==========================================================================
# PART 2 — the invite gate
# ==========================================================================
say "restarting with ITSTINGS_ACCESS_TOKEN set"
start_server "$TOKEN" || exit 1
ok "up, pid $SERVER_PID"

CODE="$(status_of "$BASE/api/health")"
[ "$CODE" = "200" ] && ok "/api/health is 200 with the gate on (the healthcheck keeps working)" \
                    || bad "/api/health answered $CODE with the gate on"

CODE="$(status_of "$BASE/api/search?q=lovecats")"
[ "$CODE" = "401" ] && ok "/api/search without a cookie is 401" || bad "/api/search answered $CODE, expected 401"

BODY="$(curl -s --max-time 10 "$BASE/api/search?q=lovecats")"
case "$BODY" in
  *invite*) ok "the 401 body says what happened: $BODY" ;;
  *) bad "the 401 body is not the invite-only message: $BODY" ;;
esac

CODE="$(status_of "$BASE/")"
LOCATION="$(curl -s -o /dev/null -D - --max-time 10 "$BASE/" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
if [ "$CODE" = "307" ] && [ "${LOCATION##*/}" = "gate" ]; then
  ok "/ redirects ($CODE) to $LOCATION"
else
  bad "/ answered $CODE location='$LOCATION', expected 307 -> /gate"
fi

CODE="$(status_of "$BASE/gate")"
[ "$CODE" = "200" ] && ok "/gate itself is 200" || bad "/gate answered $CODE"

say "the invite link: /?key=<token>"
HEADERS="$(curl -s -o /dev/null -D - --max-time 10 "$BASE/?key=$TOKEN" | tr -d '\r')"
printf '%s\n' "$HEADERS" | grep -iE '^(HTTP/|location:|set-cookie:)' | sed 's/^/   /'
case "$HEADERS" in
  *"itstings=$TOKEN"*) ok "the cookie is set" ;;
  *) bad "no itstings cookie in the response to the invite link" ;;
esac
case "$HEADERS" in
  *HttpOnly*) ok "cookie is HttpOnly" ;;
  *) bad "cookie is not HttpOnly" ;;
esac
if printf '%s\n' "$HEADERS" | grep -qi '^location: .*key='; then
  bad "the redirect still carries the key in the URL"
else
  ok "the key is stripped from the redirect target"
fi

say "with the cookie, everything opens again"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -b "itstings=$TOKEN" "$BASE/api/search?q=lovecats")"
[ "$CODE" = "200" ] && ok "/api/search with the cookie is 200" || bad "/api/search with the cookie answered $CODE"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -b "itstings=wrong-token" "$BASE/api/search?q=lovecats")"
[ "$CODE" = "401" ] && ok "a wrong cookie is still 401" || bad "a wrong cookie answered $CODE, expected 401"

stop_server

say "done"
echo "   scratch: $SCRATCH"
if [ "$FAILURES" -eq 0 ]; then
  echo "   all checks passed"
else
  echo "   $FAILURES check(s) failed"
fi
exit "$FAILURES"
