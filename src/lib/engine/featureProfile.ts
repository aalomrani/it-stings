/**
 * The single comparable vector for a track — pure, no I/O.
 *
 * `buildFeatureProfile` distils a resolved `TrackRecord` into the one shape both the
 * deterministic fingerprint (Stage 2) and the deterministic similarity scorer (Stage 5)
 * read, so the two can never disagree about what the record "is". Everything here is
 * copied off measured fields already sitting on the record after resolve — nothing is
 * invented, nothing is fetched.
 *
 * A note on coverage: `TrackRecord.features` carries the AcousticBrainz high-level signals
 * — danceability + the four moods + genreLabels — and, when AB scored them, the texture
 * signals the deterministic scorer reads: key_strength, average_loudness, dynamic_complexity,
 * spectral_centroid and voice_instrumental (all optional/additive on the record, populated by
 * the resolver from `acousticbrainz.getFeatures`). `keySignature`/`tempoBpm` carry the
 * low-level tempo/key pair. Any field AB did not measure reads as null here, and the scorer
 * treats its absence as "no signal" rather than "no match". The `tiers` array records which
 * signals a profile actually has, so a pair's honest tier (AB-vector / bpm+tags / tags-only)
 * can be reported downstream.
 */

import type { TempoFeel, TrackRecord } from '@/lib/types';
import { normalizeTags, type WeightedTag } from '@/lib/util/genreTags';

/** Which measured signals a profile carries — drives the honest per-pair tier note. */
export type FeatureTier = 'ab-vector' | 'bpm' | 'tags';

export interface MoodVector {
  happy: number | null;
  sad: number | null;
  aggressive: number | null;
  relaxed: number | null;
}

export interface FeatureProfile {
  /** Identity, carried for cover detection and the `why` context. */
  key: string;
  title: string;
  artist: string;

  bpm: number | null;
  tempoFeel: TempoFeel | null;

  /** The raw "F major" string, plus its split halves. */
  keySignature: string | null;
  keyName: string | null; // "F", "C#", …
  scale: string | null; // "major" | "minor" | other
  /** AB tonal.key_strength when available (else null). */
  keyStrength: number | null;

  moodVector: MoodVector;
  danceability: number | null;

  /** AB low-level texture signals — null when AB did not measure them; read by the scorer. */
  loudness: number | null;
  dynComplexity: number | null;
  centroid: number | null;
  /** voice_instrumental voice probability — null when AB did not measure it. */
  voiceInstrumental: number | null;

  rawTags: WeightedTag[];
  normalizedTags: WeightedTag[];
  genreLabels: string[];

  year: number | null;
  /** iTunes primaryGenreName — not carried on TrackRecord, so null for now. */
  itunesGenre: string | null;

  tiers: FeatureTier[];
}

/**
 * BPM -> the coarse feel bucket. Boundaries per the plan (and reused verbatim by the
 * deterministic fingerprint so the two agree): dragging <70, relaxed <92, walking <110,
 * bouncing <132, driving <150, frantic ≥150. Null bpm -> null feel.
 */
export function bucketTempoFeel(bpm: number | null): TempoFeel | null {
  if (bpm === null || !Number.isFinite(bpm) || bpm <= 0) return null;
  if (bpm < 70) return 'dragging';
  if (bpm < 92) return 'relaxed';
  if (bpm < 110) return 'walking';
  if (bpm < 132) return 'bouncing';
  if (bpm < 150) return 'driving';
  return 'frantic';
}

/** Split "F# minor" into { keyName: "F#", scale: "minor" }. Robust to a bare "F". */
export function splitKeySignature(sig: string | null): { keyName: string | null; scale: string | null } {
  if (!sig || typeof sig !== 'string') return { keyName: null, scale: null };
  const trimmed = sig.trim();
  if (trimmed.length === 0) return { keyName: null, scale: null };
  const m = /^(\S+)(?:\s+(.+))?$/.exec(trimmed);
  if (!m) return { keyName: null, scale: null };
  return { keyName: m[1], scale: m[2] ? m[2].toLowerCase() : null };
}

function toWeightedTags(tags: TrackRecord['tags']): WeightedTag[] {
  if (!tags?.value) return [];
  return tags.value.map((t) => ({ name: t.name, count: t.count }));
}

/** True when at least one of the four AB moods is measured. */
function hasMoodVector(m: MoodVector): boolean {
  return m.happy !== null || m.sad !== null || m.aggressive !== null || m.relaxed !== null;
}

/**
 * Distil a resolved track into its comparable vector. Total function: every field is a
 * copy or a null, never a throw, for any well-typed `TrackRecord`.
 */
export function buildFeatureProfile(track: TrackRecord): FeatureProfile {
  const bpm = track.tempoBpm?.value ?? null;
  const { keyName, scale } = splitKeySignature(track.keySignature?.value ?? null);

  const f = track.features;
  const moodVector: MoodVector = {
    happy: f?.moodHappy ?? null,
    sad: f?.moodSad ?? null,
    aggressive: f?.moodAggressive ?? null,
    relaxed: f?.moodRelaxed ?? null,
  };
  const danceability = f?.danceability ?? null;

  const rawTags = toWeightedTags(track.tags);
  const normalizedTags = normalizeTags(rawTags);
  const genreLabels = (f?.genreLabels ?? []).filter((g) => typeof g === 'string' && g.length > 0);

  const tiers: FeatureTier[] = [];
  if (hasMoodVector(moodVector)) tiers.push('ab-vector');
  if (bpm !== null) tiers.push('bpm');
  if (normalizedTags.length > 0) tiers.push('tags');

  return {
    key: track.key,
    title: track.title,
    artist: track.artist,
    bpm,
    tempoFeel: bucketTempoFeel(bpm),
    keySignature: track.keySignature?.value ?? null,
    keyName,
    scale,
    keyStrength: f?.keyStrength ?? null,
    moodVector,
    danceability,
    loudness: f?.loudness ?? null,
    dynComplexity: f?.dynamicComplexity ?? null,
    centroid: f?.spectralCentroid ?? null,
    voiceInstrumental: f?.voiceInstrumental ?? null,
    rawTags,
    normalizedTags,
    genreLabels,
    year: track.year?.value ?? null,
    itunesGenre: null,
    tiers,
  };
}
