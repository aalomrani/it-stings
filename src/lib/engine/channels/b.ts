/**
 * Channel B — tag-cohort discovery, now keyless.
 *
 * The old Channel B searched the open web and asked a model to pull song recommendations
 * out of forum prose. This one asks MusicBrainz's own catalogue instead: take the seed's
 * two or three strongest normalised tags, AND them into one quoted Lucene query
 * (`tag:"swing" AND tag:"electro swing"`), and keep the recordings MusicBrainz scores at or
 * above 85. It is the FILL channel — it broadens breadth for seeds the Deezer-related
 * backbone (Channel C) covers thinly — and it needs ZERO API keys and no model call.
 *
 * Everything runs through `sources/musicbrainz.searchRecordingsByTags`, which quotes every
 * tag (mandatory: an unquoted multi-word tag explodes to ~1M junk) and routes through
 * `fetchExternal` (cache + throttle). Dedupe-by-artist, the seed-artist drop and the
 * candidate cap are this file's job.
 *
 * A seed with fewer than two usable tags is skipped honestly — there is no cohort to
 * search — and the run stands on Channels C and A.
 */

import * as musicbrainz from '@/lib/sources/musicbrainz';
import type { MbRecording } from '@/lib/sources/musicbrainz';
import { fail, type SourceResult } from '@/lib/sources/common';
import { withDeadline } from '@/lib/util/deadline';
import { normalizeTags, type WeightedTag } from '@/lib/util/genreTags';
import type { Candidate, Fingerprint, TrackRecord } from '@/lib/types';
import { normArtist, trackNormKey } from '@/lib/util/normalize';

import type { ChannelContext, ChannelResult } from './types';

/* ------------------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------------------ */

/** Part of the run cache key upstream. Bumped from the LLM-era `channelB-extract-2`. */
export const CHANNEL_B_PROMPT_VERSION = 'channelB-mbtags-1';

/** The channel's candidate cap, before verification. */
export const MAX_CANDIDATES = 40;

/** MusicBrainz recordings requested per cohort query. */
export const SEARCH_LIMIT = 50;

/** MusicBrainz relevance floor; the source enforces it too, restated here for the query. */
export const MIN_SCORE = 85;

/** Tags ANDed into the primary cohort query (the seed's strongest normalised tags). */
export const MAX_COHORT_TAGS = 3;

/** A seed needs at least this many usable tags for a cohort to exist. */
export const MIN_USABLE_TAGS = 2;

/**
 * Hard wall-clock cap on this channel's MusicBrainz work. MusicBrainz is a strictly serial
 * 1 req/s queue that can hang for its full per-call timeout, and this channel makes up to
 * two cohort searches; without a cap a degraded MusicBrainz would stall the whole run at the
 * end (the pipeline waits for every channel). Over budget, the channel reports `error` with
 * no candidates and the run ships what Channels A and C found.
 */
export const CHANNEL_B_BUDGET_MS = 5000;

/* ------------------------------------------------------------------------------------ *
 * Seed tags
 * ------------------------------------------------------------------------------------ */

/**
 * The seed's strongest normalised tags, from its Last.fm crowd tags AND its AcousticBrainz
 * genre labels folded together. Nationality/decade/chart junk is dropped by
 * `normalizeGenreTag`; synonyms are collapsed; counts are summed. Sorted strongest first.
 */
export function seedCohortTags(seed: TrackRecord): WeightedTag[] {
  const raw: WeightedTag[] = [];
  for (const t of seed.tags?.value ?? []) {
    if (t.name) raw.push({ name: t.name, count: Number.isFinite(t.count) ? t.count : 1 });
  }
  // Genre labels carry no crowd count; give them a nominal weight so a seed with only
  // AcousticBrainz labels still forms a cohort, but a real crowd tag outranks them.
  for (const label of seed.features?.genreLabels ?? []) {
    if (typeof label === 'string' && label.length > 0) raw.push({ name: label, count: 2 });
  }
  return normalizeTags(raw);
}

/* ------------------------------------------------------------------------------------ *
 * The channel
 * ------------------------------------------------------------------------------------ */

function result(
  status: ChannelResult['status'],
  extra: Partial<ChannelResult> = {},
): ChannelResult {
  return { channel: 'B', status, candidates: [], live: false, ...extra };
}

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

/** Turns one MusicBrainz recording into a candidate, carrying the cohort + inline tags. */
function toCandidate(rec: MbRecording, cohort: string[]): Candidate {
  const inline = rec.tags
    .slice(0, 4)
    .map((t) => t.name)
    .filter((n) => n.length > 0);
  const shown = inline.length > 0 ? inline : cohort;
  return {
    artist: rec.artist,
    title: rec.title,
    channels: ['B'],
    hints: [
      {
        sourceUrl: rec.url,
        sentence: `MusicBrainz tag cohort: ${cohort.join(', ')}${
          shown.length > 0 ? ` · tagged ${shown.join(', ')}` : ''
        }`,
      },
    ],
  };
}

