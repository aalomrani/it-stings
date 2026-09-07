/**
 * Channel A — the statistical channel: Last.fm `track.getSimilar` plus a tag pivot.
 *
 * The division of labour the spec insists on is visible in this file. Last.fm RETRIEVES:
 * it knows which tracks co-occur in real listening histories and which words a crowd puts
 * on a song. It does not know what the song is doing. The one choice here — which of the
 * seed's crowd tags to pivot on — is now a DETERMINISTIC pick (no model): the generic-tag
 * blocklist below removes the umbrella words, and `pickPivotTags` keeps the heaviest
 * survivors. Zero keys beyond the free Last.fm one, and no LLM.
 *
 * Nothing this channel produces is a recommendation. Every candidate is verified against a
 * real catalogue (Stage 4) and then has to survive the scorer articulating a specific
 * shared trait (Stage 5). "Last.fm said so" is a reason to LOOK at a track, never a reason
 * to ship it — which is why the evidence rows below carry the measured number and its
 * source URL rather than a sentence about similarity.
 *
 * Degrade rules:
 *   - no `LASTFM_API_KEY` → `skipped`, no request made (upstream answers error 6 without a
 *     key, which is indistinguishable from "not found" — see api-reality §3.4);
 *   - either half failing leaves the other half's candidates intact; only both halves
 *     failing is a channel `error`;
 *   - a seed whose tags are all generic drops the pivot and keeps the similar tracks. The
 *     generic-tag blocklist is what guards against pivoting on an umbrella word; what
 *     survives it is stylistic, so the heaviest survivor is a safe pivot.
 */

import 'server-only';

import type { ChannelContext, ChannelResult } from '@/lib/engine/channels/types';
import { keys } from '@/lib/env';
import * as lastfm from '@/lib/sources/lastfm';
import type { LastfmTag } from '@/lib/sources/lastfm';
import type { Candidate, Evidence, Fingerprint, TrackRecord } from '@/lib/types';
import { normArtist, normTitle, sameArtist, sameTitle, trackNormKey } from '@/lib/util/normalize';

/* ------------------------------------------------------------------------------------ *
 * Tunables
 * ------------------------------------------------------------------------------------ */

/** `track.getSimilar` limit. 60 gives the tag pivot room to add to a full pool of 80. */
export const SIMILAR_LIMIT = 60;

/** `tag.getTopTracks` limit per chosen tag. */
export const TAG_TRACKS_LIMIT = 50;

/** Hard cap on what the channel hands to the pipeline. */
export const MAX_CANDIDATES = 80;

/** How many pivot tags `pickPivotTags` keeps. */
export const MAX_PIVOT_TAGS = 4;

/** How many surviving tags the picker considers. Beyond this the list is noise. */
const MAX_TAGS_SHOWN = 25;

/**
 * Last.fm tag counts are relative (top tag ≈ 100). Below 10 a tag is usually one
 * listener's private filing system. Applied only while at least `MIN_TAGS_AFTER_COUNT_CUT`
 * tags survive it — on a thinly tagged track the weak tags are all there is.
 */
const MIN_TAG_COUNT = 10;
const MIN_TAGS_AFTER_COUNT_CUT = 3;

/* ------------------------------------------------------------------------------------ *
 * The generic-tag blocklist — code, not model
 * ------------------------------------------------------------------------------------ */

/**
 * Tags that are true of thousands of tracks, cut before the pivot picker ever sees them.
 *
 * Three families: umbrella genre words (the pivot's whole point is to escape them),
 * listener metadata that describes the LISTENER rather than the track, and
 * nationality/language labels. Decades and bare years are handled by pattern below.
 *
 * Deliberately conservative. Anything genuinely stylistic ("swing revival", "electro
 * swing", "lounge", "psychobilly", "sophisti-pop") must reach the picker — this list only
 * removes words that could not possibly single a track out.
 */
