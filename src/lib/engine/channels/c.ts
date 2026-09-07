/**
 * Channel C — the primary candidate engine, now keyless.
 *
 * The old Channel C asked a language model to remember music. This one asks Deezer's own
 * catalogue instead: from the seed's Deezer track we read its artist, ask Deezer which
 * artists sit next to it (`GET /artist/{id}/related`, ~20 neighbours), and pull each
 * neighbour's most-played tracks (`GET /artist/{id}/top`). The union — deduped by
 * `trackNormKey`, with the seed's own artist dropped — is a large, on-genre candidate pool
 * with ZERO API keys and no model call.
 *
 * Everything fans out through `sources/deezer`, which routes every request through
 * `fetchExternal` (SQLite cache + per-host throttle; Deezer's code-4-as-200 quota error is
 * handled by `isRetryableBody`). So the related×top fan-out below stays inside Deezer's
 * rate window even on a cold run.
 *
 * Breadth: a thinly-connected seed gets a SECOND related hop (related-of-related) to widen
 * the neighbourhood. A seed Deezer has no related artists for degrades honestly to an empty
 * `done` — Channels A (Last.fm) and B (MusicBrainz tag cohorts) carry the run.
 *
 * Nothing here is verified — every entry is a real Deezer track, but Stage 4 still resolves
 * each one to a full `TrackRecord` before it can be scored or shown.
 */

import * as deezer from '@/lib/sources/deezer';
import type { ChannelContext, ChannelResult, ChannelSpread } from '@/lib/engine/channels/types';
import type { Candidate, Fingerprint, TrackRecord } from '@/lib/types';
import { normArtist, normTitle, trackNormKey } from '@/lib/util/normalize';

/* ------------------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------------------ */

/**
 * Part of the run cache key upstream. Bumped from the LLM-era `ch-c-v2` so a run stored by
 * the old model-prior channel never replays as if this deterministic one produced it.
 */
export const CHANNEL_C_PROMPT_VERSION = 'ch-c-deezer-1';

/** Hard cap on what this channel hands the pipeline, after dedupe. */
export const CHANNEL_C_MAX_CANDIDATES = 60;

/**
 * The Stage-4 drop rate above which the pipeline re-runs this channel with
 * `tightness: 'tight'`. Set ABOVE 1.0 — i.e. DISABLED — on purpose. The retry was a
 * safety valve for the old LLM channel, which could name tracks that did not exist; keyless
 * Deezer never does, so every "drop" now is just the pipeline's one-track-per-artist
 * diversity filter deciding not to verify a candidate, NOT a missing track. Under that
 * filter the measured drop rate is always high, so any reachable threshold fires the retry
 * on every run and doubles this channel's wall-clock for zero benefit. Kept exported so the
 * pipeline's guard needs no change; it simply never triggers.
 */
export const CHANNEL_C_TIGHTEN_DROP_RATE = 1.1;

/** `'tight'` pulls fewer, more canonical tracks per neighbour after a bad drop rate. */
export type Tightness = 'normal' | 'tight';

/** Neighbours (related artists) expanded per run, before the second hop. */
export const RELATED_LIMIT = 20;

/**
 * Top tracks pulled per neighbour: normal vs the stricter `tight` re-run. Kept SMALL on
 * purpose — the pipeline verifies and ships at most ONE track per artist, so a neighbour's
 * top 2-3 (its most-played, most-recognisable tracks) is all that is ever used. Pulling a
 * dozen just let a few popular artists eat the candidate cap and starved the rest; a small
 * per-artist take spreads the cap across MANY more distinct artists, which is what fills the
 * results list when only this channel is producing candidates.
 */
export const TOP_PER_ARTIST_NORMAL = 3;
export const TOP_PER_ARTIST_TIGHT = 2;

/**
 * Below this many distinct neighbours, widen with a second related hop
 * (related-of-related) so a sparsely-connected seed still gets breadth.
 */
export const MIN_NEIGHBOURS_FOR_BREADTH = 12;

/** How many first-hop neighbours seed the second hop. Keeps the fan-out bounded. */
const SECOND_HOP_SEEDS = 6;

/**
 * `ok` when at least three distinct neighbours contributed and no single neighbour
 * dominates. Mirrors the LLM channel's "at least three sources, none over 60%" ask, applied
 * to Deezer neighbours instead of decades (Deezer top tracks carry no release year).
 */
export const MIN_DISTINCT_NEIGHBOURS = 3;
export const MAX_NEIGHBOUR_SHARE = 0.6;

/* ------------------------------------------------------------------------------------ *
 * Options / kept types
 * ------------------------------------------------------------------------------------ */

/**
 * The seed's own name. The pipeline still passes it; the keyless channel already has the
 * whole seed `TrackRecord`, so this is accepted for signature compatibility and used only
 * as a belt-and-braces drop of the seed artist/title.
 */
