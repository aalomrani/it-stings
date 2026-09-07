/**
 * `GET    /api/playlists/[id]` -> the playlist and its items, each track preview-hydrated
 * `PATCH  /api/playlists/[id]` -> rename and/or reorder
 * `DELETE /api/playlists/[id]` -> remove it (items cascade)
 */

import { z } from 'zod';

import { itemsWithTracks, json, jsonError, readJson } from '@/app/api/playlists/shared';
import * as playlists from '@/lib/db/repos/playlists';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const PatchBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    /** Item ids in their new order; ids left out keep their relative order after them. */
    order: z.array(z.number().int().nonnegative()).optional(),
  })
  .refine((b) => b.name !== undefined || b.order !== undefined, {
    message: 'provide name, order, or both',
  });

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const playlist = playlists.get(id);
  if (!playlist) return jsonError(404, 'playlist not found');

  const { items, missing } = await itemsWithTracks(id);
  return json({
    playlist: { ...playlist, count: items.length },
    items,
    ...(missing > 0 ? { degraded: [`${missing} item(s) reference a track no longer in the cache`] } : {}),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  if (!playlists.get(id)) return jsonError(404, 'playlist not found');

  const body = await readJson(request, PatchBody);
  if (!body.ok) return body.response;

  if (body.data.order) playlists.reorder(id, body.data.order);
  if (body.data.name !== undefined) playlists.rename(id, body.data.name);

  const playlist = playlists.get(id);
  if (!playlist) return jsonError(404, 'playlist not found');
  return json({ playlist: { ...playlist, count: playlists.items(id).length } });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!playlists.remove(id)) return jsonError(404, 'playlist not found');
  return json({ ok: true });
}
