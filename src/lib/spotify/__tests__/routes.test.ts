/**
 * The four `/api/spotify/*` handlers, called directly.
 *
 * There is no client id in this environment and no browser, so a real OAuth round trip is
 * impossible. What IS provable, and what these tests prove, is everything either side of
 * the trip: that the authorize URL is correct down to the challenge matching the cookie's
 * verifier, that a refusal comes back as a sentence rather than a stack trace, that a
 * forged `state` never reaches the token endpoint, and that with `SPOTIFY_CLIENT_ID` unset
 * the entire feature answers "off" and spends nothing.
 *
 * (They live under `src/lib/spotify/__tests__` because vitest collects
 * `src/**\/__tests__\/**\/*.test.ts` and `src/app` has no test directory.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    spotifyClientId: 'fake-client-id' as string | undefined,
    spotifyClientSecret: undefined as string | undefined,
    spotifyRedirectUri: 'http://127.0.0.1:3151/api/spotify/callback',
  },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env, keys: {} }));

const login = await import('@/app/api/spotify/login/route');
const callback = await import('@/app/api/spotify/callback/route');
const logout = await import('@/app/api/spotify/logout/route');
const status = await import('@/app/api/spotify/status/route');
const authRepo = await import('@/lib/db/repos/spotifyAuth');
const { challengeFor } = await import('@/lib/spotify/pkce');
const { getDb } = await import('@/lib/db');
const { installFetch, resetHarness } = await import('@/lib/sources/__tests__/harness');

const ORIGIN = 'http://127.0.0.1:3151';

const get = (path: string, cookie?: string) =>
  new Request(`${ORIGIN}${path}`, cookie ? { headers: { cookie } } : undefined);

/** `Set-Cookie` values by name, as the response actually sends them. */
function setCookies(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    out[pair.slice(0, eq).trim()] = decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return out;
}

function setCookieLine(response: Response, name: string): string {
  return response.headers.getSetCookie().find((l) => l.startsWith(`${name}=`)) ?? '';
}

/**
 * The callback's `Location` is RELATIVE on purpose (see `session.returnPath`), so the tests
 * resolve it the way a browser would — and assert it is relative where that matters.
 */
function locationOf(response: Response): URL {
  return new URL(response.headers.get('location') ?? '', ORIGIN);
}

beforeEach(() => {
  mocks.env.spotifyClientId = 'fake-client-id';
  resetHarness();
  getDb().exec('DELETE FROM spotify_auth');
});

afterEach(() => {
  resetHarness();
  getDb().exec('DELETE FROM spotify_auth');
});

/* ---------------------------------------------------------------------- *
 * GET /api/spotify/status
 * ---------------------------------------------------------------------- */

describe('GET /api/spotify/status', () => {
  it('says configured:false when SPOTIFY_CLIENT_ID is unset', async () => {
    mocks.env.spotifyClientId = undefined;
    const res = status.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ configured: false, loggedIn: false, displayName: null });
  });

  it('says configured but not logged in before anyone connects', async () => {
    expect(await status.GET().json()).toEqual({
      configured: true,
      loggedIn: false,
      displayName: null,
    });
  });

  it('names who is connected, and leaks nothing else', async () => {
    authRepo.save({
      accessToken: 'secret-access',
      refreshToken: 'secret-refresh',
      expiresAt: Date.now() + 3_600_000,
      scope: 'playlist-modify-private',
      userId: 'spotifyuser',
      displayName: 'Alice',
    });

    const res = status.GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ configured: true, loggedIn: true, displayName: 'Alice' });
    expect(JSON.stringify(body)).not.toMatch(/secret-|spotifyuser|fake-client-id/);
  });
});

/* ---------------------------------------------------------------------- *
 * GET /api/spotify/login
 * ---------------------------------------------------------------------- */

