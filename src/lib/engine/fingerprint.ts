/**
 * Stage 2 — the fingerprint, made DETERMINISTIC and KEYLESS.
 *
 * There is no model call here any more. `fingerprintTrack` assembles a fully-populated
 * `Fingerprint` in code from the measured signals the resolver already collected, via the
 * shared `buildFeatureProfile` — the same comparable vector Stage 5's scorer reads, so the
 * two stages can never disagree about what the record "is".
 *
 * The division of labour the spec asked for survives, only now BOTH halves are code:
 *
 *   - The four fields code has always owned — `tempo_bpm`, `era`, `model`, `grounded_on` —
 *     are still copied straight off the `TrackRecord`; a tempo or a year is never invented,
 *     because there is no interpreter left to invent one.
 *   - The nine judgement fields are TEMPLATED from measured data: `tempo_feel` bucketed from
 *     bpm, `rhythmic_character` from bpm + danceability, `emotional_register` from the AB
 *     mood vector, `harmonic_language` from key + scale, `instrumentation`/`scene_context`
 *     from the normalised tags, `genre_labels` from tags ∪ AB classifier labels. Where a
 *     signal has no keyless source (`vocal_delivery`, `signature_hook`, and the low-level
 *     texture behind `production_texture`) the field says so honestly — "not interpreted
 *     (keyless)" — rather than guessing, and its confidence is `low`.
 *
 * `model` is a stable ENGINE id ('deterministic-v1'), never a Claude id, and
 * `fingerprintTrack` ALWAYS returns `{ ok: true }`: there is no key to be missing and no
 * network to fail, so the pipeline's Stage-2 model-unavailable branch is unreachable.
 *
 * Still cached in the `fingerprints` table by (track key, engine id, prompt version +
 * corrections hash); the version is bumped to `fp-det-1` so any LLM-era row is invalidated.
 */

import 'server-only';

import * as fingerprintsRepo from '@/lib/db/repos/fingerprints';
import { buildFeatureProfile, type FeatureProfile } from '@/lib/engine/featureProfile';
import { isGenreOnlyTrait } from '@/lib/engine/rank';
import {
  TempoFeelSchema,
  type Confidence,
  type Fingerprint,
  type FingerprintField,
  type RunOptions,
  type SourceName,
  type TempoFeel,
  type TrackRecord,
} from '@/lib/types';
import { stableHash } from '@/lib/util/ids';

/* ------------------------------------------------------------------------------------ *
 * Engine id + prompt version
 * ------------------------------------------------------------------------------------ */

/**
 * The `model` tag on every `Fingerprint` this stage produces, and the `model` column of its
 * cache row. A STABLE engine id, deliberately NOT a Claude id: no model runs here.
 */
export const ENGINE_MODEL_ID = 'deterministic-v1';

/**
 * Part of the fingerprint cache key AND of the run cache key. Bump it on ANY change to how
 * the fields below are templated. Bumped to `fp-det-1` for the keyless engine so no LLM-era
 * fingerprint row is ever served.
 */
export const FINGERPRINT_PROMPT_VERSION = 'fp-det-1';

/* ------------------------------------------------------------------------------------ *
 * Grounding helpers (shared with `grounded_on`)
 * ------------------------------------------------------------------------------------ */

/** Human names for the provenance stamps, so the block reads like the UI does. */
const SOURCE_LABEL: Record<SourceName, string> = {
  itunes: 'iTunes',
  deezer: 'Deezer',
  musicbrainz: 'MusicBrainz',
  acousticbrainz: 'AcousticBrainz',
  lastfm: 'Last.fm',
  spotify: 'Spotify',
  getsongbpm: 'GetSongBPM',
  web: 'web search',
  model: 'model',
  user: 'listener',
};

