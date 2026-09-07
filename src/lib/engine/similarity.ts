/**
 * Stage 5's judgement, made deterministic — pure, no I/O, no model.
 *
 * `scorePair(seed, candidate)` turns two `FeatureProfile`s into the nine `DimensionScore`s
 * `rank.ts` weighs, the concrete `sharedTraits` behind them, a templated `why`, a
 * cover/same-song flag, and any honesty flags. It replaces the LLM `callStructured('score')`
 * seam: same `ScoredCandidate` shape out, so `rank.ts` and the pipeline are untouched.
 *
 * Every number is computed from measured signals on the profiles (bpm, key, the AB mood
 * vector, danceability, normalised tags, year). Where a signal is absent the dimension
 * returns a low-confidence neutral rather than a false zero, and the pair's honest tier —
 * AB-vector / bpm+tags / tags-only — is stamped into each note. The `why` leads with a
 * CONCRETE trait (BPM, key or mood) so `rank.ts` rule 4 never cuts a real match as
 * genre-only; when the ONLY agreement is genre tags, the templater says so and raises
 * `FLAG_WEAK_WHY_UNFIXED`, letting rank cut it — the spec's "say so rather than ship it",
 * enforced without a model.
 */

import { isGenreOnlyTrait } from '@/lib/engine/rank';
import { bannedPhraseIn } from '@/lib/engine/score';
import type { FeatureProfile } from '@/lib/engine/featureProfile';
import type { DimensionScore } from '@/lib/types';
import { sameArtist, sameTitle } from '@/lib/util/normalize';
import { setJaccard, sharedTags, tagNameSet, weightedJaccard } from '@/lib/util/genreTags';

/**
 * `score.ts`'s `FLAG_WEAK_WHY_UNFIXED` and `rank.ts`'s `FLAG_GENERIC_WHY` — the same bare
 * string, re-declared here rather than imported (the codebase's convention for this flag;
 * see rank.ts) so this module stays free of a load-time dependency on score.ts's constants.
 */
export const FLAG_WEAK_WHY_UNFIXED = 'weak-why-unfixed';