describe('GET /api/spotify/login', () => {
  it('explains what to set instead of redirecting when unconfigured', async () => {
    mocks.env.spotifyClientId = undefined;
    const res = login.GET(get('/api/spotify/login'));
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('not_configured');
    expect(body.message).toContain('SPOTIFY_CLIENT_ID');
    expect(body.message).toMatch(/localhost is rejected/i);
  });

  it('302s to accounts.spotify.com/authorize with every required PKCE parameter', () => {
    const res = login.GET(get('/api/spotify/login'));
    expect(res.status).toBe(302);

    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin).toBe('https://accounts.spotify.com');
    expect(location.pathname).toBe('/authorize');
    expect(location.searchParams.get('client_id')).toBe('fake-client-id');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('scope')).toBe('playlist-modify-private');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3151/api/spotify/callback',
    );
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
  });

  it('sends the CHALLENGE and keeps the verifier in an httpOnly cookie', () => {
    const res = login.GET(get('/api/spotify/login'));
    const cookies = setCookies(res);
    const verifier = cookies.itstings_sp_verifier;
    const location = new URL(res.headers.get('location') ?? '');

    // The whole point of PKCE: what went to Spotify is the hash of what stayed here.
    expect(verifier).toBeTruthy();
    expect(location.searchParams.get('code_challenge')).toBe(challengeFor(verifier));
    expect(location.href).not.toContain(verifier);

    const line = setCookieLine(res, 'itstings_sp_verifier');
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=lax/i);
    expect(line).toMatch(/Path=\//i);
    // Plain http on a loopback address must not get a Secure cookie or nothing works.
    expect(line).not.toMatch(/Secure/i);
  });

  it('stores the state it sent, so the callback can check it', () => {
    const res = login.GET(get('/api/spotify/login'));
    const location = new URL(res.headers.get('location') ?? '');
    expect(setCookies(res).itstings_sp_state).toBe(location.searchParams.get('state'));
  });

  it('remembers the playlist page that started the login', () => {
    const res = login.GET(get('/api/spotify/login?return=%2Fplaylists%2Fpl_abc'));
    expect(setCookies(res).itstings_sp_return).toBe('/playlists/pl_abc');
  });

  it('refuses to remember an off-site return path', () => {
    for (const hostile of ['https://evil.test/x', '//evil.test/x', 'javascript:alert(1)']) {
      const res = login.GET(get(`/api/spotify/login?return=${encodeURIComponent(hostile)}`));
      expect(setCookies(res).itstings_sp_return).toBe('/playlists');
    }
  });

  it('never sends a client secret', () => {
    const res = login.GET(get('/api/spotify/login'));
    expect(res.headers.get('location')).not.toMatch(/client_secret/);
  });
});

/* ---------------------------------------------------------------------- *
 * GET /api/spotify/callback
 * ---------------------------------------------------------------------- */

