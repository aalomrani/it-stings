/**
 * `GET /api/profile`  -> `{ id, displayName, weights, count }`
 * `POST /api/profile` body `{ displayName }` -> the same shape, after saving the name.
 *
 * The browser's view of its own anonymous training profile. `weights` is the learned
 * `WeightsMap` when this profile has trained anything, or `DEFAULT_DIMENSION_WEIGHTS` when
 * it has not — so the client can seed the weight sliders from it either way. `count` is how
 * many pairs the profile has voted on ("tuned to your N picks").
 *
 * GET never creates a `profiles` row (a visitor who only looks around leaves no trace); it
 * reads the cookie, and if there is no valid one it mints an id, sets the cookie and returns
 * the untrained defaults. POST does write, so it creates the row.
 *
 * Keyless, no external calls, scoped to the cookie's profile — one browser can never read
 * another's.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import * as profilesRepo from '@/lib/db/repos/profiles';
import { DEFAULT_DIMENSION_WEIGHTS, type WeightsMap } from '@/lib/engine/rank';
import { PROFILE_COOKIE, profileCookieOptions, profileIdFrom, requestIsHttps } from '@/lib/profile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

interface ProfileView {
  id: string;
  displayName: string | null;
  weights: WeightsMap;
  count: number;
}

/** Shape a stored profile (or the absence of one) into the response body. */
function view(id: string, row: profilesRepo.Profile | null): ProfileView {
  return {
    id,
    displayName: row?.displayName ?? null,
    weights: row?.weights ?? DEFAULT_DIMENSION_WEIGHTS,
    count: row?.feedbackCount ?? 0,
  };
}

/** Return the response, setting a freshly minted cookie when the request had no valid one. */
function respond(request: Request, existingId: string | null, id: string, view: ProfileView) {
  const response = NextResponse.json(view, { headers: NO_STORE });
  if (!existingId) {
    response.cookies.set(PROFILE_COOKIE, id, profileCookieOptions(requestIsHttps(request)));
  }
  return response;
}

export function GET(request: Request): NextResponse {
  const existingId = profileIdFrom(request);
  const id = existingId ?? randomUUID();
  // Do NOT create a row here: reading is not training.
  const row = existingId ? profilesRepo.get(id) : null;
  return respond(request, existingId, id, view(id, row));
}

const Body = z.object({
  displayName: z
    .string()
    .trim()
    .max(80)
    .transform((s) => (s.length === 0 ? null : s))
    .nullable()
    .optional(),
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

  const existingId = profileIdFrom(request);
  const id = existingId ?? randomUUID();
  const displayName = parsed.data.displayName ?? null;

  const row = profilesRepo.setName(id, displayName, Date.now());
  return respond(request, existingId, id, view(id, row));
}