export interface SeedIdentity {
  artist?: string;
  title?: string;
  album?: string;
}

export interface ChannelCOptions {
  /** `'tight'` after a bad Stage-4 drop rate. Fewer, more canonical picks. */
  tightness?: Tightness;
  /** Accepted for pipeline compatibility; the seed record is the real source of identity. */
  seedIdentity?: SeedIdentity;
  /** Test seam / safety valve. Defaults to `CHANNEL_C_MAX_CANDIDATES`. */
  maxCandidates?: number;
  /** Neighbours to expand. Defaults to `RELATED_LIMIT`. */
  relatedLimit?: number;
  /** Top tracks per neighbour. Defaults by tightness. */
  topPerArtist?: number;
}

/* ------------------------------------------------------------------------------------ *
 * Spread — measured over the neighbours that contributed, not over decades
 * ------------------------------------------------------------------------------------ */

/**
 * The breadth Channel C actually delivered, measured from the neighbours behind its
 * candidates. `ChannelSpread` is shaped around decades (the LLM channel's currency), so the
 * fields are reused with a keyless meaning documented here:
 *   - `decades`   : empty — Deezer top tracks carry no release year to bucket.
 *   - `genres`    : the distinct neighbour artist names that contributed (the real breadth).
 *   - `entries`   : candidates kept.
 *   - `dated`     : distinct contributing neighbours (the base `topDecadeShare` divides by).
 *   - `topDecadeShare` : the share of candidates from the single most-represented neighbour.
 *   - `ok`        : ≥3 distinct neighbours and none over 60% of the pool.
 */
