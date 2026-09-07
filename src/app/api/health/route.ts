import { NextResponse } from 'next/server';

import pkg from '../../../../package.json';
import { getDb, getDbPath } from '@/lib/db';
import * as runs from '@/lib/db/repos/runs';
import * as tracks from '@/lib/db/repos/tracks';
import { keys } from '@/lib/env';
import { gateEnabled, runCaps } from '@/lib/gate';
import * as acousticbrainz from '@/lib/sources/acousticbrainz';
import * as deezer from '@/lib/sources/deezer';
import * as getsongbpm from '@/lib/sources/getsongbpm';
import * as itunes from '@/lib/sources/itunes';
import * as lastfm from '@/lib/sources/lastfm';
import * as musicbrainz from '@/lib/sources/musicbrainz';
import * as spotify from '@/lib/sources/spotify';
import * as websearch from '@/lib/sources/websearch';

/** Opens the database (and therefore runs migrations) on every call — never cache it. */
export const dynamic = 'force-dynamic';

/**
 * `GET /api/health` — which keys are configured, how this instance is fenced, and what
 * the local database holds. Makes NO network calls: it must answer instantly and offline.
 * Key VALUES never appear here, only presence flags — and that goes for the invite token
 * too: `gate` says whether one is set, never what it is.
 *
 * The route is deliberately outside the gate (`src/lib/gate.ts`, BYPASS_PREFIXES) because
 * Docker's and Fly's health checks run without a cookie. That is also why the UI can read
 * `gate` before anyone has been let in, and print "invite-only instance" in the
 * provenance foot: a fence the reader cannot see is a fence they cannot explain to the
 * friend whose link did not work.
 */
export function GET() {
  getDb();
  return NextResponse.json(
    {
      ok: true,
      keys,
      // Is `ITSTINGS_ACCESS_TOKEN` set — never the token itself.
      gate: gateEnabled(),
      // The cost caps this instance is running under. `null` means uncapped, which is
      // what an unconfigured local run is.
      caps: runCaps(),
      // Each source client's own view of itself: does it need a key, and does it have one.
      // Still no network calls — `describe()` reads the parsed environment, nothing else.
      sources: [
        itunes.describe(),
        deezer.describe(),
        musicbrainz.describe(),
        acousticbrainz.describe(),
        lastfm.describe(),
        spotify.describe(),
        websearch.describe(),
        getsongbpm.describe(),
      ],
      db: { path: getDbPath(), tracks: tracks.count(), runs: runs.count() },
      version: pkg.version,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