const GENERIC_TAGS = new Set(
  [
    // umbrella genres
    'rock', 'pop', 'alternative', 'alternative rock', 'alt rock', 'alt-rock',
    'indie', 'indie rock', 'indie pop', 'electronic', 'electronica', 'dance',
    'metal', 'hip hop', 'hip-hop', 'hiphop', 'rap', 'r&b', 'rnb', 'country',
    'music', 'songs', 'song', 'track', 'tracks', 'album', 'albums', 'single',
    // listener metadata
    'seen live', 'favorites', 'favourites', 'favorite', 'favourite',
    'favorite songs', 'favourite songs', 'favorite tracks', 'my favorites',
    'my favourites', 'love', 'loved', 'love it', 'loved tracks', 'awesome',
    'amazing', 'beautiful', 'cool', 'good', 'great', 'best', 'best songs',
    'classic', 'classics', 'masterpiece', 'perfect', 'genius', 'epic',
    'favorite artists', 'want to see live', 'have seen live', 'wish i saw live',
    'spotify', 'radio', 'playlist', 'mp3', 'vinyl', 'cd', 'itunes',
    'albums i own', 'owned', 'to listen', 'check out', 'discover',
    'under 2000 listeners', 'my music', 'my songs', 'good music', 'great song',
    'memories', 'nostalgia', 'oldies', 'old school', 'old',
    // vocalist metadata
    'female vocalists', 'female vocalist', 'female vocals', 'female voices',
    'male vocalists', 'male vocalist', 'male vocals', 'male voices',
    'vocal', 'vocals', 'instrumental',
    // nationality / language
    'british', 'american', 'english', 'uk', 'usa', 'us', 'canadian', 'australian',
    'irish', 'scottish', 'welsh', 'french', 'german', 'italian', 'spanish',
    'swedish', 'norwegian', 'danish', 'finnish', 'dutch', 'belgian', 'icelandic',
    'japanese', 'korean', 'chinese', 'brazilian', 'mexican', 'argentinian',
    'russian', 'polish', 'portuguese', 'greek', 'turkish', 'israeli', 'indian',
    'england', 'britain', 'america', 'france', 'germany', 'japan', 'sweden',
    'united kingdom', 'united states',
    'uk indie', 'british rock', 'british pop', 'american rock', 'brit pop',
  ].map((t) => t.toLowerCase()),
);

