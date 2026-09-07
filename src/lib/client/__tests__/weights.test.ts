/**
 * The `?weights=` param round-trip.
 *
 * The panel holds a full nine-key map; the URL carries only the diff from the default and
 * is ABSENT when nothing differs (the engine's "use defaults" signal is an absent param,
 * never `{}`). Reads are lenient — a hand-edited param with a float, an out-of-range value,
 * `tempo_feel` or an unknown key drops that entry — so the map the request re-serializes is
 * always well-formed even when the URL bar was not. These pin all four rules.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCORED_WEIGHTS,
  diffFromDefault,
  hydrateWeights,
  isDefaultWeights,
  readWeights,
  weightsParam,
} from '@/lib/client/weights';
import { DEFAULT_DIMENSION_WEIGHTS } from '@/lib/engine/rank';
import { SCORED_DIMENSION_KEYS } from '@/lib/types';

describe('DEFAULT_SCORED_WEIGHTS', () => {
  it('is the nine scored dims projected from the ONE engine copy — never a second hardcode', () => {
    expect(Object.keys(DEFAULT_SCORED_WEIGHTS).sort()).toEqual([...SCORED_DIMENSION_KEYS].sort());
    for (const key of SCORED_DIMENSION_KEYS) {
      expect(DEFAULT_SCORED_WEIGHTS[key]).toBe(DEFAULT_DIMENSION_WEIGHTS[key]);
    }
    // and it must NOT carry tempo_feel — that key is not scorable
    expect('tempo_feel' in DEFAULT_SCORED_WEIGHTS).toBe(false);
  });
});

describe('readWeights', () => {
  it('returns {} for a missing param — the "use defaults" signal', () => {
    expect(readWeights(null)).toEqual({});
    expect(readWeights('')).toEqual({});
  });

  it('keeps only valid scored dims: integer 0..10', () => {
    const raw = JSON.stringify({ era: 4, rhythmic_character: 0, instrumentation: 10 });
    expect(readWeights(raw)).toEqual({ era: 4, rhythmic_character: 0, instrumentation: 10 });
  });

  it('drops floats, out-of-range values, tempo_feel and unknown keys', () => {
    const raw = JSON.stringify({
      era: 2.5, // float
      rhythmic_character: 11, // > 10
      instrumentation: -1, // < 0
      tempo_feel: 3, // not a scored key
      not_a_dim: 5, // unknown
      mood: 4, // unknown (plain-word label, not a key)
      harmonic_language: 3, // the one good entry
    });
    expect(readWeights(raw)).toEqual({ harmonic_language: 3 });
  });

  it('survives malformed JSON, arrays and non-objects without throwing', () => {
    expect(readWeights('{not json')).toEqual({});
    expect(readWeights('[1,2,3]')).toEqual({});
    expect(readWeights('42')).toEqual({});
    expect(readWeights('null')).toEqual({});
  });
});

describe('hydrateWeights', () => {
  it('fills every scored dim, the param overriding the default', () => {
    const hydrated = hydrateWeights(JSON.stringify({ era: 7 }));
    expect(hydrated.era).toBe(7);
    expect(hydrated.rhythmic_character).toBe(DEFAULT_SCORED_WEIGHTS.rhythmic_character);
    expect(Object.keys(hydrated).sort()).toEqual([...SCORED_DIMENSION_KEYS].sort());
  });

  it('is exactly the default for a missing param', () => {
    expect(hydrateWeights(null)).toEqual(DEFAULT_SCORED_WEIGHTS);
  });
});

describe('weightsParam / diffFromDefault', () => {
  it('is null when the state is exactly the default — the param is omitted', () => {
    expect(weightsParam({ ...DEFAULT_SCORED_WEIGHTS })).toBeNull();
    expect(diffFromDefault({ ...DEFAULT_SCORED_WEIGHTS })).toEqual({});
  });

  it('serializes only the entries that differ from the default', () => {
    const state = { ...DEFAULT_SCORED_WEIGHTS, era: 5, scene_context: 2 };
    expect(diffFromDefault(state)).toEqual({ era: 5, scene_context: 2 });
    expect(JSON.parse(weightsParam(state) as string)).toEqual({ era: 5, scene_context: 2 });
  });

  it('round-trips: hydrate(param(state)) === state', () => {
    const state = { ...DEFAULT_SCORED_WEIGHTS, rhythmic_character: 0, era: 6 };
    expect(hydrateWeights(weightsParam(state))).toEqual(state);
  });
});

describe('isDefaultWeights', () => {
  it('is true only when every slider sits at its default', () => {
    expect(isDefaultWeights({ ...DEFAULT_SCORED_WEIGHTS })).toBe(true);
    expect(isDefaultWeights({ ...DEFAULT_SCORED_WEIGHTS, era: 0 })).toBe(false);
  });
});
