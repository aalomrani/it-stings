/**
 * Stage 4 — verification. "Every candidate must resolve to a real, findable track in
 * iTunes or Deezer. Anything that doesn't resolve is dropped silently. Non-negotiable."
 * (docs/spec.md). This file is the whole of that promise, and the reason a model can
 * never invent a song into the result list.
 *
 * Order, from cheapest to dearest:
 *   1. the `verifications` table — MISSES ARE CACHED TOO, which is the point: a
 *      hallucinated title must cost one lookup ever, not one per run;
 *   2. `tracks.findByNorm` — we may already have resolved it under another name;
 *   3. Deezer search (no key, 45 req/5 s) with the shared `pickBestMatch` rule;
 *   4. iTunes search (20 req/min) with the same rule;
 *   5. `resolveTrack` on the winner, which caches the full record.
 *
 * A hit counts only when the normalised ARTIST and TITLE both match. Title matching
 * tolerates "(Remastered)" and friends; it does not tolerate a different song.
 */

import * as tracksRepo from '@/lib/db/repos/tracks';
import * as verificationsRepo from '@/lib/db/repos/verifications';
import * as deezer from '@/lib/sources/deezer';
import * as itunes from '@/lib/sources/itunes';
import { log } from '@/lib/sources/common';
import { hydratePreview } from '@/lib/resolve/hydratePreview';
import { resolveTrack } from '@/lib/resolve/resolveTrack';
import type { TrackRecord } from '@/lib/types';
import {
  artistOverlap,
  featuredArtists,
  normArtist,
  sameTitle,
  trackNormKey,
} from '@/lib/util/normalize';

export interface CandidateName {
  artist: string;
  title: string;
}

export type VerifyResult =
  | { ok: true; track: TrackRecord; cached: boolean }
  | { ok: false; reason: 'not_found' | 'ambiguous' | 'error' };

/** A verification (hit or miss) is trusted for 30 days. */
export const VERIFICATION_MAX_AGE_MS = 30 * 86_400_000;

export async function verifyCandidate(
  candidate: CandidateName,
  opts: { force?: boolean } = {},
): Promise<VerifyResult> {
  const artist = candidate.artist?.trim() ?? '';
  const title = candidate.title?.trim() ?? '';
  if (!artist || !title) return { ok: false, reason: 'not_found' };

  /* ---- 1. the verification cache (hits AND misses) ---------------------------- */
  if (!opts.force) {
    const cached = safe(() => verificationsRepo.get(artist, title), null);
    if (cached && Date.now() - cached.checkedAt < VERIFICATION_MAX_AGE_MS) {
      if (cached.trackKey === null) {
        log(`verify ${artist} — ${title}: miss (cached)`);
        return { ok: false, reason: 'not_found' };
      }
      const stored = safe(() => tracksRepo.get(cached.trackKey as string), null);
      if (stored) {
        log(`verify ${artist} — ${title}: hit ${stored.key} (cached)`);
        return { ok: true, track: await hydratePreview(stored), cached: true };
      }
      // The verification points at a track row that is gone; fall through and redo it.
    }

    /* ---- 2. an already-resolved track under this name ------------------------- */
    const known = safe(() => tracksRepo.findByNorm(artist, title), null);
    if (known) {
      record(artist, title, known.key);
      log(`verify ${artist} — ${title}: hit ${known.key} (tracks)`);
      return { ok: true, track: await hydratePreview(known), cached: true };
    }
  }

  /* ---- 3. Deezer first: no key, generous limit, carries the ISRC -------------- */
  const hits = await deezer.searchTrack(artist, title);
  if (hits.ok) {
    const best = deezer.pickBestMatch(hits.value, { artist, title });
    const bestFullTitle = best ? `${best.title} ${best.titleVersion}`.trim() : '';
    if (best && matches(best.artist.name, best.titleShort, artist, title, bestFullTitle)) {
      const resolved = await resolveTrack({
        deezerId: best.id,
        ...(best.isrc ? { isrc: best.isrc } : {}),
        artist,
        title,
        ...(best.duration ? { durationMs: best.duration * 1000 } : {}),
      });
      return finish(artist, title, resolved, `deezer:${best.id}`, bestFullTitle);
    }
  }

  /* ---- 4. iTunes second: the verifier's fallback, same match rule ------------- */
  const viaItunes = await itunes.findTrack(artist, title);
  if (viaItunes.ok && matches(viaItunes.value.artist, viaItunes.value.title, artist, title)) {
    const hit = viaItunes.value;
    const resolved = await resolveTrack({
      itunesId: hit.itunesId,
      artist,
      title,
      ...(hit.durationMs ? { durationMs: hit.durationMs } : {}),
    });
    return finish(artist, title, resolved, `itunes:${hit.itunesId}`, hit.title);
  }

  /* ---- 5. a verified miss is worth caching ----------------------------------- */
  record(artist, title, null);
  log(`verify ${artist} — ${title}: miss`);
  return { ok: false, reason: 'not_found' };
}

