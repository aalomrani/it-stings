/**
 * It Stings — ALL shared types.
 *
 * The interfaces and type aliases below are copied VERBATIM from `docs/architecture.md`
 * ("Shared types"). Nothing else in the codebase defines these. Do not rename, do not
 * add fields here without changing architecture.md first and saying so in your report.
 *
 * Alongside each of the five boundary types the architecture calls out
 * (PipelineEvent, RunOptions, Fingerprint, Recommendation, TrackRecord) this file exports
 * a zod schema that MIRRORS the type, plus a compile-time `Equals<>` assertion so drift
 * between the type and its schema fails `npm run typecheck`.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------------------------ *
 * Shared types — verbatim from docs/architecture.md
 * ------------------------------------------------------------------------------------ */

export type SourceName =
  | 'itunes' | 'deezer' | 'musicbrainz' | 'acousticbrainz' | 'lastfm'
  | 'spotify' | 'getsongbpm' | 'web' | 'model' | 'user';

export interface SourceRef { source: SourceName; id?: string; url?: string; field?: string }
export interface Sourced<T> { value: T; source: SourceRef }

export interface TrackRecord {
  key: string;                 // `isrc:<ISRC>` when Deezer gave us one, else `deezer:<id>`, else `itunes:<id>` (iTunes never returns ISRC — verified)
  isrc: string | null;
  title: string;
  artist: string;
  album: string | null;
  year: Sourced<number> | null;
  durationMs: Sourced<number> | null;
  artwork: { small: string; large: string; source: SourceRef } | null;
  preview: { url: string; source: SourceRef; expiresAt: number | null } | null;   // best available preview; Deezer URLs are HMAC-signed and expire 15 min after minting — never persist them (see "Preview audio")
  tempoBpm: Sourced<number> | null;                     // first non-zero of deezer -> getsongbpm -> acousticbrainz
  keySignature: Sourced<string> | null;                 // e.g. "F# minor", from acousticbrainz/getsongbpm only
  links: { itunes?: string; deezer?: string; spotify?: string; musicbrainz?: string; lastfm?: string };
  ids: { itunes?: number; deezer?: number; spotify?: string; mbid?: string };
  tags: Sourced<{ name: string; count: number }[]> | null;   // Last.fm top tags
  features: { source: SourceRef; danceability?: number; moodHappy?: number; moodAggressive?: number;
              moodRelaxed?: number; moodSad?: number; genreLabels?: string[] } | null;  // AcousticBrainz high-level
  resolvedAt: number;          // epoch ms
  degraded: string[];          // sources that failed/skipped during resolve, human-readable
}

export type TempoFeel = 'dragging' | 'relaxed' | 'walking' | 'bouncing' | 'driving' | 'frantic';
export type Confidence = 'low' | 'medium' | 'high';

export interface Fingerprint {
  tempo_bpm: number | null;            // copied from TrackRecord.tempoBpm, never model-invented
  tempo_feel: TempoFeel;
  rhythmic_character: string;
  instrumentation: string[];
  vocal_delivery: string;
  harmonic_language: string;
  emotional_register: string;
  production_texture: string;
  era: number | null;                  // copied from TrackRecord.year, never model-invented
  scene_context: string;
  signature_hook: string;
  genre_labels: string[];              // model's own labels, used only for spread + "genre-only" cut
  confidence: Record<
    'tempo_feel' | 'rhythmic_character' | 'instrumentation' | 'vocal_delivery' | 'harmonic_language'
    | 'emotional_register' | 'production_texture' | 'scene_context' | 'signature_hook', Confidence>;
  grounded_on: string[];               // human-readable list of hard data used ("Deezer bpm 132", "Last.fm tags: ...")
  model: string;                       // model id that produced it
}

export type Channel = 'A' | 'B' | 'C';

export interface Candidate {                 // pre-verification
  artist: string;
  title: string;
  channels: Channel[];
  hints: { lastfmMatch?: number; tag?: string; sourceUrl?: string; sentence?: string; enthusiasm?: 'high' | 'medium' | 'low'; modelNote?: string }[];
}

export interface Evidence {
  channel: Channel;
  kind: 'lastfm_similar' | 'lastfm_tag' | 'forum' | 'model_prior';
  fetchedAt?: number;          // epoch ms the underlying search result / Last.fm answer was fetched; the UI stamps "cached <date>" from it
  live?: boolean;              // this row was fetched in THIS run, not read out of a cache
  url?: string;                // forum thread / lastfm page
  title?: string;              // page title
  sentence?: string;           // the surrounding sentence for forum mentions
  enthusiasm?: 'high' | 'medium' | 'low';
  detail?: string;             // e.g. "Last.fm match 0.42", "tag: swing revival"
}

