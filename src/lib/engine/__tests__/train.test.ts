/**
 * The learner (`src/lib/engine/train.ts`) — pure, deterministic, keyless.
 *
 * These fixtures build feedback pairs whose ONLY separating dimension is
 * `rhythmic_character` (matched pairs share a bpm -> score 1; rejected pairs are 60 bpm
 * apart -> score ~0). Every other dimension is a flat neutral 0.5 for both sides — no bpm
 * is the only field set — so its importance is exactly 0. That makes the arithmetic
 * hand-checkable and isolates each property the spec asks for.
 */

import { describe, expect, it } from 'vitest';

import { buildFeatureProfile, type FeatureProfile } from '@/lib/engine/featureProfile';
import { DEFAULT_DIMENSION_WEIGHTS } from '@/lib/engine/rank';
import { learnWeights, pairsFromFeedback, type LearnPair } from '@/lib/engine/train';
import type { SourceRef, TrackRecord } from '@/lib/types';

const SRC: SourceRef = { source: 'deezer' };

function track(partial: Partial<TrackRecord> = {}): TrackRecord {
  return {
    key: 'k',
    isrc: null,
    title: 'T',
    artist: 'A',
    album: null,
    year: null,
    durationMs: null,
    artwork: null,
    preview: null,
    tempoBpm: null,
    keySignature: null,
    links: {},
    ids: {},
    tags: null,
    features: null,
    resolvedAt: 0,
    degraded: [],
    ...partial,
  };
}

const profileWithBpm = (bpm: number): FeatureProfile =>
  buildFeatureProfile(track({ tempoBpm: { value: bpm, source: SRC } }));

const seed = profileWithBpm(100);
const same = profileWithBpm(100); // rhythmic_character 1.0 vs seed
const far = profileWithBpm(160); // rhythmic_character ~0 vs seed (60 bpm apart)

/** `p` match pairs and `n` reject pairs, all separated only on rhythmic_character. */
function pairs(p: number, n: number): LearnPair[] {
  const out: LearnPair[] = [];
  for (let i = 0; i < p; i++) out.push({ seedProfile: seed, candProfile: same, label: 'match' });
  for (let i = 0; i < n; i++) out.push({ seedProfile: seed, candProfile: far, label: 'not' });
  return out;
}