/** The nine dimensions, in `rank.SCORED_DIMENSIONS` order. Asserted equal in the tests. */
export const SIMILARITY_DIMENSIONS = [
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

export type SimilarityDimension = (typeof SIMILARITY_DIMENSIONS)[number];

export interface PairScore {
  dimensions: DimensionScore[];
  sharedTraits: string[];
  why: string;
  isCoverOrSameSong: boolean;
  flags: string[];
}

/* ------------------------------------------------------------------------------------ *
 * Small pure helpers
 * ------------------------------------------------------------------------------------ */

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** The honest signal strength a pair's judgement rests on. Stamped into every dimension note. */
export type PairTier = 'AB-vector' | 'bpm+tags' | 'tags-only';

/** The honest tier of a PAIR: the strongest signal both profiles share. */
function pairTier(a: FeatureProfile, b: FeatureProfile): PairTier {
  if (a.tiers.includes('ab-vector') && b.tiers.includes('ab-vector')) return 'AB-vector';
  if (a.tiers.includes('bpm') && b.tiers.includes('bpm')) return 'bpm+tags';
  return 'tags-only';
}

/**
 * Recover the tier `scorePair` stamped into a `DimensionScore.note` (every dimension of a
 * pair carries the same `[tier]` suffix). Lets the pipeline report honest signal strength
 * in `degraded[]` without re-plumbing a field through the frozen `ScoredCandidate` shape.
 */
export function tierFromDimensionNote(note: string | undefined): PairTier | null {
  if (!note) return null;
  const m = /\[(AB-vector|bpm\+tags|tags-only)\]\s*$/.exec(note);
  return m ? (m[1] as PairTier) : null;
}

/* ------------------------------------------------------------------------------------ *
 * Harmonic / Camelot helpers
 * ------------------------------------------------------------------------------------ */

const PITCH_CLASS: Record<string, number> = {
  c: 0, 'b#': 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, fb: 4, f: 5, 'e#': 5,
  'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11, cb: 11,
};

function pitchClass(keyName: string | null): number | null {
  if (!keyName) return null;
  const k = keyName.trim().toLowerCase().replace(/♯/g, '#').replace(/♭/g, 'b');
  const pc = PITCH_CLASS[k];
  return typeof pc === 'number' ? pc : null;
}

/** Circle-of-fifths Camelot number (1-12) for a major-key pitch class. */
function majorCamelotNumber(pc: number): number {
  const pos = (pc * 7) % 12;
  return ((pos + 7) % 12) + 1;
}

interface Camelot {
  n: number;
  letter: 'A' | 'B';
}

function camelot(keyName: string | null, scale: string | null): Camelot | null {
  const pc = pitchClass(keyName);
  if (pc === null) return null;
  if (scale === 'major') return { n: majorCamelotNumber(pc), letter: 'B' };
  if (scale === 'minor') return { n: majorCamelotNumber((pc + 3) % 12), letter: 'A' };
  return null;
}

/** Relative major/minor (same number, other letter) or a perfect-fifth neighbour (same letter, ±1). */
function camelotAdjacent(a: Camelot, b: Camelot): boolean {
  if (a.n === b.n && a.letter !== b.letter) return true;
  if (a.letter === b.letter) {
    const diff = Math.abs(a.n - b.n);
    return diff === 1 || diff === 11;
  }
  return false;
}

/* ------------------------------------------------------------------------------------ *
 * Per-dimension scorers. Each returns { score, note } and, where relevant, feeds a trait.
 * ------------------------------------------------------------------------------------ */

interface DimResult {
  score: number;
  note: string;
}

const NEUTRAL = 0.5;

/**
 * The widest release-year gap that still earns the concrete era trait. Tight on purpose: a
 * shared window of a few years is "the same moment"; a whole decade is the generic era match
 * the spec forbids shipping. (The `era` DIMENSION still scores wider gaps — this only governs
 * whether a shared window becomes a stated, concrete reason.)
 */
const ERA_TRAIT_MAX_GAP = 6;

function bpmGaussian(delta: number): number {
  return Math.exp(-((delta / 12) ** 2));
}

/**
 * Tempo distance that is BLIND to the half-/double-time octave. Deezer (and analysers in
 * general) routinely report a track's BPM in the wrong octave — "Dancing Queen" comes back
 * at ~200, not ~100 — so a raw `|a-b|` makes two songs at the SAME felt tempo look 100 BPM
 * apart and kills the strongest signal the keyless engine has. We fold `b` by ×½ and ×2 and
 * take the closest alignment, so 200 vs 104 measures as ~4, not ~96. Returns both the folded
 * delta and the aligned tempo used, for the note and the trait phrase.
 */
function octaveBpmDelta(a: number, b: number): { delta: number; alignedB: number } {
  const options = [b, b * 2, b / 2];
  let best = { delta: Math.abs(a - b), alignedB: b };
  for (const alignedB of options) {
    const delta = Math.abs(a - alignedB);
    if (delta < best.delta) best = { delta, alignedB };
  }
  return best;
}

function rhythmic(a: FeatureProfile, b: FeatureProfile): DimResult {
  const haveBpm = a.bpm !== null && b.bpm !== null;
  const haveDance = a.danceability !== null && b.danceability !== null;
  if (haveBpm) {
    const { delta } = octaveBpmDelta(a.bpm as number, b.bpm as number);
    let score = bpmGaussian(delta);
    let note = `${Math.round(a.bpm as number)} vs ${Math.round(b.bpm as number)} BPM (Δ${Math.round(delta)} octave-folded)`;
    if (haveDance) {
      const dance = 1 - Math.min(1, Math.abs((a.danceability as number) - (b.danceability as number)));
      score = 0.65 * score + 0.35 * dance;
      note += ', danceability blended';
    }
    return { score, note };
  }
  if (haveDance) {
    const dance = 1 - Math.min(1, Math.abs((a.danceability as number) - (b.danceability as number)));
    return { score: dance, note: 'danceability only (no bpm)' };
  }
  return { score: NEUTRAL, note: 'no tempo signal' };
}

function vocal(a: FeatureProfile, b: FeatureProfile): DimResult {
  if (a.voiceInstrumental !== null && b.voiceInstrumental !== null) {
    const score = 1 - Math.abs(a.voiceInstrumental - b.voiceInstrumental);
    return { score, note: 'voice/instrumental probability compared' };
  }
  return { score: NEUTRAL, note: 'no keyless vocal signal (low confidence)' };
}

function emotional(a: FeatureProfile, b: FeatureProfile): DimResult {
  const diffs: number[] = [];
  const pairs: [number | null, number | null][] = [
    [a.moodVector.happy, b.moodVector.happy],
    [a.moodVector.sad, b.moodVector.sad],
    [a.moodVector.aggressive, b.moodVector.aggressive],
    [a.moodVector.relaxed, b.moodVector.relaxed],
    [a.danceability, b.danceability],
  ];
  for (const [x, y] of pairs) if (x !== null && y !== null) diffs.push(x - y);
  if (diffs.length === 0) return { score: NEUTRAL, note: 'no mood vector (low confidence)' };
  const dist = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
  return { score: 1 - dist, note: `mood-vector distance over ${diffs.length} classifiers` };
}

function harmonic(a: FeatureProfile, b: FeatureProfile): DimResult {
  if (!a.keyName || !b.keyName) return { score: NEUTRAL, note: 'no key signal (low confidence)' };
  const sameScale = a.scale !== null && b.scale !== null && a.scale === b.scale;
  const pcA = pitchClass(a.keyName);
  const pcB = pitchClass(b.keyName);
  const exact = pcA !== null && pcA === pcB && sameScale;
  const ca = camelot(a.keyName, a.scale);
  const cb = camelot(b.keyName, b.scale);
  const adjacent = ca !== null && cb !== null && camelotAdjacent(ca, cb);

  let raw: number;
  let note: string;
  if (exact) {
    raw = 1;
    note = `same key (${a.keyName} ${a.scale})`;
  } else if (adjacent) {
    raw = 0.7;
    note = `harmonically adjacent (${a.keyName} ${a.scale} / ${b.keyName} ${b.scale})`;
  } else if (sameScale) {
    raw = 0.5;
    note = `same mode (${a.scale})`;
  } else if (pcA !== null && pcA === pcB) {
    raw = 0.45;
    note = 'same tonic, different mode';
  } else {
    raw = 0.2;
    note = 'unrelated keys';
  }

  // AB key_strength (when both sides carry it) scales confidence; absent -> factor 1.
  const ks =
    a.keyStrength !== null && b.keyStrength !== null ? Math.min(a.keyStrength, b.keyStrength) : null;
  const factor = ks === null ? 1 : 0.5 + 0.5 * clamp01(ks);
  return { score: raw * factor, note };
}

function instrumentation(a: FeatureProfile, b: FeatureProfile): DimResult {
  const setA = tagNameSet(a.rawTags);
  for (const g of a.genreLabels) setA.add(g);
  const setB = tagNameSet(b.rawTags);
  for (const g of b.genreLabels) setB.add(g);
  if (setA.size === 0 && setB.size === 0) {
    return { score: NEUTRAL, note: 'no instrument/tag signal (low confidence)' };
  }
  return { score: setJaccard(setA, setB), note: 'tag-set overlap (instrument-ish)' };
}

function production(a: FeatureProfile, b: FeatureProfile): DimResult {
  const diffs: number[] = [];
  if (a.loudness !== null && b.loudness !== null) diffs.push(a.loudness - b.loudness);
  if (a.dynComplexity !== null && b.dynComplexity !== null) {
    diffs.push((a.dynComplexity - b.dynComplexity) / 10);
  }
  if (a.centroid !== null && b.centroid !== null) diffs.push((a.centroid - b.centroid) / 4000);
  if (diffs.length === 0) return { score: NEUTRAL, note: 'no production signal (low confidence)' };
  const dist = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
  return { score: 1 - Math.min(1, dist), note: `production distance over ${diffs.length} signals` };
}

function eraCloseness(a: FeatureProfile, b: FeatureProfile, span: number): number | null {
  if (a.year === null || b.year === null) return null;
  return 1 - Math.min(1, Math.abs(a.year - b.year) / span);
}

/**
 * The `scene_context` dimension, shown in the UI as "genre": how much the two songs' own
 * genre/tag sets overlap. Pure genre now — the era nudge is gone, because era is its own
 * scored dimension and blending it here double-counted it. The tags are the SONG's (its
 * album genres, its crowd/MusicBrainz tags), so this measures the song's genre, not a
 * blanket artist label, and includes sub-genres wherever the source carried them.
 */
function scene(a: FeatureProfile, b: FeatureProfile): DimResult {
  const hasTags = a.normalizedTags.length > 0 || b.normalizedTags.length > 0;
  if (!hasTags) return { score: NEUTRAL, note: 'no genre tags to compare (low confidence)' };
  return { score: weightedJaccard(a.rawTags, b.rawTags), note: 'genre/tag overlap (weighted)' };
}

function era(a: FeatureProfile, b: FeatureProfile): DimResult {
  const closeness = eraCloseness(a, b, 50);
  if (closeness === null) return { score: NEUTRAL, note: 'year unknown on one side' };
  return { score: closeness, note: `${a.year} vs ${b.year}` };
}

/* ------------------------------------------------------------------------------------ *
 * Why templater + shared traits
 * ------------------------------------------------------------------------------------ */

interface Trait {
  /** The bare phrase rank.ts inspects (concrete ones must pass isGenreOnlyTrait === false). */
  bare: string;
  /** The clause rendered into the `why` sentence. */
  clause: string;
  strength: number;
  concrete: boolean;
}

function moodLabels(a: FeatureProfile, b: FeatureProfile): string[] {
  const labels: string[] = [];
  const both = (x: number | null, y: number | null, hi: number): boolean =>
    x !== null && y !== null && x >= hi && y >= hi;
  const bothLow = (x: number | null, y: number | null, lo: number): boolean =>
    x !== null && y !== null && x <= lo && y <= lo;
  if (both(a.moodVector.relaxed, b.moodVector.relaxed, 0.5)) labels.push('relaxed');
  if (both(a.moodVector.aggressive, b.moodVector.aggressive, 0.5)) labels.push('aggressive');
  else if (bothLow(a.moodVector.aggressive, b.moodVector.aggressive, 0.25)) labels.push('low-aggression');
  if (both(a.moodVector.happy, b.moodVector.happy, 0.55)) labels.push('upbeat');
  if (both(a.moodVector.sad, b.moodVector.sad, 0.55)) labels.push('melancholy');
  return labels.slice(0, 2);
}

function collectTraits(
  a: FeatureProfile,
  b: FeatureProfile,
  dims: Record<SimilarityDimension, DimResult>,
): Trait[] {
  const traits: Trait[] = [];

  // BPM — the strongest concrete agreement when both are measured and close. Compared
  // octave-folded (see `octaveBpmDelta`) so a half-/double-time reading does not hide a real
  // tempo match; the stated average uses the aligned tempo.
  if (a.bpm !== null && b.bpm !== null) {
    const { delta, alignedB } = octaveBpmDelta(a.bpm, b.bpm);
    if (delta <= 10) {
      const avg = Math.round((a.bpm + alignedB) / 2);
      const feel = a.tempoFeel !== null && a.tempoFeel === b.tempoFeel ? ` with a ${a.tempoFeel} feel` : '';
      const phrase = `both around ${avg} BPM${feel}`;
      traits.push({ bare: phrase, clause: phrase, strength: dims.rhythmic_character.score, concrete: true });
    }
  }

  // Key / scale.
  if (a.keyName && b.keyName && dims.harmonic_language.score >= 0.5) {
    const pcA = pitchClass(a.keyName);
    const pcB = pitchClass(b.keyName);
    const sameScale = a.scale !== null && a.scale === b.scale;
    let phrase: string | null = null;
    if (pcA !== null && pcA === pcB && sameScale) phrase = `both in ${a.keyName} ${a.scale}`;
    else if (sameScale) phrase = `both in a ${a.scale} key`;
    else {
      const ca = camelot(a.keyName, a.scale);
      const cb = camelot(b.keyName, b.scale);
      if (ca && cb && camelotAdjacent(ca, cb)) phrase = 'harmonically adjacent keys';
    }
    if (phrase) traits.push({ bare: phrase, clause: phrase, strength: dims.harmonic_language.score, concrete: true });
  }

  // Mood classifiers.
  if (dims.emotional_register.score >= 0.55) {
    const labels = moodLabels(a, b);
    if (labels.length > 0) {
      const phrase = `both classified ${labels.join(' and ')}`;
      traits.push({ bare: phrase, clause: phrase, strength: dims.emotional_register.score, concrete: true });
    }
  }

  // Danceability.
  if (
    a.danceability !== null && b.danceability !== null
    && a.danceability >= 0.5 && b.danceability >= 0.5
    && Math.abs(a.danceability - b.danceability) <= 0.25
  ) {
    traits.push({ bare: 'similarly danceable', clause: 'similarly danceable', strength: 0.6, concrete: true });
  }

  // Release era — a CONCRETE shared trait, worded with the specific years (never a decade
  // label like "the 1970s", which rank.ts rule 4 blocklists as genre-only). Kept TIGHT — a
  // few years apart, not a whole decade — so it is "the same musical moment", not "any two
  // songs of the era". This is what carries a real match when tempo, key and mood are all
  // unavailable (no Deezer BPM, AcousticBrainz down): the pair still rests on measured
  // evidence — a shared release window plus shared tags — rather than genre alone.
  if (a.year !== null && b.year !== null) {
    const gap = Math.abs(a.year - b.year);
    if (gap <= ERA_TRAIT_MAX_GAP) {
      const lo = Math.min(a.year, b.year);
      const hi = Math.max(a.year, b.year);
      const phrase = gap === 0 ? `both released in ${lo}` : `released ${lo} and ${hi}, ${gap} year${gap === 1 ? '' : 's'} apart`;
      traits.push({ bare: phrase, clause: phrase, strength: dims.era.score, concrete: true });
    }
  }

  // Shared genre tags — concrete=false: the bare phrase is the tags alone, so rank.ts's
  // isGenreOnlyTrait recognises it as a category-only agreement.
  const shared = sharedTags(a.rawTags, b.rawTags).slice(0, 3);
  if (shared.length > 0) {
    const names = shared.map((t) => t.name).join(', ');
    traits.push({
      bare: names,
      clause: `shared tags ${names}`,
      strength: 0.4 + Math.min(0.2, weightedJaccard(a.rawTags, b.rawTags)),
      concrete: false,
    });
  }

  return traits;
}

function sentenceFrom(clauses: string[]): string {
  if (clauses.length === 0) return 'No concrete shared musical traits were measured.';
  const joined = clauses.join('; ');
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/* ------------------------------------------------------------------------------------ *
 * scorePair
 * ------------------------------------------------------------------------------------ */

export function scorePair(seed: FeatureProfile, cand: FeatureProfile): PairScore {
  const tier = pairTier(seed, cand);

  const raw: Record<SimilarityDimension, DimResult> = {
    rhythmic_character: rhythmic(seed, cand),
    vocal_delivery: vocal(seed, cand),
    emotional_register: emotional(seed, cand),
    scene_context: scene(seed, cand),
    signature_hook: { score: NEUTRAL, note: 'no keyless hook signal (low confidence)' },
    instrumentation: instrumentation(seed, cand),
    harmonic_language: harmonic(seed, cand),
    production_texture: production(seed, cand),
    era: era(seed, cand),
  };

  const dimensions: DimensionScore[] = SIMILARITY_DIMENSIONS.map((dimension) => ({
    dimension,
    score: round4(clamp01(raw[dimension].score)),
    note: `${raw[dimension].note} [${tier}]`,
  }));

  // Traits, strongest first, concrete before genre.
  const traits = collectTraits(seed, cand, raw).sort((x, y) => {
    if (x.concrete !== y.concrete) return x.concrete ? -1 : 1;
    return y.strength - x.strength;
  });

  const sharedTraits = traits.slice(0, 5).map((t) => t.bare);
  const why = sentenceFrom(traits.slice(0, 3).map((t) => t.clause));

  const flags: string[] = [];
  const hasConcrete = sharedTraits.some((t) => !isGenreOnlyTrait(t));
  if (!hasConcrete && !flags.includes(FLAG_WEAK_WHY_UNFIXED)) flags.push(FLAG_WEAK_WHY_UNFIXED);
  if (bannedPhraseIn(why) && !flags.includes(FLAG_WEAK_WHY_UNFIXED)) flags.push(FLAG_WEAK_WHY_UNFIXED);

  const isCoverOrSameSong = sameTitle(seed.title, cand.title) && !sameArtist(seed.artist, cand.artist);

  return { dimensions, sharedTraits, why, isCoverOrSameSong, flags };
}