/** "80s", "1980s", "'80s", "80's", "1983", "20th century". */
const DECADE_OR_YEAR = /^(?:'?\d{2}'?s|(?:19|20)\d0'?s|(?:19|20)\d{2}|\d{1,2}(?:st|nd|rd|th) century)$/;

/**
 * `normTitle` with a leading "the" and all spaces removed.
 *
 * This exists for exactly one reason: Last.fm files "The Lovecats" and "The Love Cats" as
 * two different tracks (api-reality §3.4), and the similar list for one contains the other.
 * `normalize.sameTitle` keeps them apart on purpose — they really are two catalogue entries
 * — but for "is this the seed I was asked about" they are one recording, and returning the
 * seed as its own recommendation is the one answer that is always wrong. Also catches the
 * crowd tag "lovecats" on the seed's own tag list.
 */
const titleKey = (title: string): string =>
  normTitle(title)
    .replace(/^the\s+/, '')
    .replace(/\s+/g, '');

/**
 * True for a tag no pivot should ever run on. Exported so the tests (and a future eval
 * flag) can assert on the same predicate the channel uses.
 *
 * `seed` also blocks the seed's own artist name and title, which crowd tags routinely
 * contain ("the cure", "lovecats") and which would pivot the channel straight back into
 * the one artist rule 1 exists to exclude.
 */
export function isGenericTag(tag: string, seed?: { artist: string; title: string }): boolean {
  const t = tag.trim().toLowerCase();
  if (t.length === 0) return true;
  if (GENERIC_TAGS.has(t)) return true;
  if (DECADE_OR_YEAR.test(t)) return true;
  if (seed) {
    const norm = normArtist(t);
    if (norm.length > 0 && norm === normArtist(seed.artist)) return true;
    // "lovecats", "the lovecats" and "the love cats" are all the seed's own title.
    if (titleKey(t).length > 0 && titleKey(t) === titleKey(seed.title)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------------------------ *
 * The tag pivot — deterministic, no model
 * ------------------------------------------------------------------------------------ */

/** Bump when the deterministic picker's behaviour changes. Part of the run cache key. */
export const PICK_TAGS_PROMPT_VERSION = 'tags-det-1';

/** One chosen pivot tag and the plain reason it was chosen. */
export interface PickedTag {
  tag: string;
  reason: string;
}

/**
 * The deterministic pivot picker: the strongest surviving crowd tags by count.
 *
 * The umbrella genres, nationalities, decades and listener-metadata are already gone (the
 * `isGenericTag` blocklist ran before this), so what remains is stylistic. We take the
 * `MAX_PIVOT_TAGS` heaviest — a high crowd count on a NON-generic tag is real signal that a
 * scene is well populated — breaking ties by name for stable, reproducible output. The
 * reason names the concrete number, so the evidence row still says WHY the pivot fired.
 */
export function pickPivotTags(tags: LastfmTag[], limit = MAX_PIVOT_TAGS): PickedTag[] {
  const seen = new Set<string>();
  const unique: LastfmTag[] = [];
  for (const t of tags) {
    const name = t.name.trim();
    if (name.length === 0) continue;
    const norm = name.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    unique.push({ name, count: Number.isFinite(t.count) ? t.count : 0, url: t.url ?? null });
  }
  return unique
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, Math.max(0, limit))
    .map((t) => ({ tag: t.name, reason: `crowd tag weight ${t.count}` }));
}

/* ------------------------------------------------------------------------------------ *
 * The channel
 * ------------------------------------------------------------------------------------ */

/**
 * Channel A's result. `evidence` is keyed by `trackNormKey(artist, title)` so the pipeline
 * can attach rows to whichever candidates survive verification without re-deriving keys —
 * a candidate found by both halves has one row per half.
 */
export interface ChannelAResult extends ChannelResult {
  channel: 'A';
  evidence: Record<string, Evidence[]>;
}

export const NO_KEY_REASON = 'no LASTFM_API_KEY';

interface Working {
  candidate: Candidate;
  /** Sort key inside its group; lower first. */
  order: number;
  /** Which tag produced it, for the round-robin. `null` = came from `getSimilar`. */
  tag: string | null;
}

function result(partial: Partial<ChannelAResult>): ChannelAResult {
  return {
    channel: 'A',
    status: 'done',
    candidates: [],
    live: false,
    evidence: {},
    ...partial,
  };
}

const aborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

/**
 * Channel A. Never throws: every failure comes back as `status: 'error'` (or a `reason`
 * note on an otherwise good result) so the pipeline degrades instead of erroring the run.
 */
export async function channelA(
  seed: TrackRecord,
  fingerprint: Fingerprint,
  ctx: ChannelContext,
): Promise<ChannelAResult> {
  try {
    // The presence accessor, never the secret: this file only needs to know THAT there is
    // a key. `sources/lastfm` is the one place that reads its value.
    if (!keys.lastfm) {
      ctx.log(`channel A skipped: ${NO_KEY_REASON}`);
      return result({ status: 'skipped', reason: NO_KEY_REASON });
    }
    if (aborted(ctx.signal)) return result({ status: 'error', reason: 'aborted' });
    return await run(seed, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      ctx.log(`channel A error: ${message}`);
    } catch {
      // A logger that throws is not a reason to fail the run.
    }
    return result({ status: 'error', reason: message });
  }
}

async function run(
  seed: TrackRecord,
  ctx: ChannelContext,
): Promise<ChannelAResult> {
  const evidence: Record<string, Evidence[]> = {};
  const byKey = new Map<string, Working>();
  const notes: string[] = [];
  let live = false;

  const isSeed = (artist: string, title: string): boolean =>
    trackNormKey(artist, title) === trackNormKey(seed.artist, seed.title) ||
    (sameArtist(seed.artist, artist) &&
      (sameTitle(seed.title, title) || titleKey(seed.title) === titleKey(title)));

  /** Merge one candidate into the pool, keeping the first group/order it appeared in. */
  const add = (
    artist: string,
    title: string,
    hint: Candidate['hints'][number],
    row: Evidence,
    group: { tag: string | null; order: number },
  ): void => {
    if (artist.trim().length === 0 || title.trim().length === 0) return;
    if (isSeed(artist, title)) return;

    const key = trackNormKey(artist, title);
    if (key === '|') return;

    const existing = byKey.get(key);
    if (existing) {
      const seen = new Set(existing.candidate.hints.map((h) => JSON.stringify(h)));
      if (!seen.has(JSON.stringify(hint))) existing.candidate.hints.push(hint);
    } else {
      byKey.set(key, {
        candidate: { artist, title, channels: ['A'], hints: [hint] },
        order: group.order,
        tag: group.tag,
      });
    }

    const rows = (evidence[key] ??= []);
    if (!rows.some((r) => r.kind === row.kind && r.detail === row.detail)) rows.push(row);
  };

  /* -------------------------------------------------------------------------------- *
   * Half 1 — track.getSimilar (+ the title-variant retry)
   * -------------------------------------------------------------------------------- */

  let similarFailed: string | null = null;
  let similar = await lastfm.getSimilar(seed.artist, seed.title, { limit: SIMILAR_LIMIT });
  if (similar.ok) live ||= !similar.fromCache;

  if (similar.ok && similar.value.length === 0) {
    const variant = await titleVariant(seed, ctx);
    if (variant) {
      ctx.log(`channel A: 0 similar for "${seed.title}", retrying as "${variant.title}"`);
      const retry = await lastfm.getSimilar(variant.artist, variant.title, {
        limit: SIMILAR_LIMIT,
      });
      if (retry.ok) {
        live ||= !retry.fromCache;
        if (retry.value.length > 0) {
          similar = retry;
          notes.push(`title variant "${variant.title}"`);
        }
      }
    }
  }

  if (!similar.ok) {
    similarFailed = `track.getSimilar ${similar.reason}`;
    ctx.log(`channel A: ${similarFailed}`);
  } else {
    // Last.fm returns these in match order already; sorting defensively means the rank in
    // the evidence row and the candidate order can never disagree with the number shown.
    const ranked = [...similar.value].sort((a, b) => b.match - a.match);
    const total = ranked.length;
    // Every row is stamped with WHEN the answer it quotes was fetched and whether that
    // happened in this run: an answer replayed out of `http_cache` is not a live one, and
    // the card must not say it is (docs/architecture.md, `Evidence.fetchedAt`/`live`).
    const similarFetchedAt = similar.fetchedAt;
    const similarLive = !similar.fromCache;
    ranked.forEach((t, i) => {
      add(
        t.artist,
        t.title,
        { lastfmMatch: t.match },
        {
          channel: 'A',
          kind: 'lastfm_similar',
          fetchedAt: similarFetchedAt,
          live: similarLive,
          url: t.url ?? lastfm.catalogueUrl(t.artist, t.title),
          title: `${t.artist} — ${t.title}`,
          detail: `Last.fm match ${t.match.toFixed(2)} · rank ${i + 1} of ${total}`,
        },
        { tag: null, order: i },
      );
    });
  }

  if (aborted(ctx.signal)) return result({ status: 'error', reason: 'aborted' });

  /* -------------------------------------------------------------------------------- *
   * Half 2 — the tag pivot
   * -------------------------------------------------------------------------------- */

  let pivotFailed: string | null = null;
  const tagsResult = await seedTags(seed, ctx);
  if (!tagsResult.ok) {
    pivotFailed = tagsResult.reason;
  } else {
    live ||= tagsResult.live;
    const usable = tagsResult.tags.filter((t) => !isGenericTag(t.name, seed));
    const shown = narrowByCount(usable).slice(0, MAX_TAGS_SHOWN);
    ctx.log(
      `channel A: ${tagsResult.tags.length} tags -> ${shown.length} after the generic blocklist`,
    );

    if (shown.length === 0) {
      pivotFailed = 'every tag was generic';
    } else if (aborted(ctx.signal)) {
      return result({ status: 'error', reason: 'aborted' });
    } else {
      const pickedTags = pickPivotTags(shown);
      if (pickedTags.length === 0) {
        pivotFailed = 'no usable pivot tag';
      } else {
        ctx.log(`channel A: pivot tags ${pickedTags.map((t) => `"${t.tag}"`).join(', ')}`);
        const pulled = await Promise.all(
          pickedTags.map((t) => lastfm.getTagTopTracks(t.tag, { limit: TAG_TRACKS_LIMIT })),
        );
        let anyOk = false;
        pulled.forEach((res, tagIndex) => {
          const tag = pickedTags[tagIndex].tag;
          if (!res.ok) {
            ctx.log(`channel A: tag.getTopTracks("${tag}") ${res.reason}`);
            return;
          }
          anyOk = true;
          live ||= !res.fromCache;
          res.value.forEach((t, i) => {
            add(
              t.artist,
              t.title,
              { tag },
              {
                channel: 'A',
                kind: 'lastfm_tag',
                fetchedAt: res.fetchedAt,
                live: !res.fromCache,
                url: t.url ?? lastfm.catalogueUrl(t.artist, t.title),
                title: `${t.artist} — ${t.title}`,
                detail: `tag: ${tag}`,
              },
              { tag, order: i },
            );
          });
        });
        if (!anyOk) pivotFailed = 'tag.getTopTracks failed for every chosen tag';
      }
    }
  }

  if (aborted(ctx.signal)) return result({ status: 'error', reason: 'aborted' });

  /* -------------------------------------------------------------------------------- *
   * Order, cap, report
   * -------------------------------------------------------------------------------- */

  if (similarFailed && pivotFailed) {
    return result({ status: 'error', reason: `${similarFailed}; ${pivotFailed}`, live });
  }
  if (similarFailed) notes.push(similarFailed);
  if (pivotFailed) notes.push(`tag pivot skipped: ${pivotFailed}`);

  const ordered = orderCandidates([...byKey.values()]).slice(0, MAX_CANDIDATES);
  const kept = new Set(ordered.map((c) => trackNormKey(c.artist, c.title)));
  for (const key of Object.keys(evidence)) if (!kept.has(key)) delete evidence[key];

  ctx.log(`channel A: ${ordered.length} candidates (live=${live})`);
  return result({
    status: 'done',
    reason: notes.length > 0 ? notes.join('; ') : undefined,
    candidates: ordered,
    live,
    evidence,
  });
}

/**
 * Similar tracks first, in Last.fm's own match order; then the tag tracks round-robin
 * across tags so four tags contribute evenly instead of the first one filling the cap.
 */
function orderCandidates(working: Working[]): Candidate[] {
  const similar = working
    .filter((w) => w.tag === null)
    .sort((a, b) => a.order - b.order)
    .map((w) => w.candidate);

  const byTag = new Map<string, Working[]>();
  for (const w of working) {
    if (w.tag === null) continue;
    const list = byTag.get(w.tag) ?? [];
    list.push(w);
    byTag.set(w.tag, list);
  }
  const queues = [...byTag.values()].map((list) => list.sort((a, b) => a.order - b.order));

  const pivot: Candidate[] = [];
  for (let i = 0; queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length) pivot.push(q[i].candidate);
  }
  return [...similar, ...pivot];
}

/** Drop the weakly-tagged long tail, but never down to nothing. */
function narrowByCount(tags: LastfmTag[]): LastfmTag[] {
  const strong = tags.filter((t) => t.count >= MIN_TAG_COUNT);
  return strong.length >= MIN_TAGS_AFTER_COUNT_CUT ? strong : tags;
}

/**
 * The seed's tags: the ones the resolver already stored on the record when it has them,
 * a fresh `track.getTopTags` otherwise.
 */
async function seedTags(
  seed: TrackRecord,
  ctx: ChannelContext,
): Promise<{ ok: true; tags: LastfmTag[]; live: boolean } | { ok: false; reason: string }> {
  const stored = seed.tags?.value ?? null;
  if (stored && stored.length > 0) {
    return {
      ok: true,
      live: false,
      tags: stored.map((t) => ({ name: t.name, count: t.count, url: null })),
    };
  }

  const res = await lastfm.getTopTags(seed.artist, seed.title);
  if (!res.ok) {
    ctx.log(`channel A: track.getTopTags ${res.reason}`);
    return { ok: false, reason: `track.getTopTags ${res.reason}` };
  }
  if (res.value.length === 0) return { ok: false, reason: 'no Last.fm tags for the seed' };
  return { ok: true, tags: res.value, live: !res.fromCache };
}

/**
 * The spelling Last.fm itself ranks first for this title. Only interesting when it is a
 * DIFFERENT title from the one we asked about — otherwise the retry would repeat the
 * request that just returned nothing.
 */
async function titleVariant(
  seed: TrackRecord,
  ctx: ChannelContext,
): Promise<{ artist: string; title: string } | null> {
  const res = await lastfm.searchTracks(seed.title, { artist: seed.artist, limit: 5 });
  if (!res.ok) {
    ctx.log(`channel A: track.search ${res.reason}`);
    return null;
  }
  const hit =
    res.value.find((t) => sameArtist(t.artist, seed.artist)) ?? res.value[0] ?? null;
  if (!hit) return null;
  if (normTitle(hit.title) === normTitle(seed.title)) return null;
  return { artist: hit.artist || seed.artist, title: hit.title };
}