export interface DimensionScore { dimension: keyof Fingerprint['confidence'] | 'era'; score: number; note: string } // score 0-1; the model returns all nine, always

export interface Recommendation {
  track: TrackRecord;
  channels: Channel[];
  evidence: Evidence[];
  dimensions: DimensionScore[];
  modelScore: number;          // 0-1, weighted mean of `dimensions` (weights in rank.ts), computed in code
  finalScore: number;          // after code-enforced rules (bonuses/penalties), what we sort by
  why: string;                 // ONE sentence naming the specific shared trait
  whyDiscriminates?: string;   // the model's own counter-example: a record in the candidate's genre the `why` is FALSE of. Empty/evasive => the `why` is generic
  sharedTraits: string[];      // 2-5 concrete traits behind `why`; rank.ts cuts a candidate whose traits are all genre labels
  sameArtist: boolean;
  flags: string[];             // e.g. 'multi-channel', 'genre-only-cut', 'same-artist-high-bar'
}

export type FingerprintField = keyof Fingerprint['confidence'];
export interface RunOptions {
  includeSameArtist: boolean;
  corrections?: Partial<Record<FingerprintField, 'wrong' | string>>;   // user disagreed with the fingerprint: 'wrong' = re-interpret this field; a string = use this instead
}

export interface RunStats {
  perChannel: Record<Channel, { found: number; verified: number; dropped: number; skipped?: string }>;
  durationMs: number;
  modelCalls: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheCreation: number };  // this run's model spend
  cut?: { key: string; artist: string; title: string; reason: string }[];                // what rank.ts removed, and why
  channelCRetry?: { firstDropRate: number; retryDropRate: number | null; added: number }; // Stage 4's ~20% guard on Channel C
  channelCSpread?: { decades: string[]; genres: string[]; entries: number; dated: number; topDecadeShare: number; ok: boolean }; // spec: C spans >=3 decades and >=3 genre families — MEASURED from the years it returned, not from what it claimed
}

export interface RunRecord {
  id: string;
  seed: TrackRecord;
  options: RunOptions;
  fingerprint: Fingerprint | null;
  results: Recommendation[];
  degraded: string[];          // e.g. "Channel B skipped: no TAVILY_API_KEY"
  stats: RunStats;
  engineVersion: string;       // bump when ranking logic changes; part of the run cache key
  createdAt: number;
}

export type PipelineStage = 'resolve' | 'fingerprint' | 'channels' | 'verify' | 'score' | 'rank' | 'done';

export type PipelineEvent =
  | { type: 'run'; runId: string; cached: boolean }
  | { type: 'stage'; stage: PipelineStage; status: 'start' | 'done' | 'error'; message?: string }
  | { type: 'seed'; track: TrackRecord }
  | { type: 'fingerprint'; fingerprint: Fingerprint }
  | { type: 'channel'; channel: Channel; status: 'start' | 'done' | 'skipped' | 'error'; found?: number; reason?: string }
  | { type: 'verified'; channel: Channel; kept: number; dropped: number }
  | { type: 'result'; item: Recommendation; provisional: true }    // streamed as batches are scored
  | { type: 'final'; results: Recommendation[]; degraded: string[]; stats: RunRecord['stats'] }
  | { type: 'error'; message: string };

/* ------------------------------------------------------------------------------------ *
 * Zod schemas mirroring the types above.
 *
 * These are the runtime boundary: JSON columns in SQLite, model output, SSE payloads.
 * Every schema below is checked against its TypeScript twin by the `Equals<>` assertions
 * at the bottom of the file, so a change to one without the other fails typecheck.
 * ------------------------------------------------------------------------------------ */

export const SourceNameSchema = z.enum([
  'itunes', 'deezer', 'musicbrainz', 'acousticbrainz', 'lastfm',
  'spotify', 'getsongbpm', 'web', 'model', 'user',
]);

export const SourceRefSchema = z.object({
  source: SourceNameSchema,
  id: z.string().optional(),
  url: z.string().optional(),
  field: z.string().optional(),
});

/** `Sourced<T>` is generic, so its schema is a factory. */
export const sourcedSchema = <T extends z.ZodType>(value: T) =>
  z.object({ value, source: SourceRefSchema });

