'use client';

/**
 * "push to spotify" — the optional block at the top of a playlist page.
 *
 * Three states, and the FIRST one is the one that matters most:
 *
 *  - `SPOTIFY_CLIENT_ID` unset -> no button at all, one mono line naming the two variables
 *    to set and the dashboard to get them from. The feature is invisible, but never silently
 *    missing: a control that could only fail is worse than a sentence explaining why there
 *    is no control.
 *  - configured, not connected -> the button, above it the MANDATORY Development Mode note.
 *    Spotify caps a dev-mode app at five allowlisted users and requires the app owner to hold
 *    Premium (docs/api-reality.md §3.5); somebody clicking this deserves to know that before
 *    they are bounced to an account screen, not after.
 *  - connected -> the button pushes, and the result is a link to the new private playlist
 *    plus every skipped track, by name, with the reason it was skipped.
 *
 * The round trip through Spotify comes back as `?spotify=connected|error` on this page;
 * that is read from `window.location` in an effect rather than through `useSearchParams`,
 * which would force this dynamic page into a Suspense boundary for one string. The query is
 * then removed with `replaceState` so a reload does not re-announce a login from ten
 * minutes ago.
 */

import { useCallback, useEffect, useState } from 'react';

import styles from './spotifyPush.module.css';

/**
 * Verbatim, and not paraphrased anywhere: this is the sentence the task contract requires
 * to appear before a login.
 */
export const DEV_MODE_NOTE =
  'Only works for Spotify accounts registered as test users in the Spotify dashboard — ' +
  'Development Mode caps this at 5 users (the app owner needs Premium).';

export const DASHBOARD_URL = 'https://developer.spotify.com/dashboard';

/** The default the server also uses when `SPOTIFY_REDIRECT_URI` is unset (`src/lib/env.ts`). */
export const EXAMPLE_REDIRECT_URI = 'http://127.0.0.1:3000/api/spotify/callback';

interface Status {
  configured: boolean;
  loggedIn: boolean;
  displayName: string | null;
}

interface Skipped {
  artist: string;
  title: string;
  reason: string;
}

interface PushResult {
  url: string | null;
  added: number;
  skipped: Skipped[];
  message?: string;
}

export interface SpotifyPushProps {
  playlistId: string;
  /** Rendered nowhere; it decides whether the button has anything to push. */
  itemCount: number;
}

/**
 * What the OAuth round trip left in the address bar, read once. A lazy `useState`
 * initializer rather than an effect: on the server it reads nothing and this component
 * renders `null` anyway (there is no status yet), so the hydrated first render matches.
 */
function readOutcome(): { result: 'connected' | 'error'; reason: string | null } | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get('spotify');
  if (outcome !== 'connected' && outcome !== 'error') return null;
  return { result: outcome, reason: params.get('spotify_reason') };
}