describe('learnWeights — the difference-of-means learner', () => {
  it('is deterministic: the same pairs yield byte-identical weights', () => {
    const a = learnWeights(pairs(2, 2));
    const b = learnWeights(pairs(2, 2));
    expect(a).toEqual(b);
  });

  it('matches the hand-computed weights for the 2-match / 2-reject fixture', () => {
    // n=2, K=5 -> learnedShare 2/7, baseShare 5/7. Only rhythmic has importance (1-0=1),
    // scaled to the base total 27. rhythmic = 2/7*27 + 5/7*6 = 84/7 = 12 -> clamps to 10;
    // every other dimension keeps 5/7 of its base (emotional 4.29->4, genre/scene 3.57->4,
    // instruments 2.14->2, harmony 1.43->1, production 0.71->1, era 2.86->3, the 0s stay 0).
    expect(learnWeights(pairs(2, 2))).toEqual({
      rhythmic_character: 10,
      vocal_delivery: 0,
      emotional_register: 4,
      scene_context: 4,
      signature_hook: 0,
      instrumentation: 2,
      harmonic_language: 1,
      production_texture: 1,
      era: 3,
    });
  });

  it('shrinkage moves with n: more evidence pushes the learned dimension further from base', () => {
    // A modest custom base (total 15) so the climb stays visible before the 0..10 clamp; with
    // the real default (total 27) rhythmic already saturates to 10 at n=2.
    const base = {
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
    const w2 = learnWeights(pairs(2, 2), base).rhythmic_character ?? 0;
    const w6 = learnWeights(pairs(6, 6), base).rhythmic_character ?? 0;
    const w20 = learnWeights(pairs(20, 20), base).rhythmic_character ?? 0;
    // Each step has strictly more evidence, so rhythmic climbs above its base and keeps
    // rising until it saturates at the 0..10 clamp.
    expect(w2).toBeGreaterThan(base.rhythmic_character);
    expect(w6).toBeGreaterThan(w2);
    expect(w20).toBeGreaterThanOrEqual(w6);
    expect(w20).toBe(10);
  });

  it('gives the keyless dimensions (vocal_delivery, signature_hook) ~0 with strong evidence', () => {
    // They score a flat 0.5 in every pair, so their importance is 0; with a large n the
    // shrinkage toward base vanishes and both round to 0.
    const w = learnWeights(pairs(40, 40));
    expect(w.vocal_delivery).toBe(0);
    expect(w.signature_hook).toBe(0);
    // The one dimension that actually separated the user's picks dominates.
    expect(w.rhythmic_character).toBe(10);
  });

  it('returns the base unchanged when there is no signal (matches and rejects look alike)', () => {
    // Both pairs compare the seed to an identical-bpm track, so every dimension is equal on
    // both sides: importance is 0 everywhere -> the base is returned untouched.
    const w = learnWeights([
      { seedProfile: seed, candProfile: same, label: 'match' },
      { seedProfile: seed, candProfile: same, label: 'not' },
    ]);
    expect(w).toEqual(expectedBaseMap());
  });

  it('returns the base for empty feedback', () => {
    expect(learnWeights([])).toEqual(expectedBaseMap());
  });

  it('respects a custom base when there is no signal', () => {
    const base = { ...DEFAULT_DIMENSION_WEIGHTS, rhythmic_character: 7 };
    const w = learnWeights([], base);
    expect(w.rhythmic_character).toBe(7);
  });

  it('learns from reject-only feedback by weighting dimensions the user scores LOW', () => {
    // No matches (n=0 -> learnedShare 0), so the weights collapse back to the base: the
    // shrinkage uses the positive count, and with none the base is all the evidence there is.
    const w = learnWeights([
      { seedProfile: seed, candProfile: far, label: 'not' },
      { seedProfile: seed, candProfile: far, label: 'not' },
    ]);
    expect(w).toEqual(expectedBaseMap());
  });

  it('clamps every weight to an integer in 0..10', () => {
    for (const value of Object.values(learnWeights(pairs(3, 5)))) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(10);
    }
  });
});

describe('pairsFromFeedback — resolving rows to pairs', () => {
  it('resolves both keys and carries the label through', () => {
    const rows = [{ seedKey: 's', candidateKey: 'c', label: 'match' as const }];
    const resolve = (key: string): FeatureProfile | null => (key === 's' ? seed : same);
    const built = pairsFromFeedback(rows, resolve);
    expect(built).toHaveLength(1);
    expect(built[0].label).toBe('match');
    expect(built[0].seedProfile).toBe(seed);
    expect(built[0].candProfile).toBe(same);
  });

  it('skips a pair whose seed or candidate is not cached', () => {
    const rows = [
      { seedKey: 's', candidateKey: 'c', label: 'match' as const }, // both resolve
      { seedKey: 's', candidateKey: 'missing', label: 'not' as const }, // candidate absent
      { seedKey: 'missing', candidateKey: 'c', label: 'not' as const }, // seed absent
    ];
    const resolve = (key: string): FeatureProfile | null =>
      key === 's' ? seed : key === 'c' ? same : null;
    expect(pairsFromFeedback(rows, resolve)).toHaveLength(1);
  });
});

function expectedBaseMap() {
  return {
    rhythmic_character: 6,
    vocal_delivery: 0,
    emotional_register: 6,
    scene_context: 5,
    signature_hook: 0,
    instrumentation: 3,
    harmonic_language: 2,
    production_texture: 1,
    era: 4,
  };
}