/** "Deezer bpm" / "MusicBrainz first-release-date" / "iTunes". */
function stamp(source: { source: SourceName; field?: string; id?: string }): string {
  const name = SOURCE_LABEL[source.source] ?? source.source;
  return source.field ? `${name} ${source.field}` : name;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/** Only the tags Last.fm supplied; the resolver falls back to MusicBrainz in the same field. */
function lastfmTags(track: TrackRecord): { name: string; count: number }[] | null {
  if (!track.tags || track.tags.source.source !== 'lastfm') return null;
  return track.tags.value.length > 0 ? track.tags.value : null;
}

/** MusicBrainz tags/genres, which the resolver writes into `tags` only when Last.fm is absent. */
function musicbrainzTags(track: TrackRecord): { name: string; count: number }[] | null {
  if (!track.tags || track.tags.source.source !== 'musicbrainz') return null;
  return track.tags.value.length > 0 ? track.tags.value : null;
}

/** How many crowd tags reach `grounded_on`. Past ~15 they are noise. */
const MAX_TAGS_IN_PROMPT = 15;

function featureSummary(features: TrackRecord['features']): string | null {
  if (!features) return null;
  const parts: string[] = [];
  const pct = (label: string, v: number | undefined) => {
    if (typeof v === 'number' && Number.isFinite(v)) parts.push(`${label} ${v.toFixed(2)}`);
  };
  pct('danceability', features.danceability);
  pct('mood happy', features.moodHappy);
  pct('mood aggressive', features.moodAggressive);
  pct('mood relaxed', features.moodRelaxed);
  pct('mood sad', features.moodSad);
  if (features.genreLabels && features.genreLabels.length > 0) {
    parts.push(`classifier genre ${features.genreLabels.join(', ')}`);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

/* ------------------------------------------------------------------------------------ *
 * Corrections
 * ------------------------------------------------------------------------------------ */

/**
 * One correction, normalised: `'wrong'` means re-interpret, anything else is the
 * listener's own value for the field. Empty strings are dropped — an empty text box is
 * not a correction.
 */
export interface NormalisedCorrection {
  field: FingerprintField;
  kind: 'reject' | 'replace';
  value: string;
}

/** The literal a `RunOptions['corrections']` entry uses to mean "re-interpret this field". */
export const CORRECTION_REJECT = 'wrong';

/** Sorted by field name so the same corrections always hash and template identically. */
export function normaliseCorrections(
  corrections: RunOptions['corrections'],
): NormalisedCorrection[] {
  if (!corrections) return [];
  const out: NormalisedCorrection[] = [];
  for (const [field, raw] of Object.entries(corrections)) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value.length === 0) continue;
    out.push({
      field: field as FingerprintField,
      kind: value.toLowerCase() === CORRECTION_REJECT ? 'reject' : 'replace',
      value,
    });
  }
  return out.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
}

/**
 * The `prompt_version` column value: the frozen version, plus a hash of the listener's
 * corrections when there are any. Two different corrections are two different readings of
 * the same track and must not share a cache row.
 */
export function fingerprintPromptKey(corrections?: RunOptions['corrections']): string {
  const normalised = normaliseCorrections(corrections);
  if (normalised.length === 0) return FINGERPRINT_PROMPT_VERSION;
  const payload = normalised.map((c) => [c.field, c.kind, c.value]);
  return `${FINGERPRINT_PROMPT_VERSION}+c${stableHash(payload).slice(0, 12)}`;
}

/* ------------------------------------------------------------------------------------ *
 * grounded_on
 * ------------------------------------------------------------------------------------ */

/**
 * `grounded_on`: the human-readable trail the UI prints under the fingerprint. Absent
 * measurements are listed AS absent — "tempo: unknown" is information the listener needs
 * in order to judge the reading, and it is what stops "132 BPM" ever appearing without a
 * source behind it.
 *
 * Deliberately carries no title, artist or album: Channel C is handed the fingerprint with
 * the seed's identity withheld and strips identity-bearing lines from this list, and the
 * cheapest way to survive that is not to write them here.
 */
export function buildGroundedOn(track: TrackRecord): string[] {
  const out: string[] = [];

  out.push(
    track.tempoBpm
      ? `tempo ${track.tempoBpm.value} BPM (${stamp(track.tempoBpm.source)})`
      : 'tempo unknown — no source',
  );
  out.push(
    track.year ? `year ${track.year.value} (${stamp(track.year.source)})` : 'year unknown — no source',
  );
  if (track.durationMs) {
    out.push(`duration ${formatDuration(track.durationMs.value)} (${stamp(track.durationMs.source)})`);
  }
  if (track.keySignature) {
    out.push(`key ${track.keySignature.value} (${stamp(track.keySignature.source)})`);
  }

  const features = featureSummary(track.features);
  if (features && track.features) out.push(`${stamp(track.features.source)}: ${features}`);

  const mb = musicbrainzTags(track);
  if (mb) out.push(`MusicBrainz tags/genres: ${mb.map((t) => t.name).join(', ')}`);

  const lfm = lastfmTags(track);
  out.push(
    lfm
      ? `Last.fm tags: ${lfm
          .slice(0, MAX_TAGS_IN_PROMPT)
          .map((t) => `${t.name} (${t.count})`)
          .join(', ')}`
      : 'Last.fm tags: not available',
  );

  return out;
}

/* ------------------------------------------------------------------------------------ *
 * Corrections, applied in code
 * ------------------------------------------------------------------------------------ */

/** Fields whose value is a list; a listener's comma-separated string becomes one. */
const LIST_FIELDS = new Set<FingerprintField>(['instrumentation']);

function splitList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Overwrites the engine's value with the listener's for every `replace` correction, sets
 * that field's confidence to `high` (the listener is the authority on their own hearing)
 * and records it in `grounded_on`.
 *
 * `tempo_feel` is the one field a free-text correction cannot always land in: it is a
 * closed enum, so a value outside it is left as the engine templated it. Everything else is
 * taken verbatim.
 */
export function applyCorrections(
  fingerprint: Fingerprint,
  corrections: NormalisedCorrection[],
): Fingerprint {
  if (corrections.length === 0) return fingerprint;

  const next: Fingerprint = {
    ...fingerprint,
    instrumentation: [...fingerprint.instrumentation],
    genre_labels: [...fingerprint.genre_labels],
    confidence: { ...fingerprint.confidence },
    grounded_on: [...fingerprint.grounded_on],
  };

  for (const c of corrections) {
    if (c.kind !== 'replace') continue;

    if (c.field === 'tempo_feel') {
      const parsed = TempoFeelSchema.safeParse(c.value.toLowerCase());
      if (!parsed.success) continue; // not one of the six; the templated reading survives
      next.tempo_feel = parsed.data;
    } else if (LIST_FIELDS.has(c.field)) {
      const list = splitList(c.value);
      if (list.length === 0) continue;
      next.instrumentation = list;
    } else {
      // Every remaining correctable field is a plain string on `Fingerprint`.
      (next as unknown as Record<string, string>)[c.field] = c.value;
    }

    next.confidence[c.field] = 'high' satisfies Confidence;
    next.grounded_on.push(`listener correction: ${c.field} = "${c.value}"`);
  }

  return next;
}

/* ------------------------------------------------------------------------------------ *
 * fingerprintTrack
 * ------------------------------------------------------------------------------------ */

export interface FingerprintOptions {
  /** The listener's disagreements with a previous fingerprint of this track. */
  corrections?: RunOptions['corrections'];
  /** Skip the cache READ (the row is still written). Used by `npm run eval` and by a re-run. */
  force?: boolean;
  /**
   * Carried by the pipeline call-site for shape compatibility; the deterministic engine
   * makes no model calls, so nothing is counted here. Ignored.
   */
  usage?: unknown;
  /**
   * The fingerprint the listener was looking at when they rejected a field. Optional and,
   * for the deterministic engine, unused for re-interpretation (a `reject` correction is a
   * no-op now: there is nothing to re-ask). Kept for call-site compatibility.
   */
  previous?: Fingerprint | null;
  signal?: AbortSignal;
}

export type FingerprintResult =
  | { ok: true; fingerprint: Fingerprint; cached: boolean }
  | { ok: false; reason: string };

/**
 * Stage 2. Returns the seed's fingerprint, from cache when one exists for this exact
 * (track, engine id, prompt + corrections) triple, otherwise assembled deterministically
 * from the record's measured signals. ALWAYS `{ ok: true }` on a well-typed record: there
 * is no key to be missing and no model to fail. Only an aborted signal short-circuits.
 */
export async function fingerprintTrack(
  track: TrackRecord,
  opts: FingerprintOptions = {},
): Promise<FingerprintResult> {
  if (opts.signal?.aborted) return { ok: false, reason: 'aborted' };

  const corrections = normaliseCorrections(opts.corrections);
  const promptVersion = fingerprintPromptKey(opts.corrections);
  const cacheKey = { trackKey: track.key, model: ENGINE_MODEL_ID, promptVersion };

  if (!opts.force) {
    const cached = readCache(cacheKey);
    if (cached) return { ok: true, fingerprint: cached, cached: true };
  }

  const fingerprint = applyCorrections(assemble(track), corrections);
  writeCache(cacheKey, fingerprint);
  return { ok: true, fingerprint, cached: false };
}

/* ------------------------------------------------------------------------------------ *
 * Deterministic assembly — the nine judgement fields, templated from measured data
 * ------------------------------------------------------------------------------------ */

/** `genre_labels` is spec'd as 2-5; a longer list is trimmed. */
const MAX_GENRE_LABELS = 5;
/** Concrete tags rendered into `instrumentation`. */
const MAX_INSTRUMENTATION = 6;
/** The honest string a field carries when no keyless source can speak to it. */
const KEYLESS_PLACEHOLDER = 'not interpreted (keyless)';
/** The felt-motion fallback when no BPM was measured; confidence is `low` alongside it. */
const DEFAULT_TEMPO_FEEL: TempoFeel = 'walking';

/** A number formatted for prose without trailing noise. */
function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** BPM (+ danceability) -> a concrete groove sentence. */
function rhythmicText(p: FeatureProfile): { text: string; confidence: Confidence } {
  if (p.bpm !== null) {
    const feel = p.tempoFeel ?? DEFAULT_TEMPO_FEEL;
    let text = `a ${feel} groove around ${Math.round(p.bpm)} BPM`;
    if (p.danceability !== null) {
      const level = p.danceability >= 0.6 ? 'highly danceable' : p.danceability >= 0.4 ? 'moderately danceable' : 'low-danceability';
      text += `, ${level} (${fmt(p.danceability)})`;
      return { text, confidence: 'high' };
    }
    return { text, confidence: 'medium' };
  }
  if (p.danceability !== null) {
    const level = p.danceability >= 0.6 ? 'highly danceable' : p.danceability >= 0.4 ? 'moderately danceable' : 'low-danceability';
    return { text: `${level} (${fmt(p.danceability)}); tempo not measured`, confidence: 'low' };
  }
  return { text: `rhythm ${KEYLESS_PLACEHOLDER}`, confidence: 'low' };
}

/** The AB 4-mood vector -> an emotional-stance sentence. */
function emotionalText(p: FeatureProfile): { text: string; confidence: Confidence } {
  const m = p.moodVector;
  const labels: string[] = [];
  if (m.relaxed !== null && m.relaxed >= 0.5) labels.push('relaxed');
  if (m.aggressive !== null) {
    if (m.aggressive >= 0.5) labels.push('aggressive');
    else if (m.aggressive <= 0.25) labels.push('low-aggression');
  }
  if (m.happy !== null && m.happy >= 0.55) labels.push('upbeat');
  if (m.sad !== null && m.sad >= 0.55) labels.push('melancholy');
  const any = m.happy !== null || m.sad !== null || m.aggressive !== null || m.relaxed !== null;
  if (labels.length > 0) {
    return { text: `classified ${labels.join(', ')}`, confidence: 'medium' };
  }
  if (any) {
    return { text: 'a measured but centrist mood profile (no strong classifier)', confidence: 'low' };
  }
  return { text: `emotional register ${KEYLESS_PLACEHOLDER}`, confidence: 'low' };
}

/** Key + scale -> a harmonic sentence. Never a chord analysis — that has no keyless source. */
function harmonicText(p: FeatureProfile): { text: string; confidence: Confidence } {
  if (p.keyName && p.scale) {
    return { text: `${p.keyName} ${p.scale} tonality`, confidence: 'medium' };
  }
  if (p.keyName) {
    return { text: `centred on ${p.keyName}`, confidence: 'low' };
  }
  return { text: `harmonic language ${KEYLESS_PLACEHOLDER}`, confidence: 'low' };
}

/** Top normalised tags -> a scene-context sentence (soft; genre-guarded downstream). */
function sceneText(p: FeatureProfile): { text: string; confidence: Confidence } {
  const labels = topTagNames(p, 3);
  if (labels.length > 0) {
    return { text: `filed under ${labels.join(', ')}`, confidence: 'low' };
  }
  return { text: `scene context ${KEYLESS_PLACEHOLDER}`, confidence: 'low' };
}

/** The most-weighted normalised tag names, up to `n`. */
function topTagNames(p: FeatureProfile, n: number): string[] {
  return p.normalizedTags.slice(0, n).map((t) => t.name);
}

/** genre_labels = normalised tags ∪ AB classifier labels, deduped, capped. */
function genreLabels(p: FeatureProfile): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...p.normalizedTags.map((t) => t.name), ...p.genreLabels]) {
    const value = name.trim();
    if (value.length === 0) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length === MAX_GENRE_LABELS) break;
  }
  return out;
}

