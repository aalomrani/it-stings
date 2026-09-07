/**
 * The training half of the browser's API surface: the "this matches" votes and the
 * anonymous per-browser profile they teach.
 *
 * Every call is same-origin, so the `itstings_profile` cookie (httpOnly — JS cannot read
 * it) rides along on its own with the default `credentials: 'same-origin'`; the endpoints
 * hand back the `id` and the freshly learned weights, so the client never needs to see the
 * cookie itself. Mirrors `@/lib/client/api.ts` (the same `getJson`, the same `no-store`).
 */

import type { WeightsMap } from '@/lib/engine/rank';

export type FeedbackLabel = 'match' | 'not';
export type FeedbackSource = 'card' | 'added';

/** What `POST /api/feedback` returns: the re-learned map and the vote count behind it. */
export interface FeedbackResult {
  weights: WeightsMap;
  count: number;
}

/** The browser's view of its own training profile (GET/POST `/api/profile`). */
export interface ProfileView {
  id: string;
  displayName: string | null;
  /** The learned map, or the engine defaults when this profile has trained nothing. */
  weights: WeightsMap;
  count: number;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body as T;
}

/**
 * Record one vote and get this browser's re-learned weights back. A re-post of the same
 * `(seedKey, candidateKey)` pair replaces the earlier label rather than adding a second row.
 */
export async function postFeedback(vote: {
  seedKey: string;
  candidateKey: string;
  label: FeedbackLabel;
  source: FeedbackSource;
}): Promise<FeedbackResult> {
  return getJson<FeedbackResult>('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vote),
  });
}

/** Read this browser's profile. Never creates a row — a visitor who only looks leaves none. */
export async function getProfile(): Promise<ProfileView> {
  return getJson<ProfileView>('/api/profile');
}

/** Save a display name (`''` clears it) and get the profile back. */
export async function setName(displayName: string | null): Promise<ProfileView> {
  return getJson<ProfileView>('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
}