export const TrackRecordSchema = z.object({
  key: z.string(),
  isrc: z.string().nullable(),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable(),
  year: sourcedSchema(z.number()).nullable(),
  durationMs: sourcedSchema(z.number()).nullable(),
  artwork: z.object({ small: z.string(), large: z.string(), source: SourceRefSchema }).nullable(),
  preview: z
    .object({ url: z.string(), source: SourceRefSchema, expiresAt: z.number().nullable() })
    .nullable(),
  tempoBpm: sourcedSchema(z.number()).nullable(),
  keySignature: sourcedSchema(z.string()).nullable(),
  links: z.object({
    itunes: z.string().optional(),
    deezer: z.string().optional(),
    spotify: z.string().optional(),
    musicbrainz: z.string().optional(),
    lastfm: z.string().optional(),
  }),
  ids: z.object({
    itunes: z.number().optional(),
    deezer: z.number().optional(),
    spotify: z.string().optional(),
    mbid: z.string().optional(),
  }),
  tags: sourcedSchema(z.array(z.object({ name: z.string(), count: z.number() }))).nullable(),
  features: z
    .object({
      source: SourceRefSchema,
      danceability: z.number().optional(),
      moodHappy: z.number().optional(),
      moodAggressive: z.number().optional(),
      moodRelaxed: z.number().optional(),
      moodSad: z.number().optional(),
      genreLabels: z.array(z.string()).optional(),
    })
    .nullable(),
  resolvedAt: z.number(),
  degraded: z.array(z.string()),
});

export const TempoFeelSchema = z.enum([
  'dragging', 'relaxed', 'walking', 'bouncing', 'driving', 'frantic',
]);

export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

/** The nine fingerprint dimensions the model must return a confidence for. */
export const FINGERPRINT_CONFIDENCE_KEYS = [
  'tempo_feel', 'rhythmic_character', 'instrumentation', 'vocal_delivery',
  'harmonic_language', 'emotional_register', 'production_texture', 'scene_context',
  'signature_hook',
] as const;

export const FingerprintSchema = z.object({
  tempo_bpm: z.number().nullable(),
  tempo_feel: TempoFeelSchema,
  rhythmic_character: z.string(),
  instrumentation: z.array(z.string()),
  vocal_delivery: z.string(),
  harmonic_language: z.string(),
  emotional_register: z.string(),
  production_texture: z.string(),
  era: z.number().nullable(),
  scene_context: z.string(),
  signature_hook: z.string(),
  genre_labels: z.array(z.string()),
  confidence: z.object({
    tempo_feel: ConfidenceSchema,
    rhythmic_character: ConfidenceSchema,
    instrumentation: ConfidenceSchema,
    vocal_delivery: ConfidenceSchema,
    harmonic_language: ConfidenceSchema,
    emotional_register: ConfidenceSchema,
    production_texture: ConfidenceSchema,
    scene_context: ConfidenceSchema,
    signature_hook: ConfidenceSchema,
  }),
  grounded_on: z.array(z.string()),
  model: z.string(),
});

export const ChannelSchema = z.enum(['A', 'B', 'C']);

export const EnthusiasmSchema = z.enum(['high', 'medium', 'low']);

export const CandidateSchema = z.object({
  artist: z.string(),
  title: z.string(),
  channels: z.array(ChannelSchema),
  hints: z.array(
    z.object({
      lastfmMatch: z.number().optional(),
      tag: z.string().optional(),
      sourceUrl: z.string().optional(),
      sentence: z.string().optional(),
      enthusiasm: EnthusiasmSchema.optional(),
      modelNote: z.string().optional(),
    }),
  ),
});

export const EvidenceSchema = z.object({
  channel: ChannelSchema,
  kind: z.enum(['lastfm_similar', 'lastfm_tag', 'forum', 'model_prior']),
  fetchedAt: z.number().optional(),
  live: z.boolean().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  sentence: z.string().optional(),
  enthusiasm: EnthusiasmSchema.optional(),
  detail: z.string().optional(),
});

export const DimensionScoreSchema = z.object({
  dimension: z.enum([...FINGERPRINT_CONFIDENCE_KEYS, 'era']),
  score: z.number(),
  note: z.string(),
});

