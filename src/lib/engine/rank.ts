/**
 * Stage 5, part two: the CODE-enforced ranking rules.
 *
 * The model scores; this file judges. Everything here is pure — no I/O, no clock, no
 * randomness — so `rank()` is fully reproducible and the six rules in
 * docs/architecture.md ("Code-enforced ranking rules") can be unit-tested one by one.
 *
 * Rules, applied in this order, every cut recorded with its reason:
 *   0. the seed's own song again        -> 'same-song'      (a cover, remix or live take)
 *   1. same artist as the seed          -> 'same-artist' / 'same-artist-below-bar'
 *   2. one track per artist             -> 'duplicate-artist'
 *   3. multi-channel + live-enthusiasm bonuses (scoring, cuts nothing)
 *   4. genre-only cut                   -> 'genre-only'
 *   4b. a `why` the scorer itself could not fix -> 'generic-why'
 *   5. spread (soft diversity)          -> 'spread-demoted' / 'over-length'
 *   6. never fewer than 8 if 8 survived rules 1-2 (relax 5, then 4's dimension bar)
 *
 * Rules 0 and 4b are absolute: rule 6 never relaxes them. "The Lovecats" sung by somebody
 * else is the same song, not an answer to "what else sounds like this", and a sentence the
 * engine itself flagged as generic twice is the failure docs/spec.md forbids shipping
 * ("If a recommendation reason would apply to any two songs in the same genre, the
 * pipeline is broken. Say so rather than shipping it") — so it is said, in `stats.cut`.
 *
 * The DEFAULT weights in `DEFAULT_DIMENSION_WEIGHTS` are printed inline in the UI and are
 * the starting point the listener tunes per run; they live here so there is exactly one
 * copy of them. A run may override any of the nine via `RunOptions.weights`, threaded to
 * `modelScore`/`finalScore`/`rank` rather than read from this global.
 */

import type {
  Channel,
  DimensionScore,
  Recommendation,
  RunOptions,
  TrackRecord,
} from '@/lib/types';
import * as normalize from '@/lib/util/normalize';

/** A per-run weights map: any subset of the scored dimensions (plus, harmlessly, the
 *  non-scored ones); every entry is clamped 0..10 and a missing one falls back to the
 *  default. Threaded through scoring instead of read from a global so re-tuning is a pure
 *  function of its argument. */
export type WeightsMap = Partial<Record<DimensionScore['dimension'], number>>;

/* ------------------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------------------ */

/**
 * The DEFAULT per-run weights, total 15. A run with no `weights` in its options scores
 * with exactly this map; the UI reads it to seed its sliders (one shared copy). `era`
 * now carries weight 1 (a same-era track is a weak positive), `scene_context` is 0 (too
 * noisy a signal to weight by default) and `emotional_register` is 3.
 *
 * A caller may override any of the nine per run; `signature_hook` and `vocal_delivery`
 * are kept in the default at 2 for continuity, but in the keyless engine they carry no
 * measured signal (always a neutral 0.5), so weighting them only flattens the spread —
 * the UI marks them "not measured (keyless)".
 */
export const DEFAULT_DIMENSION_WEIGHTS: Record<DimensionScore['dimension'], number> = {
  // `DimensionScore['dimension']` is `keyof Fingerprint['confidence'] | 'era'`, so the
  // type admits `tempo_feel` even though no scoring pass emits it (Stage 5 returns the
  // nine in `SCORED_DIMENSIONS`). Weight 0 keeps the record total honest at 15.
  tempo_feel: 0,
  rhythmic_character: 3,
  vocal_delivery: 3,
  emotional_register: 3,
  scene_context: 0,
  signature_hook: 2,
  instrumentation: 1,
  harmonic_language: 1,
  production_texture: 1,
  era: 1,
};

/** The clamped weight for one dimension: the map's value (0..10) or the default. */
function weightFor(weights: WeightsMap, dimension: DimensionScore['dimension']): number {
  const raw = weights[dimension];
  const value = typeof raw === 'number' && Number.isFinite(raw)
    ? raw
    : DEFAULT_DIMENSION_WEIGHTS[dimension] ?? 0;
  return value < 0 ? 0 : value > 10 ? 10 : value;
}

/**
 * The nine dimensions Stage 5 actually returns, in the order docs/tasks/phase3-engine.md
 * lists them. `tempo_feel` is deliberately absent: tempo is a measurement on the record,
 * not a judgement to score.
 */
