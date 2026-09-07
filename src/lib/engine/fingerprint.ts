/**
 * Stage 2 — the fingerprint.
 *
 * One model call turns the hard data the resolver collected into an interpretation of
 * what the track actually IS: how it moves, how it sounds, what the artist is doing, and
 * the one thing about it a listener would remember. Everything downstream — the three
 * candidate channels, the scoring pass, the `why` the user reads — hangs off this object,
 * so it is the one place in the engine where being vague is fatal.
 *
 * The division of labour is the spec's governing rule, enforced here by the schema rather
 * than by hope:
 *
 *   - The model NEVER emits a BPM, a release year, a model id, or the provenance list.
 *     Those four fields are cut out of the schema it is given and filled in by code from
 *     the `TrackRecord`. A tempo the model invented cannot reach the UI because there is
 *     nowhere for it to be written down: if the transport returns `tempo_bpm: 999`, zod
 *     strips it and the record's measured value wins. That is a tested guarantee.
 *   - The model DOES emit every judgement: the groove, the voice, the joke, the hook,
 *     and a per-field confidence in its own reading.
 *
 * Cached in the `fingerprints` table by (track key, model, prompt version + corrections
 * hash), so editing the prompt below or disagreeing with a field produces a fresh
 * interpretation instead of silently reusing the old one.
 */

import 'server-only';

import { z } from 'zod';

import * as fingerprintsRepo from '@/lib/db/repos/fingerprints';
import { MODEL, callStructured, type ModelUsage } from '@/lib/engine/model';
import { isGenreOnlyTrait } from '@/lib/engine/rank';
import {
  ConfidenceSchema,
  TempoFeelSchema,
  type Confidence,
  type Fingerprint,
  type FingerprintField,
  type RunOptions,
  type SourceName,
  type TrackRecord,
} from '@/lib/types';
import { stableHash } from '@/lib/util/ids';

/* ------------------------------------------------------------------------------------ *
 * Prompt version
 * ------------------------------------------------------------------------------------ */

/**
 * Part of the fingerprint cache key AND of the run cache key. Bump it on ANY edit to
 * `FINGERPRINT_SYSTEM_PROMPT`, to the schema below, or to the user-message layout —
 * every one of those changes what the model would answer.
 */
export const FINGERPRINT_PROMPT_VERSION = 'fp-v2';

/* ------------------------------------------------------------------------------------ *
 * The schema the model sees
 *
 * `Fingerprint` MINUS `tempo_bpm`, `era`, `model` and `grounded_on`. The `.describe()`
 * strings are not documentation — they are the part of the prompt that travels with the
 * field, and they carry the spec's intent for each one.
 * ------------------------------------------------------------------------------------ */

