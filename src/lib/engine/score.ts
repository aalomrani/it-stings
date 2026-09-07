/**
 * Stage 5, part one: the DETERMINISTIC judgement of every verified candidate against the
 * seed — no model, no network, no key.
 *
 * The division of labour the spec asked for survives, only the "interpret and judge" half
 * is now arithmetic instead of a model call:
 *
 *   - this file turns each (seed, candidate) pair into the nine `DimensionScore`s, a
 *     templated `why`, the concrete `shared_traits` behind it, and a cover/same-song flag,
 *     by running the pure `similarity.scorePair` over the shared `FeatureProfile` of each;
 *   - `rank.ts` turns that into numbers (`modelScore` is the weighted mean of the
 *     dimensions, computed in code) and applies the six code-enforced rules.
 *
 * Nothing here computes a final score and nothing here decides what ships. The honesty
 * guard the spec demands — "if a reason would apply to any two songs in the same genre,
 * say so rather than shipping it" — is enforced by `scorePair`, which raises
 * `FLAG_WEAK_WHY_UNFIXED` when a pair's only agreement is a bare genre tag or the templated
 * sentence still reads generic; `rank.ts` rule 4b then cuts it. `scoreBatch` propagates
 * that flag and re-checks it here, so the guard is a property of the output, not of a model.
 *
 * `scoreBatch` never throws and never returns a `no_api_key` reason: the only way it
 * "fails" a candidate is an aborted signal, and even then it just reports the keys.
 */

import 'server-only';

import { buildFeatureProfile } from '@/lib/engine/featureProfile';
import type { ChannelContext } from '@/lib/engine/channels/types';
import { scorePair } from '@/lib/engine/similarity';
import type { Candidate, DimensionScore, Fingerprint, TrackRecord } from '@/lib/types';

/* ------------------------------------------------------------------------------------ *
 * Public shapes
 * ------------------------------------------------------------------------------------ */

/** A candidate that survived Stage 4: the raw candidate plus the real track it resolved to. */
export interface VerifiedCandidate {
  candidate: Candidate;
  track: TrackRecord;
}

/**
 * One scored candidate, keyed by `track.key`. Deliberately NOT a `Recommendation`: the
 * two scores, `sameArtist` and the ranking flags are `rank.ts`'s to compute, and the
 * pipeline is what joins this to the track and the evidence rows.
 */
export interface ScoredCandidate {
  key: string;
  dimensions: DimensionScore[];
  why: string;
  /**
   * The model's own counter-example in the LLM engine; the deterministic engine has no
   * such notion, so it is always empty (the pipeline omits it from `Recommendation` when
   * falsy). Kept on the shape so `rank.ts` and the pipeline are untouched.
   */
  whyDiscriminates: string;
  sharedTraits: string[];
  isCoverOrSameSong: boolean;
  /** Channel C's one-clause note, carried through for the evidence trail. */
  modelNote?: string;
  /** Scoring-quality flags; see `FLAG_*` below. Merged into `Recommendation.flags`. */
  flags: string[];
}

/**
 * What Stage 5's judgement half hands back: everything it scored and the keys of everything
 * it did not. The deterministic scorer only leaves a candidate unscored on an aborted
 * signal, so `reason` is effectively vestigial — kept on the shape because the pipeline
 * reads it and Build C's cleanup owns removing it.
 */
export interface ScoreOutcome {
  scored: ScoredCandidate[];
  failed: string[];
  reason?: string;
}

/**
 * The `why` a pair could not make concrete — its only agreement is a bare genre tag, or the
 * templated sentence still reads generic. `rank.ts` rule 4b cuts on this flag. Same bare
 * string as `rank.ts`'s `FLAG_GENERIC_WHY` and `similarity.ts`'s local copy.
 */
export const FLAG_WEAK_WHY_UNFIXED = 'weak-why-unfixed';

/**
 * Retained for compatibility with importers that still name it (the adversarial suite, the
 * eval harness). The deterministic scorer offers no re-score pass, so it is never raised on
 * the recommendation path; `FLAG_WEAK_WHY_UNFIXED` alone carries the "generic why" verdict.
 */
export const FLAG_WEAK_WHY = 'weak-why';

/* ------------------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------------------ */

/** Part of the run cache key: a scoring change must invalidate stored runs. */
export const SCORE_PROMPT_VERSION = 'score-det-1';

/**
 * The nine dimensions, in the order `rank.ts` documents them. `score.test.ts` asserts it is
 * exactly `rank.SCORED_DIMENSIONS`, so the two can never drift.
 */