export const SCORED_DIMENSIONS: DimensionScore['dimension'][] = [
  'rhythmic_character', 'vocal_delivery', 'emotional_register', 'scene_context',
  'signature_hook', 'instrumentation', 'harmonic_language', 'production_texture', 'era',
];

/** Rule 3: each extra channel that found the same track. */
export const CHANNEL_BONUS = 0.12;
/** Rule 3: a forum mention with `enthusiasm: 'high'` from a channel that ran live. */
export const ENTHUSIASM_BONUS = 0.05;
/** Rule 1: the higher bar a same-artist track must clear when it is allowed at all. */
export const SAME_ARTIST_MIN_SCORE = 0.85;
/** Rule 4: a candidate needs at least this many dimensions at or above the bar. */
export const MIN_STRONG_DIMENSIONS = 2;
export const STRONG_DIMENSION_SCORE = 0.6;
/** Rule 5: the list we aim for, and the share one decade / one genre label may take. */
export const TARGET_LENGTH = 20;
export const MAX_BUCKET_SHARE = 0.4;
/** Rule 6: the floor, when enough candidates survived rules 1-2 to reach it. */
export const MIN_RESULTS = 8;
/** Rule 6 relaxes rule 4's dimension bar down this ladder, in order, and no further. */
export const RELAXED_DIMENSION_SCORES = [0.5, 0.4, 0.3, 0] as const;

/**
 * Rule 0: the flag `pipeline.ts` sets from Stage 5's `is_cover_or_same_song`. Kept as a
 * bare string on both sides so this file stays free of engine imports.
 */
export const FLAG_COVER_OR_SAME_SONG = 'cover-or-same-song';

/**
 * Rule 4b: `score.ts`'s `FLAG_WEAK_WHY_UNFIXED` — the `why` still carried a banned phrase
 * after the one re-score the scorer offers. Same string, no import.
 */
export const FLAG_GENERIC_WHY = 'weak-why-unfixed';

/**
 * Rule 4's blocklist: words that describe a *category*, not a musical trait. A candidate
 * whose `sharedTraits` are made only of these is matched on nothing, and its `why` would
 * fit any two songs in the genre — the exact failure the spec forbids shipping.
 *
 * Deliberately NOT here: anything naming an instrument, a technique, a rhythm, a vocal
 * behaviour or a specific scene ("swing revival", "jump blues shuffle") — those are the
 * answers we want.
 */
export const GENRE_ONLY_TERMS: string[] = [
  // the words the architecture names explicitly
  'vibe', 'vibes', 'mood', 'moods', 'style', 'styles', 'energy', 'energies',
  'feel', 'feels', 'feeling', 'sound', 'sounds', 'similar', 'era', 'eras', 'genre', 'genres',
  // broad genre labels
  'rock', 'pop', 'jazz', 'punk', 'swing', 'electronic', 'electronica', 'dance', 'indie',
  'alternative', 'folk', 'country', 'blues', 'soul', 'funk', 'disco', 'metal', 'rap',
  'hip hop', 'hiphop', 'r b', 'rnb', 'reggae', 'ska', 'classical', 'ambient', 'techno',
  'house', 'trance', 'dubstep', 'grunge', 'emo', 'goth', 'gothic', 'new wave', 'no wave',
  'post punk', 'postpunk', 'new romantic', 'synthpop', 'synth pop', 'britpop', 'shoegaze',
  'psychedelia', 'psychedelic', 'experimental', 'avant garde', 'latin', 'world music',
  'edm', 'garage', 'hardcore', 'lounge', 'easy listening', 'soft rock', 'hard rock',
  'art pop', 'art rock', 'power pop', 'dream pop', 'noise pop', 'electropop',
  'americana', 'bluegrass', 'gospel', 'opera', 'soundtrack', 'singer songwriter',
  // period words
  'decade', 'decades', 'period', 'vintage', 'retro', 'classic', 'oldies', 'old school',
  'throwback', 'nostalgia', 'nostalgic', 'modern', 'contemporary',
  'twenties', 'thirties', 'forties', 'fifties', 'sixties', 'seventies', 'eighties',
  'nineties', 'noughties',
  // catch-alls a lazy model reaches for
  'aesthetic', 'atmosphere', 'tone', 'general', 'overall', 'scene', 'music', 'musical',
  'song', 'songs', 'track', 'tracks', 'band', 'bands', 'artist', 'artists', 'group',
  'album', 'record', 'flavour', 'flavor',
  // decades, both spellings: 1920s..2020s and 20s..20s
  ...decadeTerms(),
];

