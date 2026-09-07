/**
 * `GET  /api/playlists`  -> every playlist with its track count
 * `POST /api/playlists`  -> create one
 *
 * This is the Phase 4 backend, shipped in Phase 1 so the save button in Phase 2 has
 * somewhere to write. Playlists are the only user-authored data in the app.
 */

import { z } from 'zod';

import { json, readJson } from '@/app/api/playlists/shared';
import * as playlists from '@/lib/db/repos/playlists';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  // Duplicate names are allowed on purpose: this is a single-user app and "new playlist"
  // twice in a row should not be an error.
  name: z.string().trim().min(1, 'name must not be empty').max(80, 'name must be <= 80 chars'),
});

export function GET() {
  return json({
    playlists: playlists.list().map((p) => ({
      id: p.id,
      name: p.name,
      count: p.count,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  });
}

export async function POST(request: Request) {
  const body = await readJson(request, CreateBody);
  if (!body.ok) return body.response;
  const playlist = playlists.create(body.data.name);
  return json({ playlist: { ...playlist, count: 0 } }, { status: 201 });
}