export interface VerifyManyOptions {
  concurrency?: number;
  force?: boolean;
  /**
   * The run's abort signal. Checked between candidates, so a client that disconnects stops
   * costing MusicBrainz and Deezer requests within one in-flight lookup. Work already done
   * is already cached, so nothing is wasted.
   */
  signal?: AbortSignal;
  /**
   * Called the moment each candidate settles, so the caller can stream a result instead of
   * waiting for the whole batch. Throwing from it is swallowed — the batch is not the
   * place to lose 14 verified tracks because one listener failed.
   */
  onVerified?: (key: string, result: VerifyResult, candidate: CandidateName) => void;
}

/**
 * Verify many candidates without hammering Deezer: duplicates collapse by
 * `trackNormKey` BEFORE any request goes out, and at most `concurrency` lookups are in
 * flight. Returns one entry per distinct normalised candidate, keyed by `trackNormKey`.
 */
export async function verifyMany(
  candidates: CandidateName[],
  { concurrency = 6, force = false, signal, onVerified }: VerifyManyOptions = {},
): Promise<Map<string, VerifyResult>> {
  const unique = new Map<string, CandidateName>();
  for (const candidate of candidates) {
    const artist = candidate.artist?.trim() ?? '';
    const title = candidate.title?.trim() ?? '';
    if (!artist || !title) continue;
    const key = trackNormKey(artist, title);
    if (!unique.has(key)) unique.set(key, { artist, title });
  }

  const entries = [...unique.entries()];
  const out = new Map<string, VerifyResult>();
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < entries.length) {
      // Nobody is listening any more: stop pulling work rather than spending the next
      // minute of MusicBrainz's strictly-serial budget on an abandoned run.
      if (signal?.aborted) return;
      const index = next++;
      const [key, candidate] = entries[index];
      let result: VerifyResult;
      try {
        result = await verifyCandidate(candidate, { force });
      } catch (err) {
        log(`verify ${candidate.artist} — ${candidate.title}: error ${String(err)}`);
        result = { ok: false, reason: 'error' };
      }
      out.set(key, result);
      if (onVerified && !signal?.aborted) {
        try {
          onVerified(key, result, candidate);
        } catch {
          /* a listener's failure never costs the batch */
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, entries.length)) }, worker),
  );
  return out;
}

/** The key `verifyMany` uses, exported so callers can look their candidate back up. */
export const verificationKey = trackNormKey;

/**
 * Edition words that mean a DIFFERENT PERFORMANCE, not a different pressing. `sameTitle`
 * strips them as edition markers — which is right for "(2018 Remaster)" and wrong for
 * "(Live)": a bare candidate title asked for the studio recording, and a school band's
 * live cover is not it.
 */
const DIFFERENT_PERFORMANCE = /\b(live|karaoke|tribute|cover|instrumental|remix|mixed)\b/i;

/**
 * The Stage-4 gate: a hit is the candidate only when the TITLE matches, the performance is
 * the one that was asked for, and the ARTIST matches — either as the credited act (allowing
 * extra credited acts, `artistOverlap`) or as an explicitly featured guest, so
 * "Haley Reinhart — Creep" reaches "…Postmodern Jukebox — Creep (feat. Haley Reinhart)".
 *
 * `fullTitle` is the UNSHORTENED title (Deezer's `title` + `title_version`). It matters:
 * the matched form is `title_short`, which has already had "(Live)" and "(feat. X)" cut
 * out of it, so both the performance check and the guest lookup have to read the original.
 */
function matches(
  hitArtist: string,
  hitTitle: string,
  artist: string,
  title: string,
  fullTitle: string = hitTitle,
): boolean {
  if (!sameTitle(hitTitle, title)) return false;
  if (DIFFERENT_PERFORMANCE.test(fullTitle) && !DIFFERENT_PERFORMANCE.test(title)) return false;
  if (artistOverlap(hitArtist, artist)) return true;
  return featuredArtists(fullTitle).includes(normArtist(artist));
}

async function finish(
  artist: string,
  title: string,
  resolved: Awaited<ReturnType<typeof resolveTrack>>,
  where: string,
  /** The full title of the hit we accepted, so a guest credit survives the re-check. */
  hitFullTitle?: string,
): Promise<VerifyResult> {
  if (!resolved.ok) {
    log(`verify ${artist} — ${title}: error resolving ${where} (${resolved.reason})`);
    return { ok: false, reason: resolved.reason === 'not_found' ? 'not_found' : 'error' };
  }
  // Defensive: the resolver picks its own best edition, so re-check what came back. This
  // is a real check now that the record's artist and title come from a SOURCE rather than
  // from the caller's own strings — it used to compare the query against itself.
  if (
    !matches(
      resolved.track.artist,
      resolved.track.title,
      artist,
      title,
      hitFullTitle ?? resolved.track.title,
    )
  ) {
    log(
      `verify ${artist} — ${title}: ambiguous — resolved to ` +
        `${resolved.track.artist} — ${resolved.track.title}`,
    );
    return { ok: false, reason: 'ambiguous' };
  }
  record(artist, title, resolved.track.key);
  log(`verify ${artist} — ${title}: hit ${resolved.track.key} via ${where}`);
  return { ok: true, track: resolved.track, cached: resolved.cached };
}

function record(artist: string, title: string, trackKey: string | null): void {
  safe(() => {
    verificationsRepo.set(artist, title, trackKey);
    return null;
  }, null);
}

/** The verifier must never take a run down because SQLite hiccuped. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