function decadeTerms(): string[] {
  const out: string[] = [];
  for (let year = 1900; year <= 2030; year += 10) {
    out.push(`${year}s`);
    out.push(`${String(year).slice(2)}s`);
  }
  return out;
}

/** Removed before the blocklist check so "similar mood and style" reduces to two terms. */
const TRAIT_STOPWORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'of', 'with', 'in', 'on', 'at', 'to', 'from', 'for',
  'as', 'by', 'both', 'it', 'its', 'is', 'are', 'was', 'were', 'be', 'very', 'quite',
  'more', 'most', 'really', 'just', 'some', 'kind', 'sort', 'bit', 'that', 'this',
  'same', 'similar', 'shared', 'share', 'like',
]);

const GENRE_ONLY_SET = new Set(GENRE_ONLY_TERMS.map((t) => tokenise(t).join(' ')));
const MAX_TERM_WORDS = Math.max(
  1,
  ...GENRE_ONLY_TERMS.map((t) => tokenise(t).length),
);

/* ------------------------------------------------------------------------------------ *
 * Small pure helpers
 * ------------------------------------------------------------------------------------ */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** "vibes" -> "vibe" so a plural does not slip past the blocklist. */
function singular(word: string): string {
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function inBlocklist(phrase: string): boolean {
  return GENRE_ONLY_SET.has(phrase) || GENRE_ONLY_SET.has(singular(phrase));
}

/**
 * The same-act test for rules 1 AND 2. `artistOverlap` (task B, `util/normalize.ts`) is
 * the looser of the two: it matches when one name is the other with extra CREDITED ACTS
 * attached, so "The Cure", "Cure" and "The Cure feat. X" are one act while "Prince" and
 * "Prince Buster" are not.
 *
 * Rules 1 and 2 must use the SAME relation or they contradict each other: keying rule 2
 * on exact `normArtist` let "Waldeck" and "The Avener & Waldeck" both survive as
 * "different artists" while rule 1 would have cut either of them as the seed's own act.
 */
export const SAME_ARTIST_TEST_NAME = 'artistOverlap';

/** True when `a` and `b` are the same act (normalised; "The Cure" === "Cure"). */
export function isSameArtist(a: string, b: string): boolean {
  return normalize.artistOverlap(a, b);
}

/** The decade a track belongs to for rule 5, or null when the year is unknown. */
export function decadeOf(track: TrackRecord): number | null {
  const year = track.year?.value;
  if (typeof year !== 'number' || !Number.isFinite(year)) return null;
  return Math.floor(year / 10) * 10;
}

/**
 * The primary genre label for rule 5: the top crowd tag (Last.fm, or MusicBrainz
 * tags+genres without a key), else AcousticBrainz's first high-level classifier label.
 * Null when we have neither — an unknown label never constrains spread, because a bucket
 * we cannot name is not a bucket we can prove is over-represented.
 *
 * Crowd tags come FIRST because docs/api-reality.md §3.3 measured the classifiers and
 * called them weak: `genre_dortmund` returned `electronic` for all 11 high-level hits on
 * the sample, and `genre_rosamerica` put Sade in "hip". A 40%-per-genre cap computed from
 * a label that is constant across the sample is not a diversity rule, it is noise.
 */
export function primaryGenre(track: TrackRecord): string | null {
  const topTag = track.tags?.value?.[0]?.name;
  if (typeof topTag === 'string' && topTag.trim().length > 0) return topTag.trim().toLowerCase();
  const fromFeatures = track.features?.genreLabels?.[0];
  if (typeof fromFeatures === 'string' && fromFeatures.trim().length > 0) {
    return fromFeatures.trim().toLowerCase();
  }
  return null;
}

/* ------------------------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------------------------ */

/**
 * Rule 3: `modelScore` is NOT a free number from the model. It is the weighted mean of the
 * per-dimension scores, computed here, rounded to 2 dp. Duplicate dimensions: first wins.
 * Zero-weight dimensions (`era`) contribute nothing to either side of the mean.
 */
export function modelScore(
  dimensions: DimensionScore[],
  weights: WeightsMap = DEFAULT_DIMENSION_WEIGHTS,
): number {
  let weighted = 0;
  let weight = 0;
  const seen = new Set<string>();
  for (const d of dimensions) {
    if (seen.has(d.dimension)) continue;
    seen.add(d.dimension);
    const w = weightFor(weights, d.dimension);
    if (w === 0) continue;
    weighted += w * clamp01(d.score);
    weight += w;
  }
  return weight === 0 ? 0 : round2(weighted / weight);
}

/**
 * Rule 3: `modelScore + 0.12 × (channels − 1)`, plus `0.05` when a forum mention with
 * `enthusiasm: 'high'` came from a channel that ran LIVE this run (a cached mention that
 * Channel B did not refresh earns nothing), capped at 1.
 *
 * The base is recomputed from `dimensions` whenever they are present, so a caller cannot
 * smuggle in a `modelScore` the weights do not justify.
 */
export function finalScore(
  rec: Recommendation,
  opts: { liveChannels: Channel[]; weights?: WeightsMap },
): number {
  const base = rec.dimensions.length > 0
    ? modelScore(rec.dimensions, opts.weights ?? DEFAULT_DIMENSION_WEIGHTS)
    : clamp01(rec.modelScore);
  const channels = new Set(rec.channels).size;
  const multiChannel = CHANNEL_BONUS * Math.max(0, channels - 1);
  const live = new Set(opts.liveChannels);
  const enthusiastic = rec.evidence.some(
    (e) => e.kind === 'forum' && e.enthusiasm === 'high' && live.has(e.channel),
  );
  return round2(Math.min(1, base + multiChannel + (enthusiastic ? ENTHUSIASM_BONUS : 0)));
}

/* ------------------------------------------------------------------------------------ *
 * Rule 4 — the genre-only cut
 * ------------------------------------------------------------------------------------ */

/**
 * True when a single trait says nothing but "same category": empty, or made only of
 * blocklist words once stopwords are dropped. "similar mood and style" -> true;
 * "walking upright bass in quarters" -> false.
 */
export function isGenreOnlyTrait(trait: string): boolean {
  const tokens = tokenise(trait).filter((t) => !TRAIT_STOPWORDS.has(t));
  if (tokens.length === 0) return true;
  let i = 0;
  outer: while (i < tokens.length) {
    for (let len = Math.min(MAX_TERM_WORDS, tokens.length - i); len >= 1; len--) {
      if (inBlocklist(tokens.slice(i, i + len).join(' '))) {
        i += len;
        continue outer;
      }
    }
    return false;
  }
  return true;
}

export type GenreOnlyReason = 'no-traits' | 'blocklisted-traits' | 'weak-dimensions';

/**
 * Which arm of rule 4 (if either) a candidate fails. Split out from `isGenreOnly` because
 * rule 6 may relax the dimension arm and must never relax the traits arm.
 */
export function genreOnlyReasons(
  rec: Recommendation,
  opts: { dimensionScore?: number } = {},
): GenreOnlyReason[] {
  const bar = opts.dimensionScore ?? STRONG_DIMENSION_SCORE;
  const reasons: GenreOnlyReason[] = [];
  const traits = rec.sharedTraits ?? [];
  if (traits.length === 0) reasons.push('no-traits');
  else if (traits.every(isGenreOnlyTrait)) reasons.push('blocklisted-traits');
  const strong = rec.dimensions.filter((d) => d.score >= bar).length;
  if (strong < MIN_STRONG_DIMENSIONS) reasons.push('weak-dimensions');
  return reasons;
}

/** Rule 4: no concrete shared trait, or fewer than two dimensions at 0.6+. */
export function isGenreOnly(rec: Recommendation): boolean {
  return genreOnlyReasons(rec).length > 0;
}

/* ------------------------------------------------------------------------------------ *
 * rank()
 * ------------------------------------------------------------------------------------ */

export type CutReason =
  | 'same-song'
  | 'same-artist'
  | 'same-artist-below-bar'
  | 'duplicate-artist'
  | 'genre-only'
  | 'generic-why'
  | 'spread-demoted'
  | 'over-length';

export interface RankCut {
  rec: Recommendation;
  reason: CutReason;
}

export interface RankOptions extends RunOptions {
  /** Channels that actually ran this run — only these can earn the enthusiasm bonus. */
  liveChannels: Channel[];
  /**
   * Rule 4 on/off. The placeholder recommender (Phase 1) has no model scores, so every
   * candidate would be cut as genre-only; it passes `false` so the UI has something real
   * to render. The engine never passes `false`.
   */
  enforceGenreOnly?: boolean;
  /** Overridable for tests; production uses the constants. */
  targetLength?: number;
  minResults?: number;
}

/**
 * Applies rules 1-6 and returns the ordered list plus every cut with its reason.
 *
 * The returned recommendations are COPIES with `modelScore`, `finalScore`, `sameArtist`
 * and `flags` filled in by these rules; the input array is not mutated.
 */
export function rank(
  recs: Recommendation[],
  seed: TrackRecord,
  opts: RankOptions,
): { results: Recommendation[]; cut: RankCut[] } {
  const target = opts.targetLength ?? TARGET_LENGTH;
  const floor = opts.minResults ?? MIN_RESULTS;
  const enforceGenreOnly = opts.enforceGenreOnly ?? true;
  const weights = opts.weights ?? DEFAULT_DIMENSION_WEIGHTS;
  const cut: RankCut[] = [];

  // Step 0 — normalise every input: recompute the two scores and the same-artist flag so
  // nothing downstream depends on numbers a caller supplied.
  const scored: Recommendation[] = recs.map((rec) => {
    const flags = new Set(rec.flags);
    if (new Set(rec.channels).size > 1) flags.add('multi-channel');
    return {
      ...rec,
      sameArtist: isSameArtist(rec.track.artist, seed.artist),
      modelScore: rec.dimensions.length > 0
        ? modelScore(rec.dimensions, weights)
        : clamp01(rec.modelScore),
      finalScore: finalScore(rec, { liveChannels: opts.liveChannels, weights }),
      sharedTraits: rec.sharedTraits ?? [],
      flags: [...flags],
    };
  });

  // Rule 0 — the same song again. Stage 5 is asked outright whether a candidate is a
  // cover, remix, live take or rework of the seed; a `true` there is the seed coming back
  // under someone else's name, which passes rules 1 and 2 (different act, different key)
  // and would otherwise rank first on a perfectly true `why`. It is not an answer.
  const afterRule0: Recommendation[] = [];
  for (const rec of scored) {
    if (rec.flags.includes(FLAG_COVER_OR_SAME_SONG)) {
      cut.push({ rec, reason: 'same-song' });
      continue;
    }
    afterRule0.push(rec);
  }

  // Rule 1 — same artist as the seed.
  const afterRule1: Recommendation[] = [];
  for (const rec of afterRule0) {
    if (!rec.sameArtist) {
      afterRule1.push(rec);
      continue;
    }
    if (!opts.includeSameArtist) {
      cut.push({ rec, reason: 'same-artist' });
      continue;
    }
    const clearsBar = rec.modelScore >= SAME_ARTIST_MIN_SCORE;
    const reasons = genreOnlyReasons(rec);
    const whyStands =
      !reasons.includes('no-traits') && !reasons.includes('blocklisted-traits');
    if (!clearsBar || !whyStands) {
      cut.push({ rec, reason: 'same-artist-below-bar' });
      continue;
    }
    afterRule1.push({ ...rec, flags: withFlag(rec.flags, 'same-artist-high-bar') });
  }

  // Rule 2 — one track per artist, highest finalScore wins. Walking the sorted list and
  // testing against what is already kept uses the SAME relation as rule 1 (`isSameArtist`),
  // so the two rules can never disagree about who is the same act. O(n²) on ≤40 items.
  const held: Recommendation[] = [];
  for (const rec of sortForRank(afterRule1)) {
    if (held.some((k) => isSameArtist(k.track.artist, rec.track.artist))) {
      cut.push({ rec, reason: 'duplicate-artist' });
      continue;
    }
    held.push(rec);
  }
  const eligible = sortForRank(held);

  // Rule 3 is already in `finalScore`; it cuts nothing.

  // Rule 4 — genre-only.
  const survivors: Recommendation[] = [];
  const genreOnlyCuts: { rec: Recommendation; reasons: GenreOnlyReason[] }[] = [];
  for (const rec of eligible) {
    const reasons = enforceGenreOnly ? genreOnlyReasons(rec) : [];
    if (reasons.length === 0) {
      survivors.push(rec);
      continue;
    }
    const flagged = { ...rec, flags: withFlag(rec.flags, 'genre-only-cut') };
    genreOnlyCuts.push({ rec: flagged, reasons });
    cut.push({ rec: flagged, reason: 'genre-only' });
  }

  // Rule 4b — the `why` the scorer could not fix. `score.ts` catches a banned phrase,
  // sends the candidate back once with the phrase quoted, and flags what comes back still
  // generic. Nothing read that flag before: a generic sentence with CONCRETE shared traits
  // sailed through rule 4 (which tests the traits, not the sentence) and shipped. Cut here,
  // with its own reason, so the run stays auditable and rule 6 can never re-admit it.
  const afterWhy: Recommendation[] = [];
  for (const rec of survivors) {
    if (rec.flags.includes(FLAG_GENERIC_WHY)) {
      cut.push({ rec, reason: 'generic-why' });
      continue;
    }
    afterWhy.push(rec);
  }
  survivors.length = 0;
  survivors.push(...afterWhy);

  // Rule 5 — spread. Demote, never delete; the demoted fill whatever slots are left.
  //
  // The cap is 40% of the list we will ACTUALLY emit, not of the target. Sizing it to
  // TARGET_LENGTH meant a run that verified 10 candidates got a cap of 8 and no spread
  // pass at all — and 10 tracks from one decade is precisely the "generic 1980s
  // alternative rock sharing nothing but the decade" outcome the spec names as failure.
  //
  // Note the ceiling of what this rule can do: demoted items are re-admitted below the
  // diverse set (architecture.md: "demote, don't delete"), so on a list shorter than the
  // target the 40% share is an ORDERING rule, not a guarantee about the final ratio.
  const emitLength = Math.min(target, survivors.length);
  const cap = Math.max(1, Math.floor(emitLength * MAX_BUCKET_SHARE));
  const kept: Recommendation[] = [];
  const demoted: Recommendation[] = [];
  const decadeCount = new Map<number, number>();
  const genreCount = new Map<string, number>();
  for (const rec of survivors) {
    const decade = decadeOf(rec.track);
    const genre = primaryGenre(rec.track);
    const decadeFull = decade !== null && (decadeCount.get(decade) ?? 0) + 1 > cap;
    const genreFull = genre !== null && (genreCount.get(genre) ?? 0) + 1 > cap;
    if (decadeFull || genreFull) {
      demoted.push({ ...rec, flags: withFlag(rec.flags, 'spread-demoted') });
      continue;
    }
    if (decade !== null) decadeCount.set(decade, (decadeCount.get(decade) ?? 0) + 1);
    if (genre !== null) genreCount.set(genre, (genreCount.get(genre) ?? 0) + 1);
    kept.push(rec);
  }

  let results = [...kept, ...demoted];
  const overflow = results.slice(target);
  results = results.slice(0, target);
  for (const rec of overflow) {
    cut.push({
      rec,
      reason: rec.flags.includes('spread-demoted') ? 'spread-demoted' : 'over-length',
    });
  }

  // Rule 6 — the floor of 8. Relax rule 5 first (already done: demoted items are back in
  // the list), then rule 4's DIMENSION bar only. Rules 1, 2 and verification never move.
  if (results.length < floor && eligible.length >= floor) {
    for (const bar of RELAXED_DIMENSION_SCORES) {
      if (results.length >= floor) break;
      for (const candidate of genreOnlyCuts) {
        if (results.length >= floor) break;
        if (
          candidate.reasons.includes('no-traits')
          || candidate.reasons.includes('blocklisted-traits')
        ) {
          continue; // the traits arm is never relaxed
        }
        // Nor is rule 4b: a candidate cut as genre-only that ALSO carries a `why` the
        // scorer could not fix must not come back through the floor.
        if (candidate.rec.flags.includes(FLAG_GENERIC_WHY)) continue;
        if (results.some((r) => r.track.key === candidate.rec.track.key)) continue;
        if (genreOnlyReasons(candidate.rec, { dimensionScore: bar }).length > 0) continue;
        const readmitted = {
          ...candidate.rec,
          flags: withFlag(
            candidate.rec.flags.filter((f) => f !== 'genre-only-cut'),
            'threshold-relaxed',
          ),
        };
        results.push(readmitted);
        const index = cut.findIndex(
          (c) => c.reason === 'genre-only' && c.rec.track.key === candidate.rec.track.key,
        );
        if (index >= 0) cut.splice(index, 1);
      }
    }
  }

  return { results, cut };
}

/** Deterministic order: finalScore, then modelScore, then channel count, then key. */
function sortForRank(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort(
    (a, b) =>
      b.finalScore - a.finalScore
      || b.modelScore - a.modelScore
      || b.channels.length - a.channels.length
      || (a.track.key < b.track.key ? -1 : a.track.key > b.track.key ? 1 : 0),
  );
}

function withFlag(flags: string[], flag: string): string[] {
  return flags.includes(flag) ? flags : [...flags, flag];
}