export function measureNeighbourSpread(
  neighbourByCandidate: string[],
  entries: number,
): ChannelSpread {
  const counts = new Map<string, number>();
  for (const name of neighbourByCandidate) {
    const label = name.trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const distinct = [...counts.keys()];
  const attributed = neighbourByCandidate.filter((n) => n.trim().length > 0).length;
  const top = Math.max(0, ...counts.values());
  const topShare = attributed === 0 ? 0 : Math.round((top / attributed) * 1000) / 1000;
  return {
    decades: [],
    genres: distinct,
    entries,
    dated: distinct.length,
    topDecadeShare: topShare,
    ok:
      distinct.length >= MIN_DISTINCT_NEIGHBOURS
      && topShare <= MAX_NEIGHBOUR_SHARE,
  };
}

/* ------------------------------------------------------------------------------------ *
 * The channel
 * ------------------------------------------------------------------------------------ */

function result(
  status: ChannelResult['status'],
  extra: Partial<ChannelResult> = {},
): ChannelResult {
  return { channel: 'C', status, candidates: [], live: false, ...extra };
}

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

/**
 * Deezer related→top candidate generation. Never throws: a missing Deezer id, a Deezer
 * failure or an empty neighbourhood all come back as a `status` and a `reason` the pipeline
 * degrades on, with an empty candidate list.
 */
export async function channelC(
  seed: TrackRecord,
  _fingerprint: Fingerprint,
  ctx: ChannelContext,
  opts: ChannelCOptions = {},
): Promise<ChannelResult> {
  const tightness: Tightness = opts.tightness ?? 'normal';
  const cap = opts.maxCandidates ?? CHANNEL_C_MAX_CANDIDATES;
  const relatedLimit = opts.relatedLimit ?? RELATED_LIMIT;
  const topPerArtist =
    opts.topPerArtist ?? (tightness === 'tight' ? TOP_PER_ARTIST_TIGHT : TOP_PER_ARTIST_NORMAL);

  if (isAborted(ctx.signal)) return result('error', { reason: 'aborted' });

  const deezerId = seed.ids.deezer;
  if (typeof deezerId !== 'number' || !Number.isFinite(deezerId)) {
    ctx.log('channel C: skipped — the seed has no Deezer id to expand from');
    return result('skipped', { reason: 'no Deezer id for the seed' });
  }

  ctx.log(`channel C: Deezer related→top (${tightness}, ${CHANNEL_C_PROMPT_VERSION})`);
  let live = false;

  /* --- Find the seed artist. ------------------------------------------------------- */

  const trackRes = await deezer.getTrack(deezerId);
  if (isAborted(ctx.signal)) return result('error', { reason: 'aborted', live });
  if (!trackRes.ok) {
    ctx.log(`channel C: getTrack(${deezerId}) ${trackRes.reason}`);
    return result('error', { reason: `deezer getTrack: ${trackRes.reason}`, live });
  }
  live ||= !trackRes.fromCache;

  const seedArtistId = trackRes.value.artist.id;
  const seedArtistNorm = normArtist(seed.artist);
  if (typeof seedArtistId !== 'number' || !Number.isFinite(seedArtistId)) {
    ctx.log('channel C: the Deezer track carried no artist id to expand from');
    return result('done', { reason: 'no Deezer artist id for the seed', live });
  }

  /* --- Neighbours: related, widened with a second hop when the seed is sparse. ------ */

  const relatedRes = await deezer.getRelatedArtists(seedArtistId);
  if (isAborted(ctx.signal)) return result('error', { reason: 'aborted', live });
  if (!relatedRes.ok) {
    ctx.log(`channel C: getRelatedArtists(${seedArtistId}) ${relatedRes.reason}`);
    return result('error', { reason: `deezer related: ${relatedRes.reason}`, live });
  }
  live ||= !relatedRes.fromCache;

  // The seed artist never expands itself.
  const neighbours = new Map<number, string>();
  for (const a of relatedRes.value) {
    if (a.id === seedArtistId) continue;
    if (normArtist(a.name) === seedArtistNorm) continue;
    if (!neighbours.has(a.id)) neighbours.set(a.id, a.name);
    if (neighbours.size >= relatedLimit) break;
  }

  if (neighbours.size === 0) {
    ctx.log('channel C: Deezer returned no related artists for the seed');
    return result('done', {
      reason: 'Deezer had no related artists for the seed',
      live,
      spread: measureNeighbourSpread([], 0),
    });
  }

  // Second hop: a sparsely-connected seed borrows the neighbours of its first few
  // neighbours, so breadth does not collapse to a five-artist cluster.
  if (neighbours.size < MIN_NEIGHBOURS_FOR_BREADTH) {
    const seeds = [...neighbours.keys()].slice(0, SECOND_HOP_SEEDS);
    for (const nid of seeds) {
      if (neighbours.size >= relatedLimit) break;
      if (isAborted(ctx.signal)) return result('error', { reason: 'aborted', live });
      const hop = await deezer.getRelatedArtists(nid);
      if (!hop.ok) continue;
      live ||= !hop.fromCache;
      for (const a of hop.value) {
        if (a.id === seedArtistId) continue;
        if (normArtist(a.name) === seedArtistNorm) continue;
        if (!neighbours.has(a.id)) neighbours.set(a.id, a.name);
        if (neighbours.size >= relatedLimit) break;
      }
    }
    ctx.log(`channel C: widened to ${neighbours.size} neighbours via a second related hop`);
  }

  /* --- Each neighbour's top tracks -> the candidate pool. -------------------------- */

  const seedTrackKey = trackNormKey(seed.artist, seed.title);
  const byKey = new Map<string, Candidate>();
  const neighbourOfKey = new Map<string, string>();

  for (const [nid, nname] of neighbours) {
    if (byKey.size >= cap) break;
    if (isAborted(ctx.signal)) return result('error', { reason: 'aborted', live });

    const topRes = await deezer.getArtistTopTracks(nid, topPerArtist);
    if (!topRes.ok) {
      ctx.log(`channel C: getArtistTopTracks(${nid}) ${topRes.reason}`);
      continue;
    }
    live ||= !topRes.fromCache;

    for (const t of topRes.value) {
      const artist = t.artist.name.trim() || nname.trim();
      const title = t.title.trim();
      if (!artist || !title || !normArtist(artist) || !normTitle(title)) continue;

      // Drop the seed's own artist wherever it turns up as a collaborator, and the seed
      // track itself. Same-artist neighbours are cut by rank rule 1 anyway, but a
      // neighbour that credits the seed artist is not this channel's job to ship.
      if (normArtist(artist) === seedArtistNorm) continue;

      const key = trackNormKey(artist, title);
      if (key === seedTrackKey) continue;
      if (byKey.has(key)) continue;
      if (byKey.size >= cap) break;

      const rankHint =
        t.rank > 0
          ? `Deezer: top track of ${nname} (related to ${seed.artist}), popularity rank ${t.rank}`
          : `Deezer: top track of ${nname} (related to ${seed.artist})`;
      byKey.set(key, {
        artist,
        title,
        channels: ['C'],
        hints: [{ modelNote: rankHint }],
      });
      neighbourOfKey.set(key, nname);
    }
  }

  const candidates = [...byKey.values()];
  const spread = measureNeighbourSpread(
    candidates.map((c) => neighbourOfKey.get(trackNormKey(c.artist, c.title)) ?? ''),
    candidates.length,
  );

  ctx.log(
    `channel C: ${candidates.length} candidates from ${neighbours.size} Deezer neighbours ` +
      `(top ${topPerArtist} each) · distinct neighbours ${spread.dated} · ` +
      `top neighbour ${Math.round(spread.topDecadeShare * 100)}% of the pool`,
  );

  return result('done', {
    candidates,
    live,
    spread,
  });
}
