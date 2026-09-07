# Phase 6 — optional Spotify push (PKCE, `playlist-modify-private`)

Owner: one subagent. Last. Everything here must be invisible until `SPOTIFY_CLIENT_ID` is
set, and must degrade to a clear explanation when it is not.

## Read first
`docs/spec.md` (Playlist → optional Spotify OAuth), `docs/api-reality.md` §3.5 (the 2026
Development Mode reality: owner needs Premium, 5 authorised users, redirect URI must be a
loopback IP literal like `http://127.0.0.1:3000/api/spotify/callback` — `localhost` is
rejected, playlist writes go to `POST /v1/playlists/{id}/items`, search `limit` max 10),
`src/lib/sources/spotify.ts`, the Phase 4 playlist pages.

## Goal
- PKCE flow with no client secret: `GET /api/spotify/login` (generates `code_verifier`,
  stores it in an httpOnly cookie, redirects to `accounts.spotify.com/authorize` with
  `code_challenge_method=S256`, scope `playlist-modify-private`, `state`), `GET
  /api/spotify/callback` (exchanges the code, stores access + refresh tokens in SQLite —
  a `spotify_auth` table, single row, this is a single-user app — and redirects back to
  the playlist page), `POST /api/spotify/logout`, `GET /api/spotify/status` → `{ configured,
  loggedIn, displayName }`. Refresh tokens transparently when expired.
- `POST /api/playlists/[id]/push` → for each item: find a Spotify track id (use the
  resolved `ids.spotify` if present, else `spotify.searchTrack` with the user's token,
  `limit 10`, strict artist+title match, else skip and report), create a private playlist
  named after ours (description "from It Stings"), add items in chunks of 100 via
  `/v1/playlists/{id}/items`, return `{ url, added: n, skipped: [{ artist, title,
  reason }] }`.
- UI on the playlist page: a "push to spotify" drawn button; before login it shows the
  mandatory note in mono, verbatim in spirit: "Only works for Spotify accounts registered as
  test users in the Spotify dashboard — Development Mode caps this at 5 users (the app owner
  needs Premium)." After a push: the link to the playlist and the skipped list. When
  `SPOTIFY_CLIENT_ID` is unset: the button is replaced by one mono line explaining what to
  set (`SPOTIFY_CLIENT_ID`, `SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/spotify/callback`)
  and the dashboard URL.
- Migration `002_spotify_auth.sql`. Tokens never leave the server; never logged.

## Files you own
```
src/app/api/spotify/{login,callback,logout,status}/route.ts
src/app/api/playlists/[id]/push/route.ts
src/lib/db/migrations/002_spotify_auth.sql, src/lib/db/repos/spotifyAuth.ts
src/lib/spotify/pkce.ts, src/lib/spotify/client.ts   (user-token calls; reuse fetchExternal with ttl 0 and noStore)
src/components/playlists/SpotifyPush.tsx
```

## Prove it
Unit tests for PKCE (verifier/challenge vectors from RFC 7636 appendix B), the token
refresh path (fake transport), the push chunking and skip reporting. You cannot complete a
real OAuth flow here (no client id); prove the login route builds a correct authorize URL
and that everything is hidden/explained when unconfigured. typecheck, lint, test, build.

## Report back
Files, the authorize URL produced, test names, deviations, anything undone.
