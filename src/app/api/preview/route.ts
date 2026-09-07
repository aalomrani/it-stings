import { NextResponse } from 'next/server';

import { previewForKey } from '@/lib/resolve/hydratePreview';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * `GET /api/preview?key=<trackKey>` -> `{ url, source, expiresAt }` or `{ url: null }`.
 *
 * Deezer preview URLs are HMAC-signed and expire 900 s after minting, so the player calls
 * this route again whenever `expiresAt` has passed or playback errors. Never cached: a
 * cached answer here is a 403 waiting to happen.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const key = new URL(request.url).searchParams.get('key')?.trim() ?? '';
  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400, headers: NO_STORE });
  }

  try {
    const preview = await previewForKey(key);
    if (preview === undefined) {
      return NextResponse.json({ error: 'unknown track key' }, { status: 404, headers: NO_STORE });
    }
    if (!preview) {
      return NextResponse.json({ url: null }, { headers: NO_STORE });
    }
    return NextResponse.json(
      { url: preview.url, source: preview.source, expiresAt: preview.expiresAt },
      { headers: NO_STORE },
    );
  } catch (err) {
    return NextResponse.json(
      { url: null, error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: NO_STORE },
    );
  }
}