/**
 * Keyless MusicBrainz tag-cohort discovery. Never throws: a thin-tag seed is `skipped`, a
 * MusicBrainz failure is `error`, and both come back with an empty candidate list so the
 * pipeline degrades on this channel instead of on the run.
 */
export async function channelB(
  seed: TrackRecord,
  _fingerprint: Fingerprint,
  ctx: ChannelContext,
): Promise<ChannelResult> {
  if (isAborted(ctx.signal)) return result('error', { reason: 'aborted' });

  const tags = seedCohortTags(seed);
  if (tags.length < MIN_USABLE_TAGS) {
    ctx.log(
      `channel B: skipped — the seed has ${tags.length} usable tag(s), need ${MIN_USABLE_TAGS}`,
    );
    return result('skipped', { reason: `fewer than ${MIN_USABLE_TAGS} usable tags on the seed` });
  }

  const cohort = tags.slice(0, MAX_COHORT_TAGS).map((t) => t.name);
  ctx.log(`channel B: MusicBrainz cohort tag:"${cohort.join('" AND tag:"')}" (${CHANNEL_B_PROMPT_VERSION})`);

  // Every MusicBrainz search here is capped by a shared time budget: over it, the search
  // resolves to an `upstream_error` and the channel bows out with no candidates rather than
  // stalling the run behind a degraded MusicBrainz.
  const budgetAt = Date.now() + CHANNEL_B_BUDGET_MS;
  const overBudget = (): SourceResult<MbRecording[]> =>
    fail<MbRecording[]>('upstream_error', 'channel B: MusicBrainz cohort over time budget');

  let live = false;
  let res = await withDeadline(
    CHANNEL_B_BUDGET_MS,
    overBudget(),
    musicbrainz.searchRecordingsByTags(cohort, { limit: SEARCH_LIMIT, minScore: MIN_SCORE }),
  );
  if (isAborted(ctx.signal)) return result('error', { reason: 'aborted', live });
  if (res.ok) live ||= !res.fromCache;

  // The AND of three strong tags can be too tight; widen to the top two and retry once —
  // but only if the budget has time left for it.
  let usedCohort = cohort;
  const remaining = budgetAt - Date.now();
  if (res.ok && res.value.length === 0 && cohort.length > MIN_USABLE_TAGS && remaining > 500) {
    const narrower = cohort.slice(0, MIN_USABLE_TAGS);
    ctx.log(`channel B: 0 hits for ${cohort.length} tags, retrying with tag:"${narrower.join('" AND tag:"')}"`);
    const retry = await withDeadline(
      remaining,
      overBudget(),
      musicbrainz.searchRecordingsByTags(narrower, { limit: SEARCH_LIMIT, minScore: MIN_SCORE }),
    );
    if (isAborted(ctx.signal)) return result('error', { reason: 'aborted', live });
    if (retry.ok) {
      live ||= !retry.fromCache;
      res = retry;
      usedCohort = narrower;
    }
  }

  if (!res.ok) {
    ctx.log(`channel B: MusicBrainz cohort search ${res.reason}`);
    return result('error', { reason: `musicbrainz cohort: ${res.reason}`, live });
  }

  /* --- Dedupe by artist, drop the seed artist, cap. -------------------------------- */

  const seedArtistNorm = normArtist(seed.artist);
  const seedTrackKey = trackNormKey(seed.artist, seed.title);
  const byArtist = new Map<string, Candidate>();

  for (const rec of res.value) {
    const artist = rec.artist.trim();
    const title = rec.title.trim();
    if (!artist || !title) continue;
    const artistNorm = normArtist(artist);
    if (!artistNorm) continue;
    // One track per artist: a cohort query otherwise returns a run of one act's catalogue.
    if (artistNorm === seedArtistNorm) continue;
    if (trackNormKey(artist, title) === seedTrackKey) continue;
    if (byArtist.has(artistNorm)) continue;
    if (byArtist.size >= MAX_CANDIDATES) break;
    byArtist.set(artistNorm, toCandidate(rec, usedCohort));
  }

  const candidates = [...byArtist.values()];
  ctx.log(
    `channel B: ${candidates.length} candidates from ${res.value.length} MusicBrainz hits ` +
      `(cohort ${usedCohort.join(', ')})`,
  );

  return result('done', { candidates, live });
}
