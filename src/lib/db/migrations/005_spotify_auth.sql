-- 005 — the one Spotify user token (docs/tasks/phase6-spotify.md).
--
-- The task contract names this file `002_spotify_auth.sql`. Migrations are append-only
-- and 001/003/004 already exist and are already recorded in every developer's
-- `schema_migrations`, so this is 005: a file that sorts BEFORE an applied migration is a
-- migration that runs out of order on an existing database, and there is nothing to gain
-- from the lower number.
--
-- ONE ROW, ever (`CHECK (id = 1)`): It Stings is a single-user app, "log in with Spotify"
-- means "this instance is connected to one Spotify account", and a second row could only
-- ever be ambiguity about whose playlist a push writes to. Logging out DELETEs the row.
--
-- What is stored, and why it has to be:
--   access_token   — Bearer credential, expires in ~3600 s.
--   refresh_token  — mints the next access token without another browser round trip.
--                    Spotify's PKCE refresh "might not include a new refresh token. If it
--                    does not, continue using the existing token" (api-reality §3.5), so
--                    this column is only overwritten when a new value actually arrives.
--   expires_at     — epoch ms. Refresh happens 60 s before this, never on a 401.
--   scope          — what the user actually granted, as returned. Recorded so a push that
--                    401s can say "reconnect: the grant is missing playlist-modify-private"
--                    instead of guessing.
--   user_id / display_name — from GET /v1/me, so the page can say who is connected. Both
--                    nullable: a failed /me must not cost a working token.
--
-- These are credentials. They never leave the server (no route serialises them, the status
-- route returns only `displayName`), they are never written to `http_cache` (every call in
-- `src/lib/spotify/client.ts` uses `ttlMs: 0` + `noStore`), and they are never logged.

CREATE TABLE spotify_auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,       -- epoch ms
  scope         TEXT,
  user_id       TEXT,
  display_name  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