export function SpotifyPush({ playlistId, itemCount }: SpotifyPushProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState(readOutcome);

  useEffect(() => {
    let live = true;
    fetch('/api/spotify/status', { cache: 'no-store' })
      .then((res) => res.json() as Promise<Status>)
      .then((body) => {
        if (live) setStatus(body);
      })
      .catch(() => {
        // The status route is local and cannot really fail, but if it does the honest
        // reading is "this feature is not available", not a button that throws.
        if (live) setStatus({ configured: false, loggedIn: false, displayName: null });
      });
    return () => {
      live = false;
    };
  }, []);

  /**
   * The message has been read into state; take it out of the address bar so a reload does
   * not re-announce a login from ten minutes ago. Touching `history` is talking to an
   * external system, which is what an effect is for — no state is set here.
   */
  useEffect(() => {
    if (!outcome || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('spotify')) return;
    params.delete('spotify');
    params.delete('spotify_reason');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [outcome]);

  const push = useCallback(() => {
    setBusy(true);
    setPushError(null);
    setOutcome(null);
    setResult(null);
    fetch(`/api/playlists/${encodeURIComponent(playlistId)}/push`, {
      method: 'POST',
      cache: 'no-store',
    })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            body && typeof body === 'object' && 'error' in body
              ? String((body as { error: unknown }).error)
              : `${res.status} ${res.statusText}`;
          throw new Error(message);
        }
        return body as PushResult;
      })
      .then(setResult)
      .catch((err: unknown) => {
        setPushError(err instanceof Error ? err.message : 'the push failed');
        if (err instanceof Error && /connect/i.test(err.message)) {
          setStatus((prev) => (prev ? { ...prev, loggedIn: false, displayName: null } : prev));
        }
      })
      .finally(() => setBusy(false));
  }, [playlistId]);

  const disconnect = useCallback(() => {
    setBusy(true);
    fetch('/api/spotify/logout', { method: 'POST', cache: 'no-store' })
      .then(() => {
        setStatus((prev) => (prev ? { ...prev, loggedIn: false, displayName: null } : prev));
        setResult(null);
        setOutcome(null);
      })
      .catch(() => setPushError('could not disconnect'))
      .finally(() => setBusy(false));
  }, []);

  // Nothing is drawn until the server has said whether this feature exists at all — a
  // button that appears and then vanishes is worse than a beat of nothing.
  if (!status) return null;

  if (!status.configured) {
    return (
      <div className={styles.push}>
        <span className={styles.lbl}>spotify push</span>
        <p className={styles.note}>
          off. Set <code>SPOTIFY_CLIENT_ID</code> and{' '}
          <code>SPOTIFY_REDIRECT_URI={EXAMPLE_REDIRECT_URI}</code> from an app at{' '}
          <a href={DASHBOARD_URL} target="_blank" rel="noreferrer">
            {DASHBOARD_URL}
          </a>
          , then reload. The redirect URI must be a <code>127.0.0.1</code> loopback literal —
          Spotify rejects <code>localhost</code>. No client secret is needed: this uses PKCE.
        </p>
      </div>
    );
  }

  const loginHref = `/api/spotify/login?return=${encodeURIComponent(`/playlists/${playlistId}`)}`;
  const error =
    pushError ??
    (outcome?.result === 'error' ? (outcome.reason ?? 'the Spotify login failed.') : null);
  const justConnected = outcome?.result === 'connected';

  return (
    <div className={styles.push}>
      <span className={styles.lbl}>spotify push</span>

      {status.loggedIn ? null : <p className={styles.devnote}>{DEV_MODE_NOTE}</p>}

      {error ? (
        <p className={styles.err} role="status">
          {error}
        </p>
      ) : null}

      {justConnected && status.loggedIn && !result ? (
        <p className={styles.done} role="status">
          connected. push this playlist whenever you like.
        </p>
      ) : null}

      {result ? (
        <p className={result.url ? styles.done : styles.note} role="status">
          {result.url ? (
            <>
              {result.added} track{result.added === 1 ? '' : 's'} pushed —{' '}
              <a href={result.url} target="_blank" rel="noreferrer">
                open the playlist on spotify
              </a>
              .
            </>
          ) : (
            (result.message ?? 'nothing was pushed.')
          )}
        </p>
      ) : null}

      {result && result.skipped.length > 0 ? (
        <ul className={styles.skips}>
          {result.skipped.map((skip) => (
            <li key={`${skip.artist}—${skip.title}`} className={styles.skip}>
              skipped <b>{skip.artist}</b> — <b>{skip.title}</b>: {skip.reason}
            </li>
          ))}
        </ul>
      ) : null}

      <div className={styles.row}>
        {status.loggedIn ? (
          <button
            className="btn"
            type="button"
            onClick={push}
            disabled={busy || itemCount === 0}
            aria-label="Push this playlist to Spotify"
          >
            {busy ? 'pushing…' : 'push to spotify'}
          </button>
        ) : (
          <a className={`btn ${styles.linkBtn}`} href={loginHref}>
            push to spotify
          </a>
        )}

        {status.loggedIn ? (
          <>
            <span className={styles.who}>
              connected as <b>{status.displayName ?? 'your spotify account'}</b>
            </span>
            <button className="btn bare" type="button" onClick={disconnect} disabled={busy}>
              disconnect
            </button>
          </>
        ) : (
          <span className={styles.who}>you will be sent to spotify to authorise first</span>
        )}
      </div>

      {itemCount === 0 && status.loggedIn ? (
        <p className={styles.note}>nothing saved in this playlist yet, so there is nothing to push.</p>
      ) : null}
    </div>
  );
}