export const FingerprintModelSchema = z.object({
  tempo_feel: TempoFeelSchema.describe(
    'How the tempo feels in the body, not what a metronome says. The engine fills the ' +
      'BPM in from its own measurements; this is the felt motion of the track.',
  ),
  rhythmic_character: z
    .string()
    .describe(
      'The groove, concretely. Name the subdivision and whether it swings, and say what ' +
        'the bass and the drums are each actually doing — e.g. "swung shuffle, upright ' +
        'bass walking in quarters, brushed snare on 2 and 4" or "programmed four-on-the-' +
        'floor kick under a dry syncopated clap, bass locked to the kick". A sentence ' +
        'that does not mention the bass or the drums is not an answer.',
    ),
  instrumentation: z
    .array(z.string())
    .describe(
      'The concrete instruments and sounds you can point at, most characteristic first: ' +
        '"upright bass", "brushed kit", "clean chorused guitar", "DX7 electric piano", ' +
        '"handclaps", "sampled string stab". Things, not adjectives. 3-8 entries.',
    ),
  vocal_delivery: z
    .string()
    .describe(
      'What the voice physically does AND the attitude it does it with — e.g. "playful, ' +
        'affected, breaks into scat and animal noises", "flat deadpan speak-singing that ' +
        'never resolves the line". If the track has no vocal, say "instrumental" and why ' +
        'that matters here.',
    ),
  harmonic_language: z
    .string()
    .describe(
      'The chords and how they move — e.g. "minor-key jazz voicings over a chromatic ' +
        'descending bassline", "two-chord modal vamp that never cadences". Describe the ' +
        'motion; never name a key signature, which is a measurement the engine takes.',
    ),
  emotional_register: z
    .string()
    .describe(
      'The emotional stance the record takes, in words specific enough to be wrong — ' +
        '"arch, flirtatious, faintly sinister", "exhausted tenderness played completely ' +
        'straight". Not "happy", "sad", "energetic" or "moody".',
    ),
  production_texture: z
    .string()
    .describe(
      'How the recording sounds as a physical object: the room, the density, the era of ' +
        'the gear, what is drenched and what is bone dry — e.g. "roomy analogue, live-' +
        'feeling, minimal reverb on the vocal". Describe the sound; the engine already ' +
        'knows the year.',
    ),
  scene_context: z
    .string()
    .describe(
      'What the artist is doing and why it is notable — the pastiche, the joke, the ' +
        'move — and name the scene it is being made from or against. "Post-punk band ' +
        'deliberately playing lounge jazz" is the shape. This field and signature_hook ' +
        'are what let the engine match on the joke a song is making rather than on its ' +
        'genre, so a bare genre description here wastes the call.',
    ),
  signature_hook: z
    .string()
    .describe(
      'The one weird memorable thing. The meowing. The whistle. The key change into the ' +
        'last chorus. The bar of silence. Name the thing itself, not the feeling it ' +
        'produces. If the track genuinely has no single such moment, say what a listener ' +
        'would hum back instead, and mark this field low confidence.',
    ),
  genre_labels: z
    .array(z.string())
    .describe(
      '2-5 short conventional labels you would actually file this under. Bookkeeping ' +
        'only: the engine uses them to spread the results across scenes and to CUT ' +
        'matches whose only connection is a shared label. They are never a reason two ' +
        'songs belong together, so put your real observations in the other fields.',
    ),
  confidence: z
    .object({
      tempo_feel: ConfidenceSchema,
      rhythmic_character: ConfidenceSchema,
      instrumentation: ConfidenceSchema,
      vocal_delivery: ConfidenceSchema,
      harmonic_language: ConfidenceSchema,
      emotional_register: ConfidenceSchema,
      production_texture: ConfidenceSchema,
      scene_context: ConfidenceSchema,
      signature_hook: ConfidenceSchema,
    })
    .describe(
      'Your confidence in each field, about THIS recording: high when you can hear the ' +
        'detail in your head, medium for a reading the data supports, low for a guess ' +
        'you would not defend. Low confidence is a useful answer; a confident invention ' +
        'is the worst outcome available to you.',
    ),
});

export type FingerprintModelOutput = z.infer<typeof FingerprintModelSchema>;

/* Drift guard: the model schema plus the four code-filled fields must be exactly
 * `Fingerprint`. Adding a field to `types.ts` without deciding who fills it fails
 * `npm run typecheck` here rather than at runtime. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
/** The four fields code owns; the model never sees them. */
export type CodeFilledFingerprintField = 'tempo_bpm' | 'era' | 'model' | 'grounded_on';
export type _FingerprintModelNoDrift = Assert<
  Equals<FingerprintModelOutput, Omit<Fingerprint, CodeFilledFingerprintField>>
>;

/* ------------------------------------------------------------------------------------ *
 * The frozen system prompt
 * ------------------------------------------------------------------------------------ */

/**
 * ONE frozen, cacheable string. Nothing volatile is ever interpolated into it — the seed
 * data and the listener's corrections go in the user message, which is what keeps the
 * prompt cache warm across every run of the app.
 */