describe('GET /api/spotify/callback', () => {
  const handshake = (verifier: string, state: string, returnTo = '/playlists/pl_abc') =>
    `itstings_sp_verifier=${verifier}; itstings_sp_state=${state}; itstings_sp_return=${encodeURIComponent(returnTo)}`;

  const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

  it('turns ?error=access_denied into a readable message on the page it came from', async () => {
    const h = installFetch([]);
    const res = await callback.GET(
      get('/api/spotify/callback?error=access_denied&state=s', handshake(VERIFIER, 's')),
    );

    expect(res.status).toBe(302);
    const location = locationOf(res);
    expect(res.headers.get('location')?.startsWith('/playlists/pl_abc?')).toBe(true);
    expect(location.pathname).toBe('/playlists/pl_abc');
    expect(location.searchParams.get('spotify')).toBe('error');
    expect(location.searchParams.get('spotify_reason')).toBe(
      'you did not authorise It Stings on Spotify, so nothing was pushed.',
    );
    // A refusal costs no token request.
    expect(h.calls).toHaveLength(0);
  });

  it('drops the handshake cookies on the way out of a refusal', async () => {
    installFetch([]);
    const res = await callback.GET(
      get('/api/spotify/callback?error=access_denied', handshake(VERIFIER, 's')),
    );
    for (const name of ['itstings_sp_verifier', 'itstings_sp_state', 'itstings_sp_return']) {
      expect(setCookies(res)[name]).toBe('');
      expect(setCookieLine(res, name)).toMatch(/Max-Age=0/i);
    }
  });

  it('falls back to /playlists when there is no remembered page', async () => {
    installFetch([]);
    const res = await callback.GET(get('/api/spotify/callback?error=access_denied'));
    expect(locationOf(res).pathname).toBe('/playlists');
  });

  it('refuses a mismatched state WITHOUT exchanging the code', async () => {
    const h = installFetch([]);
    const res = await callback.GET(
      get('/api/spotify/callback?code=c&state=forged', handshake(VERIFIER, 'real')),
    );
    const location = locationOf(res);
    expect(location.searchParams.get('spotify')).toBe('error');
    expect(location.searchParams.get('spotify_reason')).toMatch(/could not be matched/);
    expect(h.calls).toHaveLength(0);
    expect(authRepo.get()).toBeNull();
  });

  it('refuses a callback with no code at all', async () => {
    installFetch([]);
    const res = await callback.GET(
      get('/api/spotify/callback?state=s', handshake(VERIFIER, 's')),
    );
    expect(locationOf(res).searchParams.get('spotify_reason')).toMatch(
      /no authorization code/,
    );
  });

  it('says the login expired when the verifier cookie is gone', async () => {
    installFetch([]);
    const res = await callback.GET(
      get('/api/spotify/callback?code=c&state=s', 'itstings_sp_state=s'),
    );
    expect(locationOf(res).searchParams.get('spotify_reason')).toMatch(
      /expired before it finished/,
    );
  });

  it('exchanges the code, stores the tokens and comes back connected', async () => {
    const h = installFetch([
      {
        when: '/api/token',
        body: {
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          expires_in: 3600,
          scope: 'playlist-modify-private',
        },
      },
      { when: '/v1/me', body: { id: 'alice-id', display_name: 'Alice' } },
    ]);

    const res = await callback.GET(
      get('/api/spotify/callback?code=the-code&state=s', handshake(VERIFIER, 's')),
    );

    const location = locationOf(res);
    expect(res.status).toBe(302);
    expect(location.pathname).toBe('/playlists/pl_abc');
    expect(location.searchParams.get('spotify')).toBe('connected');
    expect(location.searchParams.get('spotify_reason')).toBeNull();

    const row = authRepo.get();
    expect(row).toMatchObject({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      scope: 'playlist-modify-private',
      userId: 'alice-id',
      displayName: 'Alice',
    });

    // The verifier went to the token endpoint and nowhere else.
    expect(formOf(h.calls[0].body).code_verifier).toBe(VERIFIER);
    expect(location.href).not.toContain(VERIFIER);
    expect(location.href).not.toContain('fresh-access');
    expect(setCookies(res).itstings_sp_verifier).toBe('');
  });

  it('keeps the token when GET /v1/me fails — a display name is not worth a login', async () => {
    installFetch([
      {
        when: '/api/token',
        body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 },
      },
      { when: '/v1/me', status: 404, body: { error: { status: 404 } } },
    ]);

    const res = await callback.GET(
      get('/api/spotify/callback?code=c&state=s', handshake(VERIFIER, 's')),
    );
    expect(locationOf(res).searchParams.get('spotify')).toBe('connected');
    expect(authRepo.get()).toMatchObject({ accessToken: 'a', displayName: null });
  });

  it('reports a rejected exchange as a sentence and stores nothing', async () => {
    installFetch([
      { when: '/api/token', status: 400, body: { error: 'invalid_grant' } },
    ]);
    const res = await callback.GET(
      get('/api/spotify/callback?code=c&state=s', handshake(VERIFIER, 's')),
    );
    const location = locationOf(res);
    expect(location.searchParams.get('spotify')).toBe('error');
    expect(location.searchParams.get('spotify_reason')).toMatch(/expired or was revoked/);
    expect(authRepo.get()).toBeNull();
  });

  it('refuses to store a login with no refresh token', async () => {
    installFetch([{ when: '/api/token', body: { access_token: 'a', expires_in: 3600 } }]);
    const res = await callback.GET(
      get('/api/spotify/callback?code=c&state=s', handshake(VERIFIER, 's')),
    );
    expect(locationOf(res).searchParams.get('spotify_reason')).toMatch(
      /no refresh token/,
    );
    expect(authRepo.get()).toBeNull();
  });
});

/* ---------------------------------------------------------------------- *
 * POST /api/spotify/logout
 * ---------------------------------------------------------------------- */

describe('POST /api/spotify/logout', () => {
  it('forgets the stored login', async () => {
    authRepo.save({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 1000,
      displayName: 'Alice',
    });

    const res = logout.POST();
    expect(await res.json()).toMatchObject({ ok: true, disconnected: true });
    expect(authRepo.get()).toBeNull();
    expect(await status.GET().json()).toMatchObject({ loggedIn: false, displayName: null });
  });

  it('is a no-op, not an error, when nothing was connected', async () => {
    const res = logout.POST();
    expect(await res.json()).toMatchObject({ ok: true, disconnected: false });
  });
});

/** The form body of a recorded call, parsed. */
function formOf(body: string | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body ?? ''));
}