export const RecommendationSchema = z.object({
  track: TrackRecordSchema,
  channels: z.array(ChannelSchema),
  evidence: z.array(EvidenceSchema),
  dimensions: z.array(DimensionScoreSchema),
  modelScore: z.number(),
  finalScore: z.number(),
  why: z.string(),
  whyDiscriminates: z.string().optional(),
  sharedTraits: z.array(z.string()),
  sameArtist: z.boolean(),
  flags: z.array(z.string()),
});

export const FingerprintFieldSchema = z.enum(FINGERPRINT_CONFIDENCE_KEYS);

export const RunOptionsSchema = z.object({
  includeSameArtist: z.boolean(),
  corrections: z.partialRecord(FingerprintFieldSchema, z.string()).optional(),
});

export const ChannelStatsSchema = z.object({
  found: z.number(),
  verified: z.number(),
  dropped: z.number(),
  skipped: z.string().optional(),
});

export const RunStatsSchema = z.object({
  perChannel: z.object({ A: ChannelStatsSchema, B: ChannelStatsSchema, C: ChannelStatsSchema }),
  durationMs: z.number(),
  modelCalls: z.number(),
  tokens: z
    .object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number(),
      cacheCreation: z.number(),
    })
    .optional(),
  cut: z
    .array(
      z.object({
        key: z.string(),
        artist: z.string(),
        title: z.string(),
        reason: z.string(),
      }),
    )
    .optional(),
  channelCRetry: z
    .object({
      firstDropRate: z.number(),
      retryDropRate: z.number().nullable(),
      added: z.number(),
    })
    .optional(),
  channelCSpread: z
    .object({
      decades: z.array(z.string()),
      genres: z.array(z.string()),
      entries: z.number(),
      dated: z.number(),
      topDecadeShare: z.number(),
      ok: z.boolean(),
    })
    .optional(),
});

export const RunRecordSchema = z.object({
  id: z.string(),
  seed: TrackRecordSchema,
  options: RunOptionsSchema,
  fingerprint: FingerprintSchema.nullable(),
  results: z.array(RecommendationSchema),
  degraded: z.array(z.string()),
  stats: RunStatsSchema,
  engineVersion: z.string(),
  createdAt: z.number(),
});

export const PipelineStageSchema = z.enum([
  'resolve', 'fingerprint', 'channels', 'verify', 'score', 'rank', 'done',
]);

export const PipelineEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run'), runId: z.string(), cached: z.boolean() }),
  z.object({
    type: z.literal('stage'),
    stage: PipelineStageSchema,
    status: z.enum(['start', 'done', 'error']),
    message: z.string().optional(),
  }),
  z.object({ type: z.literal('seed'), track: TrackRecordSchema }),
  z.object({ type: z.literal('fingerprint'), fingerprint: FingerprintSchema }),
  z.object({
    type: z.literal('channel'),
    channel: ChannelSchema,
    status: z.enum(['start', 'done', 'skipped', 'error']),
    found: z.number().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('verified'),
    channel: ChannelSchema,
    kept: z.number(),
    dropped: z.number(),
  }),
  z.object({
    type: z.literal('result'),
    item: RecommendationSchema,
    provisional: z.literal(true),
  }),
  z.object({
    type: z.literal('final'),
    results: z.array(RecommendationSchema),
    degraded: z.array(z.string()),
    stats: RunStatsSchema,
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

/* ------------------------------------------------------------------------------------ *
 * Drift guards: a schema that stops mirroring its type fails `npm run typecheck`.
 * ------------------------------------------------------------------------------------ */

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

export type _TrackRecordNoDrift = Assert<Equals<z.infer<typeof TrackRecordSchema>, TrackRecord>>;
export type _FingerprintNoDrift = Assert<Equals<z.infer<typeof FingerprintSchema>, Fingerprint>>;
export type _RecommendationNoDrift =
  Assert<Equals<z.infer<typeof RecommendationSchema>, Recommendation>>;
export type _RunOptionsNoDrift = Assert<Equals<z.infer<typeof RunOptionsSchema>, RunOptions>>;
export type _PipelineEventNoDrift =
  Assert<Equals<z.infer<typeof PipelineEventSchema>, PipelineEvent>>;

// Not required by the task contract, but these three ride along for free and catch the
// same class of mistake in the types they nest.
export type _RunRecordNoDrift = Assert<Equals<z.infer<typeof RunRecordSchema>, RunRecord>>;
export type _CandidateNoDrift = Assert<Equals<z.infer<typeof CandidateSchema>, Candidate>>;
export type _EvidenceNoDrift = Assert<Equals<z.infer<typeof EvidenceSchema>, Evidence>>;
