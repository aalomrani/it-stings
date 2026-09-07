/**
 * The trainable engine — learning one profile's nine DimensionScore weights from the pairs
 * they marked "this matches" / "not a match".
 *
 * The whole ranking engine is deterministic and keyless: `scorePair` turns two
 * `FeatureProfile`s into the nine measured `DimensionScore`s, and `rank` sums them with a
 * `WeightsMap`. Those weights were already per-run tunable (the sliders); TRAINING learns a
 * user's weights from their feedback instead of asking them to move sliders.
 *
 * This module is PURE and deterministic: no `Date.now()`, no `Math.random()`, no database,
 * no network, no model. Timestamps and track lookups are done by the route/repo layer and
 * the resolved `FeatureProfile`s are passed in, so the same feedback always yields exactly
 * the same weights — which is what makes the result explainable and testable.
 *
 * The method (difference-of-means, scale-to-base-total, count-shrinkage):
 *   1. For each voted pair, `scorePair` gives the nine dimension scores (0..1).
 *   2. For each dimension d: how much higher do LIKED pairs score than DISLIKED pairs?
 *        importance_d = max(0, mean(match scores) − mean(not scores)).
 *      A dimension the user's matches score high on and their rejects score low on earns
 *      weight; one that looks the same either way (vocal_delivery and signature_hook are a
 *      flat ~0.5 in every keyless pair) earns ~0.
 *   3. Scale the importances so they sum to the base total (Σ default = 15), preserving the
 *      engine's overall scoring scale.
 *   4. Shrink toward the base by how much evidence there is: with n matches and K=5,
 *        w_d = round( (n/(n+K))·scaled_d + (K/(n+K))·base_d ), clamped to 0..10.
 *      One or two votes barely move the defaults; ~15+ votes strongly reflect the user.
 *   With no usable signal at all (every importance 0), the base is returned unchanged.
 */

import type { FeatureProfile } from '@/lib/engine/featureProfile';
import { scorePair } from '@/lib/engine/similarity';
import { DEFAULT_DIMENSION_WEIGHTS, type WeightsMap } from '@/lib/engine/rank';
import { SCORED_DIMENSION_KEYS, type ScoredDimension } from '@/lib/types';

/** The count-shrinkage constant: the number of "prior" examples the base weights are worth. */
export const SHRINKAGE_K = 5;

/** The neutral midpoint a dimension takes when a side (matches, or rejects) is empty. */
const NEUTRAL = 0.5;

/** One resolved training example: two profiles and the label the user gave the pair. */
export interface LearnPair {
  seedProfile: FeatureProfile;
  candProfile: FeatureProfile;
  label: 'match' | 'not';
}

/** A minimal feedback row — what `pairsFromFeedback` needs, satisfied by the repo's rows. */
export interface FeedbackPairInput {
  seedKey: string;
  candidateKey: string;
  label: 'match' | 'not';
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? NEUTRAL : xs.reduce((a, b) => a + b, 0) / xs.length;

const clampWeight = (n: number): number => (n < 0 ? 0 : n > 10 ? 10 : Math.round(n));

/**
 * Turn feedback rows into learnable pairs. PURE: the caller supplies `resolve`, which looks
 * a track key up (via the tracks repo) and returns its `FeatureProfile`, or `null` when the
 * track is not cached. A pair whose seed or candidate cannot be resolved is skipped — it
 * carries no measurable signal — rather than dropped as an error.
 */
export function pairsFromFeedback(
  rows: FeedbackPairInput[],
  resolve: (key: string) => FeatureProfile | null,
): LearnPair[] {
  const pairs: LearnPair[] = [];
  for (const row of rows) {
    const seedProfile = resolve(row.seedKey);
    if (!seedProfile) continue;
    const candProfile = resolve(row.candidateKey);
    if (!candProfile) continue;
    pairs.push({ seedProfile, candProfile, label: row.label });
  }
  return pairs;
}

/**
 * Learn a `WeightsMap` from a profile's voted pairs. Deterministic in its arguments; with
 * no pairs (or no usable signal) it returns `base` unchanged, so an untrained profile ranks
 * exactly like the default engine.
 */
export function learnWeights(
  pairs: LearnPair[],
  base: WeightsMap = DEFAULT_DIMENSION_WEIGHTS,
): WeightsMap {
  const baseOf = (d: ScoredDimension): number => base[d] ?? DEFAULT_DIMENSION_WEIGHTS[d] ?? 0;
  const baseMap = (): WeightsMap =>
    Object.fromEntries(SCORED_DIMENSION_KEYS.map((d) => [d, baseOf(d)])) as WeightsMap;

  // No feedback at all: nothing to learn, hand back the base weights.
  if (pairs.length === 0) return baseMap();

  // Collect each dimension's scores, split by label.
  const pos: Record<ScoredDimension, number[]> = blankBuckets();
  const neg: Record<ScoredDimension, number[]> = blankBuckets();
  let posCount = 0;
  for (const pair of pairs) {
    const bucket = pair.label === 'match' ? pos : neg;
    if (pair.label === 'match') posCount += 1;
    for (const dim of scorePair(pair.seedProfile, pair.candProfile).dimensions) {
      // `scorePair` returns exactly the nine scored dimensions; guard the cast anyway.
      if (dim.dimension in bucket) bucket[dim.dimension as ScoredDimension].push(dim.score);
    }
  }

  // importance_d = max(0, mean(match) − mean(not)); an absent side is the neutral midpoint.
  const importance: Record<ScoredDimension, number> = {} as Record<ScoredDimension, number>;
  let total = 0;
  for (const d of SCORED_DIMENSION_KEYS) {
    const mp = pos[d].length ? mean(pos[d]) : NEUTRAL;
    const mn = neg[d].length ? mean(neg[d]) : NEUTRAL;
    const imp = Math.max(0, mp - mn);
    importance[d] = imp;
    total += imp;
  }

  // No dimension separates likes from dislikes yet: no signal, keep the base.
  if (total === 0) return baseMap();

  // Scale the importances so they sum to the base total (Σ default = 15), preserving scale.
  const baseTotal = SCORED_DIMENSION_KEYS.reduce((sum, d) => sum + baseOf(d), 0);
  const scale = baseTotal / total;

  // Shrink toward the base by the number of positive examples: n/(n+K) of the learned
  // signal, K/(n+K) of the base. Few votes -> barely moved; many -> strongly the user's.
  const n = posCount;
  const learnedShare = n / (n + SHRINKAGE_K);
  const baseShare = SHRINKAGE_K / (n + SHRINKAGE_K);

  const out: WeightsMap = {};
  for (const d of SCORED_DIMENSION_KEYS) {
    const scaled = importance[d] * scale;
    out[d] = clampWeight(learnedShare * scaled + baseShare * baseOf(d));
  }
  return out;
}

function blankBuckets(): Record<ScoredDimension, number[]> {
  const out = {} as Record<ScoredDimension, number[]>;
  for (const d of SCORED_DIMENSION_KEYS) out[d] = [];
  return out;
}