/**
 * The deterministic `Fingerprint`. The four code-owned fields (`tempo_bpm`, `era`, `model`,
 * `grounded_on`) are copied off the record exactly as before; the nine judgement fields are
 * templated from the shared `FeatureProfile`.
 */
function assemble(track: TrackRecord): Fingerprint {
  const p = buildFeatureProfile(track);

  const rhythmic = rhythmicText(p);
  const emotional = emotionalText(p);
  const harmonic = harmonicText(p);
  const scene = sceneText(p);
  const instrumentation = topTagNames(p, MAX_INSTRUMENTATION);

  const fingerprint: Fingerprint = {
    tempo_bpm: track.tempoBpm?.value ?? null,
    tempo_feel: p.tempoFeel ?? DEFAULT_TEMPO_FEEL,
    rhythmic_character: rhythmic.text,
    instrumentation,
    vocal_delivery: `vocal delivery ${KEYLESS_PLACEHOLDER}`,
    harmonic_language: harmonic.text,
    emotional_register: emotional.text,
    production_texture: `production texture ${KEYLESS_PLACEHOLDER}`,
    era: track.year?.value ?? null,
    scene_context: scene.text,
    signature_hook: `signature hook ${KEYLESS_PLACEHOLDER}`,
    genre_labels: genreLabels(p),
    confidence: {
      tempo_feel: p.tempoFeel !== null ? 'high' : 'low',
      rhythmic_character: rhythmic.confidence,
      instrumentation: 'low',
      vocal_delivery: 'low',
      harmonic_language: harmonic.confidence,
      emotional_register: emotional.confidence,
      production_texture: 'low',
      scene_context: scene.confidence,
      signature_hook: 'low',
    },
    grounded_on: buildGroundedOn(track),
    model: ENGINE_MODEL_ID,
  };

  return markGenreRestatements(fingerprint);
}