export const SCORE_DIMENSIONS = [
  'rhythmic_character',
  'vocal_delivery',
  'emotional_register',
  'scene_context',
  'signature_hook',
  'instrumentation',
  'harmonic_language',
  'production_texture',
  'era',
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/* ------------------------------------------------------------------------------------ *
 * The banned-phrase check
 *
 * Still here — it is the honesty gate on a `why`, LLM engine or not — and still imported by
 * `similarity.ts` (which applies it to its own templated sentence) and by the eval harness.
 * ------------------------------------------------------------------------------------ */

/**
 * The vocabulary of a `why` that says nothing: category words. A sentence built out of
 * these is true of any two songs in the genre, which is precisely the output the spec
 * names as a broken pipeline ("Any `why` that reads 'similar mood and style'").
 */
const VAGUE_NOUN =
  'vibes?|moods?|styles?|energ(?:y|ies)|feels?|feelings?|sounds?|eras?|genres?'
  + '|aesthetics?|atmospheres?|spirit|flavou?rs?|ballpark|wavelength';

/**
 * Patterns that reject a `why` outright. Kept narrow on purpose so a specific sentence
 * ("the same brushed-kit shuffle") is never mistaken for a generic one.
 */
export const BANNED_WHY_PATTERNS: RegExp[] = [
  new RegExp(
    String.raw`\b(?:similar|same|comparable|matching|shared|shares?|sharing|alike|akin|parallel|kindred)\b`
    + String.raw`(?:\s+[\w'-]+){0,2}`
    + String.raw`\s+\b(?:${VAGUE_NOUN})\b`,
    'i',
  ),
  new RegExp(
    String.raw`\b(?:${VAGUE_NOUN})\b\s+(?:is|are|feels?|sounds?)\s+(?:very\s+|quite\s+|really\s+)?`
    + String.raw`(?:similar|the same|comparable|alike)\b`,
    'i',
  ),
  /\bin the same (?:vein|ballpark|wheelhouse|lane|world|space)\b/i,
  /\bcut from the same cloth\b/i,
  /\b(?:gives?|has|have|carr(?:y|ies)|brings?)\s+(?:off\s+)?(?:a|an|the)?\s*(?:\w+\s+){0,2}vibe\b/i,
  /\bfans? of (?:one|the seed|this)[^.]{0,40}\bwill (?:also )?(?:like|enjoy|love)\b/i,
  /\bif you like\b[^.]{0,60}\byou(?:'?ll|'?d| will| would) (?:like|enjoy|love)\b/i,
  /\bsounds? (?:just )?like (?:it|each other|the seed)\b/i,
  /\bboth (?:are|feel|sound)\s+(?:very\s+|quite\s+)?similar\b/i,
];

/**
 * The matched banned phrase, or `null` when the sentence survives. A function DECLARATION
 * (hoisted) so the `score` <-> `similarity` module cycle resolves: `similarity.ts` imports
 * this and calls it lazily inside `scorePair`.
 */
export function bannedPhraseIn(why: string): string | null {
  const text = (why ?? '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return null;
  for (const pattern of BANNED_WHY_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0].trim();
  }
  return null;
}

/* ------------------------------------------------------------------------------------ *
 * dedupe + note plumbing
 * ------------------------------------------------------------------------------------ */

/**
 * Two verified candidates can carry the same `track.key` when two channels found the same
 * recording under different spellings. They are one track and must be scored once; their
 * hints are merged so no channel's evidence is lost.
 */
function dedupeByKey(candidates: VerifiedCandidate[]): VerifiedCandidate[] {
  const byKey = new Map<string, VerifiedCandidate>();
  for (const item of candidates) {
    const existing = byKey.get(item.track.key);
    if (!existing) {
      // A shallow copy: the merge below must not mutate the pipeline's own pool entry.
      byKey.set(item.track.key, { candidate: item.candidate, track: item.track });
      continue;
    }
    existing.candidate = {
      ...existing.candidate,
      channels: [...new Set([...existing.candidate.channels, ...item.candidate.channels])],
      hints: [...existing.candidate.hints, ...item.candidate.hints],
    };
  }
  return [...byKey.values()];
}

function firstModelNote(candidate: Candidate): string | undefined {
  for (const hint of candidate.hints) {
    if (hint.modelNote && hint.modelNote.trim().length > 0) return hint.modelNote.trim();
  }
  return undefined;
}

function withFlag(flags: string[], flag: string): string[] {
  return flags.includes(flag) ? flags : [...flags, flag];
}

/**
 * One verified candidate -> its deterministic scoring. The pure `scorePair` does the work
 * over the two `FeatureProfile`s; this maps the result onto `ScoredCandidate` and re-asserts
 * the honesty guard so a generic `why` reliably carries `FLAG_WEAK_WHY_UNFIXED`.
 */
function toScored(
  seedProfile: ReturnType<typeof buildFeatureProfile>,
  verified: VerifiedCandidate,
): ScoredCandidate {
  const pair = scorePair(seedProfile, buildFeatureProfile(verified.track));
  let flags = [...pair.flags];
  if (bannedPhraseIn(pair.why)) flags = withFlag(flags, FLAG_WEAK_WHY_UNFIXED);
  return {
    key: verified.track.key,
    dimensions: pair.dimensions,
    why: pair.why,
    whyDiscriminates: '',
    sharedTraits: pair.sharedTraits,
    isCoverOrSameSong: pair.isCoverOrSameSong,
    modelNote: firstModelNote(verified.candidate),
    flags,
  };
}

/* ------------------------------------------------------------------------------------ *
 * scoreBatch
 * ------------------------------------------------------------------------------------ */

/**
 * Stage 5's judgement half, made deterministic.
 *
 * Scores every verified candidate against the seed with the pure similarity scorer and
 * returns them in input order. `fingerprint` is accepted for call-site compatibility but no
 * longer read: both the seed and each candidate are compared through `buildFeatureProfile`,
 * the same measured vector the fingerprint itself is templated from. Never throws; only an
 * aborted signal leaves candidates in `failed`.
 */
export async function scoreBatch(
  seed: TrackRecord,
  _fingerprint: Fingerprint,
  candidates: VerifiedCandidate[],
  ctx: ChannelContext,
): Promise<ScoreOutcome> {
  const unique = dedupeByKey(candidates);
  if (unique.length === 0) return { scored: [], failed: [] };

  if (ctx.signal?.aborted) {
    ctx.log('score: skipped — aborted');
    return { scored: [], failed: unique.map((c) => c.track.key) };
  }

  const seedProfile = buildFeatureProfile(seed);
  const scored = unique.map((verified) => toScored(seedProfile, verified));

  const weak = scored.filter((s) => s.flags.includes(FLAG_WEAK_WHY_UNFIXED)).length;
  ctx.log(
    `score: ${unique.length} candidate(s) scored deterministically`
      + (weak > 0 ? ` (${weak} with a genre-only why)` : ''),
  );

  return { scored, failed: [] };
}
