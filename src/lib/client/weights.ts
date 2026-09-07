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

/** The `?weights=` value for a slider state, or `null` when it is exactly the default. */
export function weightsParam(weights: ScoredWeights): string | null {
  const diff = diffFromDefault(weights);
  return Object.keys(diff).length > 0 ? JSON.stringify(diff) : null;
}

/** True when every slider sits at its default — the "reset" control is dead here. */
export function isDefaultWeights(weights: ScoredWeights): boolean {
  return SCORED_DIMENSION_KEYS.every((key) => weights[key] === DEFAULT_SCORED_WEIGHTS[key]);
}
