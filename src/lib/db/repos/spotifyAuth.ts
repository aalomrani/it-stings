/**
 * `spotify_auth` — the single connected Spotify account (migration `005_spotify_auth.sql`).
 *
 * One row, id 1, enforced by a CHECK constraint: this is a single-user app and "connected
 * to Spotify" is a property of the instance, not of a session. `save` is an upsert of that
 * one row and `clear` deletes it; there is no list, no find, no second identity.
 *
 * Everything in here is a credential. Nothing above this file may serialise a token into a
 * response body, a log line or the `http_cache` table — `GET /api/spotify/status` returns
 * `displayName` and two booleans, and that is the whole of what the browser is ever told.
 */

import { getDb } from '@/lib/db';

export interface SpotifyAuth {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. `src/lib/spotify/client.ts` refreshes 60 s before this. */
  expiresAt: number;
  /** The scopes Spotify actually granted, space separated, as returned. */
  scope: string | null;
  userId: string | null;
  displayName: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SaveInput {
  accessToken: string;
  /**
   * Omitted (or null) on a refresh whose response carried no new refresh token — Spotify
   * says "continue using the existing token", so the stored one is kept.
   */
  refreshToken?: string | null;
  expiresAt: number;
  scope?: string | null;
  userId?: string | null;
  displayName?: string | null;
}

interface Raw {
  id: number;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string | null;
  user_id: string | null;
  display_name: string | null;
  created_at: number;
  updated_at: number;
}

const toAuth = (r: Raw): SpotifyAuth => ({
  accessToken: r.access_token,
  refreshToken: r.refresh_token,
  expiresAt: r.expires_at,
  scope: r.scope,
  userId: r.user_id,
  displayName: r.display_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** The connected account, or `null` when nobody has logged in (or has logged out). */
export function get(): SpotifyAuth | null {
  const row = getDb().prepare('SELECT * FROM spotify_auth WHERE id = 1').get() as Raw | undefined;
  return row ? toAuth(row) : null;
}

export function isLoggedIn(): boolean {
  return get() !== null;
}

/**
 * Upserts the one row.
 *
 * A field left `undefined` keeps whatever is already stored (`refresh_token`, `scope`,
 * `user_id`, `display_name`) — that is what makes this usable both for the callback, which
 * knows everything, and for a token refresh, which usually knows only the access token and
 * its expiry. Passing an explicit `null` for `scope`/`userId`/`displayName` clears it;
 * `refreshToken: null` is read as "no new one arrived", never as "forget the one I have",
 * because a row with no refresh token is a row that dies in an hour.
 *
 * Throws if there is no stored refresh token and none is supplied — that combination could
 * only come from a caller trying to store half a login.
 */
export function save(input: SaveInput, now: number = Date.now()): SpotifyAuth {
  const db = getDb();
  const existing = get();
  const refreshToken = input.refreshToken ?? existing?.refreshToken;
  if (!refreshToken) {
    throw new Error('spotifyAuth.save: no refresh token to store (and none already stored)');
  }

  const scope = input.scope === undefined ? (existing?.scope ?? null) : input.scope;
  const userId = input.userId === undefined ? (existing?.userId ?? null) : input.userId;
  const displayName =
    input.displayName === undefined ? (existing?.displayName ?? null) : input.displayName;

  db.prepare(
    `INSERT INTO spotify_auth
       (id, access_token, refresh_token, expires_at, scope, user_id, display_name, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token  = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at    = excluded.expires_at,
       scope         = excluded.scope,
       user_id       = excluded.user_id,
       display_name  = excluded.display_name,
       updated_at    = excluded.updated_at`,
  ).run(
    input.accessToken,
    refreshToken,
    input.expiresAt,
    scope,
    userId,
    displayName,
    existing?.createdAt ?? now,
    now,
  );

  const saved = get();
  if (!saved) throw new Error('spotifyAuth.save: row vanished immediately after writing it');
  return saved;
}

/** Logging out. Returns false when there was nothing to disconnect. */
export function clear(): boolean {
  return getDb().prepare('DELETE FROM spotify_auth').run().changes > 0;
}
