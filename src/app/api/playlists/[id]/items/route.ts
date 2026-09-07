/**
 * `POST   /api/playlists/[id]/items` -> append a track (idempotent per track)
 * `DELETE /api/playlists/[id]/items` -> remove one item and re-pack positions
 *
 * `trackKey` must already exist in `tracks`: the app only ever saves a track it resolved,
 * and a playlist row pointing at nothing would be a lie in the export.
 */

import { z } from 'zod';

import { hydratedTrack, json, jsonError, readJson } from '@/app/api/playlists/shared';
import * as playlists from '@/lib/db/repos/playlists';
import * as tracks from '@/lib/db/repos/tracks';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const AddBody = z.object({
  trackKey: z.string().trim().min(1),
  /** The one-sentence reason from the run this track was saved out of. */
  why: z.string().trim().max(500).optional(),
  /** The seed the run started from, so the playlist row can say where it came from. */
  seedKey: z.string().trim().min(1).optional(),
});

const RemoveBody = z.object({ itemId: z.number().int().nonnegative() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!playlists.get(id)) return jsonError(404, 'playlist not found');

  const body = await readJson(request, AddBody);
  if (!body.ok) return body.response;

  if (!tracks.get(body.data.trackKey)) {
    return jsonError(404, 'track not found: resolve it before saving it', {
      trackKey: body.data.trackKey,
    });
  }

  const existing = playlists
    .items(id)
    .find((i) => i.trackKey === body.data.trackKey);

  const item = playlists.addItem(id, {
    trackKey: body.data.trackKey,
    why: body.data.why ?? null,
    seedKey: body.data.seedKey ?? null,
  });
  if (!item) return jsonError(500, 'could not add the track');

  const track = await hydratedTrack(item.trackKey);
  return json(
    {
      item: {
        id: item.id,
        position: item.position,
        track,
        why: item.why,
        seedKey: item.seedKey,
        addedAt: item.addedAt,
      },
      // Adding the same track twice is a no-op that returns the item already there.
      alreadyPresent: Boolean(existing),
    },
    { status: existing ? 200 : 201 },
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  if (!playlists.get(id)) return jsonError(404, 'playlist not found');

  const body = await readJson(request, RemoveBody);
  if (!body.ok) return body.response;

  if (!playlists.removeItem(id, body.data.itemId)) {
    return jsonError(404, 'item not found in this playlist', { itemId: body.data.itemId });
  }
  return json({ ok: true });
}
