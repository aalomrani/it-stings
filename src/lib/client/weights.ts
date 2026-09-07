/**
 * The `?weights=` param, (de)serialized.
 *
 * The panel holds a FULL nine-key map (one value per scored dimension); the URL carries
 * only the diff from the shared default, and is omitted entirely when nothing differs —
 * an absent param means "score with the defaults", never an empty object (the Build-1
 * engine contract: omit the param to use defaults, do NOT send `{}` as a signal).
 *
 * Reads are lenient: a hand-edited param with a float, an out-of-range value, `tempo_feel`
 * or an unknown key drops that entry rather than throwing, so the panel always hydrates to
 * a well-formed map. The map re-serialized from here is what rides on the recommend
 * request, so the server never sees the junk the URL bar might have held. Kept a pure
 * module (no React, no DOM) so it unit-tests like `shareUrl`.
 */

import { DEFAULT_DIMENSION_WEIGHTS, type WeightsMap } from '@/lib/engine/rank';
import { SCORED_DIMENSION_KEYS, type ScoredDimension } from '@/lib/types';

/** A full slider state: every scored dimension, always present. */
export type ScoredWeights = Record<ScoredDimension, number>;

/**
 * The default the sliders seed to, taken from the ONE engine copy so the UI can never
 * drift from what a defaultless run actually scores with. `tempo_feel` lives in
 * `DEFAULT_DIMENSION_WEIGHTS` but is not a scored key, so it is not projected here.
 */
export const DEFAULT_SCORED_WEIGHTS: ScoredWeights = Object.fromEntries(
  SCORED_DIMENSION_KEYS.map((key) => [key, DEFAULT_DIMENSION_WEIGHTS[key]]),
) as ScoredWeights;

/** Parse a `?weights=` param into a partial map, dropping any entry the schema rejects. */
export function readWeights(raw: string | null): WeightsMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const rec = parsed as Record<string, unknown>;
  const out: WeightsMap = {};
  for (const key of SCORED_DIMENSION_KEYS) {
    const value = rec[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10) {
      out[key] = value;
    }
  }
  return out;
}

/** A full nine-key slider state from a param, missing/invalid dims falling to the default. */
export function hydrateWeights(raw: string | null): ScoredWeights {
  return { ...DEFAULT_SCORED_WEIGHTS, ...readWeights(raw) };
}

/** Only the entries that differ from the default — what the URL and the request carry. */
export function diffFromDefault(weights: ScoredWeights): WeightsMap {
  const out: WeightsMap = {};
  for (const key of SCORED_DIMENSION_KEYS) {
    if (weights[key] !== DEFAULT_SCORED_WEIGHTS[key]) out[key] = weights[key];
  }
  return out;
}

/**
 * The `?weights=` value for a slider state.
 *
 * Normally the diff from the default, or `null` when the state IS the default — an absent
 * param is the engine's "score with the defaults" signal.
 *
 * But an absent param is also what makes the recommend route substitute a trained profile's
 * LEARNED weights (precedence: explicit `?weights=` > profile learned > default). So for a
 * browser that has trained a profile, dropping the param on a default state would leave the
 * sliders at the default while the ranker quietly used the learned mix — the panel lying
 * about the ranking. When `explicit` is set — the user has actually chosen this state
 * (dragged a slider, hit "reset to defaults") — emit the FULL default map instead of null,
 * so the URL is authoritative and the server does not re-apply learned weights. (A full map,
 * not `{}`: `{}` is not a valid "use defaults" signal, real default values are.)
 */
export function weightsParam(weights: ScoredWeights, explicit = false): string | null {
  const diff = diffFromDefault(weights);
  if (Object.keys(diff).length > 0) return JSON.stringify(diff);
  return explicit ? JSON.stringify({ ...DEFAULT_SCORED_WEIGHTS }) : null;
}

/** True when every slider sits at its default — the "reset" control is dead here. */
export function isDefaultWeights(weights: ScoredWeights): boolean {
  return SCORED_DIMENSION_KEYS.every((key) => weights[key] === DEFAULT_SCORED_WEIGHTS[key]);
}

/**
 * A learned `WeightsMap` (from `/api/profile` or `/api/feedback`) projected onto the panel's
 * full nine-slider state: every scored dimension present, a missing one falling to the
 * default, and any non-scored key (`tempo_feel`, junk) simply ignored. This is how the panel
 * is seeded from what a browser has trained.
 */
export function scoredFromLearned(weights: WeightsMap): ScoredWeights {
  const out: ScoredWeights = { ...DEFAULT_SCORED_WEIGHTS };
  for (const key of SCORED_DIMENSION_KEYS) {
    const value = weights[key];
    if (typeof value === 'number') out[key] = value;
  }
  return out;
}