export const FINGERPRINT_SYSTEM_PROMPT = `You are the interpretation stage of It Stings, an engine that answers one question: someone loves a specific song, what else sounds like THAT.

You are given the hard data a catalogue API layer collected about one track. Your job is to say what the track actually is — how it moves, how it sounds, what the artist is doing, and the one thing about it a listener would still remember a week later.

Specificity is the entire value of this output. Downstream stages use your fingerprint to find tracks that share this feeling across genres, decades and scenes, and to explain the match in one sentence. A description that would fit any record in the genre poisons every stage after it. "Upbeat 80s alternative rock with catchy vocals" is a failed fingerprint. "Swung shuffle, upright bass walking in quarters under brushed kit, vocal that keeps dissolving into scat" is the job.

You will often know this recording. When you do, describe what you actually hear in it — that take, that arrangement, that performance — and use the data block to check yourself rather than as your only source. The rules below are about measurements and names, not about your ear: a reading that only restates the crowd tags is the failure mode, not the safe answer.

Grounding rules:
- Never name the artist, its members, the producer, the album or the song title in any field. A later stage reads this description with the record's identity deliberately withheld, so that it can name music from anywhere rather than more of the same act; a name anywhere in your text destroys that stage. Say "the singer", "the band", not who they are.
- Each line of the data block is marked MEASURED, CROWD or ABSENT. A measured value is a fact: interpret it, never contradict it. ABSENT means nobody knows — do not supply it, do not estimate it, do not reason as though you knew it.
- You never report a tempo in BPM, a release year, or a key signature. Those are measurements; the engine fills them in from its own sources and will overwrite anything you say about them. Report how the tempo feels instead.
- CROWD tags are listener opinion, not measurement. They are good evidence of how people hear the track and are often lazy or plain wrong. Weigh them; never just restate them.
- If you do not know this specific recording, interpret what the data supports and mark the shakiest fields low confidence. An honest low-confidence reading is useful. An invented detail asserted confidently is the worst thing you can return.

Two fields do most of the work and deserve most of your attention: signature_hook (the one weird memorable thing) and scene_context (what the artist is doing and why it is notable). They are what let the engine match on the joke a song is making rather than on its genre label.

The user message may end with a LISTENER CORRECTIONS block. That is the person who knows this song telling the engine that a previous reading was wrong. Treat it as ground truth about how they hear the record: re-interpret the named field from scratch rather than rephrasing the rejected version, and let the correction inform the neighbouring fields wherever it plainly should.`;

/* ------------------------------------------------------------------------------------ *
 * The user message
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

const ABSENT = 'ABSENT';

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

/** How many crowd tags reach the prompt. Past ~15 they are noise and cost tokens. */
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

/** Sorted by field name so the same corrections always hash and prompt identically. */
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
 * The volatile half of the call: the hard data as a labelled block, then the listener's
 * corrections if there are any.
 *
 * Exported because the tests assert on the exact text the transport receives — the
 * measured/absent labelling is a product requirement ("Never fabricate"), not a detail.
 */
