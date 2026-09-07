/**
 * `GET /api/playlists/[id]/export?format=txt|json`
 *
 * txt: a header line naming the playlist, then one `Artist — Title (Year)` per item.
 * json: the playlist plus the fields a human would want to keep — no internal ids, no
 * signed preview URLs (they expire in 15 minutes and would be dead in the file).
 *
 * Both come back as an attachment; Phase 4's export buttons are plain `<a download>`.
 */

import { itemsWithTracks, jsonError, slugify } from '@/app/api/playlists/shared';
import * as playlists from '@/lib/db/repos/playlists';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const FORMATS = new Set(['txt', 'json']);

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get('format') ?? 'txt';
  if (!FORMATS.has(format)) {
    return jsonError(400, "format must be 'txt' or 'json'", { format });
  }

  const playlist = playlists.get(id);
  if (!playlist) return jsonError(404, 'playlist not found');

  const { items } = await itemsWithTracks(id);
  const filename = `${slugify(playlist.name)}.${format}`;
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${filename}"`,
  };

  if (format === 'json') {
    const body = {
      playlist: { ...playlist, count: items.length },
      items: items.map(({ track, why, seedKey }) => ({
        artist: track.artist,
        title: track.title,
        year: track.year?.value ?? null,
        isrc: track.isrc,
        links: track.links,
        why,
        seedKey,
      })),
    };
    return new Response(`${JSON.stringify(body, null, 2)}\n`, {
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const lines = [
    `It Stings · ${playlist.name} · ${items.length} track${items.length === 1 ? '' : 's'}`,
    ...items.map(({ track }) => {
      const year = track.year?.value;
      return `${track.artist} — ${track.title}${year ? ` (${year})` : ''}`;
    }),
  ];
  return new Response(`${lines.join('\n')}\n`, {
    headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