/**
 * The two fields the spec says "do the heavy lifting" (`scene_context`, `signature_hook`)
 * are the two most likely to reduce to a bare category label — and a genre restatement
 * asserted at full confidence turns the run into the genre engine this product avoids.
 *
 * `rank.ts` owns the predicate that recognises a bare category label, so it is applied here
 * too: the value is kept (it is still an honest reading and the listener can correct it) but
 * its confidence is forced to `low` and the demotion is written into `grounded_on`.
 */
export function markGenreRestatements(fingerprint: Fingerprint): Fingerprint {
  const fields = ['scene_context', 'signature_hook'] as const;
  const offenders = fields.filter((field) => isGenreOnlyTrait(fingerprint[field]));
  if (offenders.length === 0) return fingerprint;
  const next: Fingerprint = {
    ...fingerprint,
    confidence: { ...fingerprint.confidence },
    grounded_on: [...fingerprint.grounded_on],
  };
  for (const field of offenders) {
    next.confidence[field] = 'low' satisfies Confidence;
    next.grounded_on.push(
      `${field} read as a genre label ("${fingerprint[field]}") — confidence forced to low`,
    );
  }
  return next;
}

/* ------------------------------------------------------------------------------------ *
 * Cache access — a database problem degrades to a fresh assembly, never to a failed run
 * ------------------------------------------------------------------------------------ */

function readCache(key: fingerprintsRepo.FingerprintKey): Fingerprint | null {
  try {
    return fingerprintsRepo.get(key);
  } catch (err) {
    console.warn('[fingerprint] cache read failed', err);
    return null;
  }
}

function writeCache(key: fingerprintsRepo.FingerprintKey, fingerprint: Fingerprint): void {
  try {
    fingerprintsRepo.set(key, fingerprint);
  } catch (err) {
    console.warn('[fingerprint] cache write failed', err);
  }
}
