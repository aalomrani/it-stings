import { NextResponse } from 'next/server';

import { searchSongs, type TypeaheadHit } from '@/lib/sources/itunes';

/** Typeahead must never be served from Next's data cache. */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * The longest term worth forwarding. iTunes' typeahead budget is 20 requests per minute;
 * a 5 000-character paste used to be forwarded and RETRIED, spending three of them and
 * 4.5 s before answering 502. Nothing useful is ever typed past 200 characters.
 */
const MAX_TERM_LENGTH = 200;

/**
 * `GET /api/search?q=` — iTunes typeahead, 8 hits.
 *
 * A query shorter than two characters answers `{ hits: [] }` WITHOUT calling iTunes:
 * one-character prefixes match nothing useful (verified) and would burn the 20/min
 * budget on every keystroke. An oversized one is rejected at the edge for the same
 * reason. Errors are JSON, never an HTML error page, and no key or upstream URL is ever
 * exposed — this route is the browser's only door to iTunes.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ hits: [] as TypeaheadHit[] }, { headers: NO_STORE });
  }
  if (q.length > MAX_TERM_LENGTH) {
    return NextResponse.json(
      {
        hits: [] as TypeaheadHit[],
        error: 'invalid_request',
        message: `q must be at most ${MAX_TERM_LENGTH} characters`,
      },
      { status: 400, headers: NO_STORE },
    );
  }

  const res = await searchSongs(q, { limit: 8 });
  if (!res.ok) {
    return NextResponse.json(
      { hits: [] as TypeaheadHit[], error: res.reason },
      { status: res.reason === 'invalid_request' ? 400 : 502, headers: NO_STORE },
    );
  }
  return NextResponse.json({ hits: res.value.slice(0, 8) }, { headers: NO_STORE });
}