export function buildFingerprintUserMessage(
  track: TrackRecord,
  corrections: NormalisedCorrection[] = [],
  previous?: Fingerprint | null,
): string {
  const lines: string[] = [];
  const add = (label: string, value: string) => lines.push(`${label}: ${value}`);

  add('title', track.title);
  add('artist', track.artist);
  add('album', track.album ?? ABSENT);
  add(
    'year',
    track.year ? `${track.year.value}  [MEASURED — ${stamp(track.year.source)}]` : ABSENT,
  );
  add(
    'duration',
    track.durationMs
      ? `${formatDuration(track.durationMs.value)}  [MEASURED — ${stamp(track.durationMs.source)}]`
      : ABSENT,
  );
  add(
    'tempo',
    track.tempoBpm
      ? `${track.tempoBpm.value} BPM  [MEASURED — ${stamp(track.tempoBpm.source)}]`
      : `${ABSENT} (no source has a usable BPM for this recording — do not guess one)`,
  );
  add(
    'key',
    track.keySignature
      ? `${track.keySignature.value}  [MEASURED — ${stamp(track.keySignature.source)}]`
      : ABSENT,
  );

  const features = featureSummary(track.features);
  add(
    'audio features',
    features && track.features
      ? `${features}  [MEASURED — ${stamp(track.features.source)}]`
      : `${ABSENT} (none)`,
  );

  const mb = musicbrainzTags(track);
  add(
    'musicbrainz tags/genres',
    mb ? `${mb.map((t) => t.name).join(', ')}  [CROWD — MusicBrainz]` : `${ABSENT} (none)`,
  );

  const lfm = lastfmTags(track);
  add(
    'lastfm top tags',
    lfm
      ? `${lfm
          .slice(0, MAX_TAGS_IN_PROMPT)
          .map((t) => `${t.name} (${t.count})`)
          .join(', ')}  [CROWD — Last.fm track.getTopTags, count is relative listener weight]`
      : `${ABSENT} (not available)`,
  );

  const blocks = [
    '=== SEED TRACK — hard data ===',
    'Every line below is MEASURED (a fact with its source), CROWD (listener opinion) or',
    'ABSENT (nobody knows — do not fill it in).',
    '',
    ...lines,
    '=== end of hard data ===',
  ];

  if (corrections.length > 0) {
    blocks.push('', '=== LISTENER CORRECTIONS ===');
    blocks.push(
      'The person who knows this song reviewed a previous fingerprint of it and disagreed.',
      '',
    );
    for (const c of corrections) {
      const prior = previous ? previousValueText(previous, c.field) : null;
      if (c.kind === 'reject') {
        blocks.push(
          prior
            ? `- ${c.field}: REJECTED. The previous reading was "${prior}". The listener says ` +
              `that is wrong. Re-interpret this field from the data; do not restate the ` +
              `rejected reading in other words.`
            : `- ${c.field}: REJECTED. The listener says the previous reading of this field was ` +
              `wrong. Re-interpret it from the data.`,
        );
      } else {
        blocks.push(
          `- ${c.field}: the listener's own words are "${c.value}". That is correct and the ` +
            `engine will use it verbatim; take it as given and let it inform the fields ` +
            `around it.`,
        );
      }
    }
    blocks.push('=== end of listener corrections ===');
  }

  blocks.push('', 'Fingerprint the track above.');
  return blocks.join('\n');
}

/** A previous fingerprint value rendered for the "you said X, they say no" line. */
function previousValueText(previous: Fingerprint, field: FingerprintField): string | null {
  const value = previous[field];
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/* ------------------------------------------------------------------------------------ *
 * Cache key
 * ------------------------------------------------------------------------------------ */

/**
 * The `prompt_version` column value: the frozen prompt version, plus a hash of the
 * listener's corrections when there are any. Two different corrections are two different
 * interpretations of the same track and must not share a cache row.
 */
export function fingerprintPromptKey(corrections?: RunOptions['corrections']): string {
  const normalised = normaliseCorrections(corrections);
  if (normalised.length === 0) return FINGERPRINT_PROMPT_VERSION;
  const payload = normalised.map((c) => [c.field, c.kind, c.value]);
  return `${FINGERPRINT_PROMPT_VERSION}+c${stableHash(payload).slice(0, 12)}`;
}

/* ------------------------------------------------------------------------------------ *
 * Grounding
 * ------------------------------------------------------------------------------------ */

/**
 * `grounded_on`: the human-readable trail the UI prints under the fingerprint. Absent
 * measurements are listed AS absent — "tempo: unknown" is information the listener needs
 * in order to judge the reading, and it is what stops "132 BPM" ever appearing without a
 * source behind it.
 *
 * Deliberately carries no title, artist or album: Channel C is handed the fingerprint
 * with the seed's identity withheld and strips identity-bearing lines from this list, and
 * the cheapest way to survive that is not to write them here.
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
 * Overwrites the model's value with the listener's for every `replace` correction, sets
 * that field's confidence to `high` (the listener is the authority on their own hearing)
 * and records it in `grounded_on`.
 *
 * `tempo_feel` is the one field a free-text correction cannot always land in: it is a
 * closed enum, so a value outside it is left to the model, which was told about the
 * correction in the user message anyway. Everything else is taken verbatim.
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
      if (!parsed.success) continue; // not one of the six; the model kept its reading
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
  /** The run's accumulator, so this call lands in `stats.modelCalls` and the token counts. */
  usage?: ModelUsage;
  /**
   * The fingerprint the listener was looking at when they rejected a field, so the prompt
   * can quote the rejected reading back. Optional: without it the correction still says
   * the field was rejected, it just cannot name what was rejected.
   */
  previous?: Fingerprint | null;
  signal?: AbortSignal;
}

