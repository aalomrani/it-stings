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
  scoredFromLearned,
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

  // A trained profile makes an ABSENT `?weights=` mean "use my learned weights", so a
  // default state chosen by the user (a drag back to default, or "reset to defaults") must
  // still emit an explicit param — the full default map — or the panel would sit at the
  // default while the ranker quietly used the learned mix.
  it('explicit=true emits the FULL default map (not null, not {}) for a default state', () => {
    const param = weightsParam({ ...DEFAULT_SCORED_WEIGHTS }, true);
    expect(param).not.toBeNull();
    expect(JSON.parse(param as string)).toEqual(DEFAULT_SCORED_WEIGHTS);
    // and it still hydrates back to the default state
    expect(hydrateWeights(param)).toEqual(DEFAULT_SCORED_WEIGHTS);
  });

  it('explicit is irrelevant once the state already differs — still just the diff', () => {
    const state = { ...DEFAULT_SCORED_WEIGHTS, era: 5 };
    expect(JSON.parse(weightsParam(state, true) as string)).toEqual({ era: 5 });
    expect(weightsParam(state, false)).toBe(weightsParam(state, true));
  });
});

describe('isDefaultWeights', () => {
  it('is true only when every slider sits at its default', () => {
    expect(isDefaultWeights({ ...DEFAULT_SCORED_WEIGHTS })).toBe(true);
    expect(isDefaultWeights({ ...DEFAULT_SCORED_WEIGHTS, era: 0 })).toBe(false);
  });
});

describe('scoredFromLearned', () => {
  // How the panel is seeded from what a browser has trained (GET /api/profile) and re-seeded
  // after a vote (POST /api/feedback). A learned map is partial and may name only some dims.
  it('projects a learned map onto the full nine sliders, defaulting the ones it omits', () => {
    const out = scoredFromLearned({ rhythmic_character: 9, era: 0 });
    expect(out.rhythmic_character).toBe(9);
    expect(out.era).toBe(0);
    // an unmentioned dim falls to the engine default
    expect(out.harmonic_language).toBe(DEFAULT_SCORED_WEIGHTS.harmonic_language);
    expect(Object.keys(out).sort()).toEqual([...SCORED_DIMENSION_KEYS].sort());
  });

  it('is exactly the default for an empty (untrained) map', () => {
    expect(scoredFromLearned({})).toEqual(DEFAULT_SCORED_WEIGHTS);
  });

  it('accepts a 0 (learned "turn this trait off") rather than treating it as absent', () => {
    expect(scoredFromLearned({ vocal_delivery: 0 }).vocal_delivery).toBe(0);
  });

  it('ignores a non-scored key like tempo_feel that a stored map might carry', () => {
    const out = scoredFromLearned({ tempo_feel: 8, era: 3 } as Record<string, number>);
    expect('tempo_feel' in out).toBe(false);
    expect(out.era).toBe(3);
  });
});
