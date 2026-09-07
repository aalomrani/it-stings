import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveTrack } from '@/lib/resolve/resolveTrack';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * The body the UI sends on selecting a typeahead hit. Everything is optional except a
 * name, because a candidate may arrive with only an artist and a title — but at least one
 * identity (an id, an ISRC, or an artist+title pair) has to be present.
 */
const BodySchema = z.object({
  itunesId: z.number().int().positive().optional(),
  deezerId: z.number().int().positive().optional(),
  isrc: z.string().min(12).max(15).optional(),
  artist: z.string().trim().min(1),
  title: z.string().trim().min(1),
  durationMs: z.number().int().positive().optional(),
  force: z.boolean().optional(),
});
// Unknown keys are STRIPPED, not rejected: the UI posts the typeahead hit it has, which
// carries artwork and preview fields this route does not need.

/**
 * `POST /api/resolve` -> `{ track: TrackRecord }`.
 *
 * The record comes back with a freshly minted preview and with `degraded[]` listing every
 * source that failed or was skipped, so the UI can be honest about what it does not know.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400, headers: NO_STORE });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid body',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400, headers: NO_STORE },
    );
  }

  const { force, ...input } = parsed.data;
  try {
    const result = await resolveTrack(input, { force: force ?? false });
    if (!result.ok) {
      const status = result.reason === 'invalid_request' ? 400 : result.reason === 'not_found' ? 404 : 502;
      return NextResponse.json(
        { error: result.reason, detail: result.detail },
        { status, headers: NO_STORE },
      );
    }
    return NextResponse.json({ track: result.track, cached: result.cached }, { headers: NO_STORE });
  } catch (err) {
    // Nothing below this line should throw; if it does, the answer is still JSON.
    return NextResponse.json(
      { error: 'resolve failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: NO_STORE },
    );
  }
}