export type FingerprintResult =
  | { ok: true; fingerprint: Fingerprint; cached: boolean }
  | { ok: false; reason: string };

/**
 * Stage 2. Returns the seed's fingerprint, from cache when one exists for this exact
 * (track, model, prompt + corrections) triple, otherwise from one `high`-effort model
 * call. Never throws: a refusal, a bad parse, a missing key or an abort all come back as
 * `{ ok: false, reason }` and the pipeline degrades on them.
 */
export async function fingerprintTrack(
  track: TrackRecord,
  opts: FingerprintOptions = {},
): Promise<FingerprintResult> {
  const corrections = normaliseCorrections(opts.corrections);
  const promptVersion = fingerprintPromptKey(opts.corrections);
  const cacheKey = { trackKey: track.key, model: MODEL, promptVersion };

  if (!opts.force) {
    const cached = readCache(cacheKey);
    if (cached) return { ok: true, fingerprint: cached, cached: true };
  }

  const previous = opts.previous ?? (corrections.length > 0 ? readBaseFingerprint(track) : null);

  const res = await callStructured({
    name: 'fingerprint',
    schema: FingerprintModelSchema,
    system: FINGERPRINT_SYSTEM_PROMPT,
    user: buildFingerprintUserMessage(track, corrections, previous),
    effort: 'high',
    usage: opts.usage,
    signal: opts.signal,
  });

  if (!res.ok) return { ok: false, reason: res.reason };

  const fingerprint = applyCorrections(assemble(track, res.value), corrections);
  writeCache(cacheKey, fingerprint);
  return { ok: true, fingerprint, cached: false };
}

/** `genre_labels` is described as 2-5; a longer list is trimmed rather than rejected. */
const MAX_GENRE_LABELS = 5;

/**
 * The model's judgements plus the four fields code owns. `tempo_bpm` and `era` are COPIED
 * from the record — this is the line the "never fabricate" rule lives on.
 */
function assemble(track: TrackRecord, judged: FingerprintModelOutput): Fingerprint {
  const fingerprint: Fingerprint = {
    ...judged,
    instrumentation: dedupeStrings(judged.instrumentation),
    genre_labels: dedupeStrings(judged.genre_labels).slice(0, MAX_GENRE_LABELS),
    tempo_bpm: track.tempoBpm?.value ?? null,
    era: track.year?.value ?? null,
    grounded_on: buildGroundedOn(track),
    model: MODEL,
  };
  return markGenreRestatements(fingerprint);
}

/**
 * The two fields the spec says "do the heavy lifting" are the two a tired model is most
 * likely to answer with a genre name — and "new wave" as a signature_hook turns the whole
 * run into the genre engine this product exists to avoid, silently and at full confidence.
 *
 * `rank.ts` already owns the predicate that recognises a bare category label, so it is
 * applied here too: no new model call, no schema change. The value is kept (it is still
 * the model's answer and the listener can correct it) but its confidence is forced to
 * `low` and the demotion is written into `grounded_on`, which the UI already prints and
 * `channelCPayload` already drops.
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

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value.length === 0) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/* ------------------------------------------------------------------------------------ *
 * Cache access — a database problem degrades to a live call, never to a failed run
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

/** The uncorrected fingerprint of this track — what the listener was looking at. */
function readBaseFingerprint(track: TrackRecord): Fingerprint | null {
  return readCache({
    trackKey: track.key,
    model: MODEL,
    promptVersion: FINGERPRINT_PROMPT_VERSION,
  });
}
