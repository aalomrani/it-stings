/**
 * `GET /api/runs/[id]` -> `{ run }`, the stored `RunRecord`.
 *
 * The recommend stream is the live view of a run; this is the record of one that already
 * happened, so a result page can be re-opened (or a bug report filed) without re-running
 * the pipeline.
 *
 * Every track goes back through `hydratePreview` on the way out. The stored record holds
 * no Deezer preview URL by design — they are HMAC-signed and dead 15 minutes after minting
 * (docs/architecture.md, "Preview audio") — so a run re-opened tomorrow gets audio that
 * plays instead of an Akamai 403.
 */

import { NextResponse } from 'next/server';

import * as runs from '@/lib/db/repos/runs';
import { hydratePreview } from '@/lib/resolve/hydratePreview';
import type { Recommendation, TrackRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

async function freshPreview(track: TrackRecord): Promise<TrackRecord> {
  try {
    return await hydratePreview(track);
  } catch {
    return { ...track, preview: null };
  }
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const stored = runs.get(id);
  if (!stored) {
    return NextResponse.json(
      { error: 'run not found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const results: Recommendation[] = [];
  for (const rec of stored.results) {
    results.push({ ...rec, track: await freshPreview(rec.track) });
  }
  const run = { ...stored, seed: await freshPreview(stored.seed), results };

  return NextResponse.json({ run }, { headers: { 'Cache-Control': 'no-store' } });
}
