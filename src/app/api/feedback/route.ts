/**
 * `POST /api/feedback` — record one "this matches" / "not a match" vote and re-learn this
 * browser's weights from all of its votes.
 *
 * Body: `{ seedKey, candidateKey, label:'match'|'not', source:'card'|'added' }`.
 * Response: `{ weights, count }` — the freshly learned `WeightsMap` and how many pairs it
 * was learned from.
 *
 * The flow, all keyless and local:
 *   1. Identify the profile from the `itstings_profile` cookie; if it is missing, mint one
 *      and set it on the response (the proxy normally does this first, but the route stays
 *      self-sufficient so a direct call — or a test — works too).
 *   2. Upsert the vote (a later vote on the same pair replaces the earlier one).
 *   3. Recompute `learnWeights` from ALL of this profile's votes, resolving each track's
 *      cached `FeatureProfile`; a pair whose tracks are not cached is skipped.
 *   4. Persist the learned weights and the vote count on the profile.
 *
 * Multi-user: everything is scoped to the cookie's profile id, so one browser's training
 * never touches another's.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import * as feedbackRepo from '@/lib/db/repos/feedback';
import * as profilesRepo from '@/lib/db/repos/profiles';
import * as tracks from '@/lib/db/repos/tracks';
import { buildFeatureProfile, type FeatureProfile } from '@/lib/engine/featureProfile';
import { learnWeights, pairsFromFeedback } from '@/lib/engine/train';
import { PROFILE_COOKIE, profileCookieOptions, profileIdFrom, requestIsHttps } from '@/lib/profile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const Body = z.object({
  seedKey: z.string().trim().min(1),
  candidateKey: z.string().trim().min(1),
  label: z.enum(['match', 'not']),
  source: z.enum(['card', 'added']),
});

export async function POST(request: Request): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'body must be JSON' },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400, headers: NO_STORE },
    );
  }

  // Identify (or mint) the profile. A minted one is set on the response below.
  const existingId = profileIdFrom(request);
  const profileId = existingId ?? randomUUID();
  const now = Date.now();

  const { seedKey, candidateKey, label, source } = parsed.data;

  // Lazily create the row, then record the vote (upsert on the pair).
  profilesRepo.upsert(profileId, now);
  feedbackRepo.record({ profileId, seedKey, candidateKey, label, source }, now);

  // Re-learn from every vote this profile has cast. Resolving a track to its FeatureProfile
  // is memoised so a hot seed is built once even when it appears in many pairs.
  const rows = feedbackRepo.listForProfile(profileId);
  const cache = new Map<string, FeatureProfile | null>();
  const resolve = (key: string): FeatureProfile | null => {
    if (cache.has(key)) return cache.get(key) ?? null;
    const track = tracks.get(key);
    const profile = track ? buildFeatureProfile(track) : null;
    cache.set(key, profile);
    return profile;
  };

  const weights = learnWeights(pairsFromFeedback(rows, resolve));
  const count = rows.length;
  profilesRepo.setWeights(profileId, weights, count, now);

  const response = NextResponse.json({ weights, count }, { headers: NO_STORE });
  if (!existingId) {
    response.cookies.set(PROFILE_COOKIE, profileId, profileCookieOptions(requestIsHttps(request)));
  }
  return response;
}
