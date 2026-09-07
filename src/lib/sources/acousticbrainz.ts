/**
 * AcousticBrainz — Essentia features keyed by MusicBrainz MBID. No key, 100 req/10 s.
 *
 * The dataset was frozen in 2022: nothing released after ~2021 is in it, and what IS in
 * it will never change (hence a 90-day TTL that could honestly be forever). A 404 is the
 * normal answer for a modern track, so it comes back as `not_in_dataset` — the resolver
 * records that in `degraded` rather than treating it as a failure.
 *
 * Field paths are the ones the probe read off real bodies (docs/api-reality.md §3.3):
 *   low-level : rhythm.bpm, rhythm.danceability, tonal.key_key, tonal.key_scale
 *   high-level: highlevel.<classifier>.all.<class> probabilities, .value labels
 *
 * `map_classes=true` is deliberately NOT used: it renames the `all` keys ("Not happy"),
 * which would break the probability lookups. Genre abbreviations are mapped locally.
 */

import { z } from 'zod';

import { fetchExternal } from '@/lib/http/fetchExternal';
import {
  TTL,
  fail,
  failureFromHttp,
  ok,
  parseBody,
  type SourceDescription,
  type SourceResult,
} from '@/lib/sources/common';

const BASE = 'https://acousticbrainz.org/api/v1';

export interface AcousticLowLevel {
  bpm: number | null;
  key: string | null;
  scale: string | null;
  /** Essentia's rhythm.danceability scalar, roughly 0-3. */
  danceabilityScalar: number | null;
  averageLoudness: number | null;
}

export interface AcousticHighLevel {
  /** Probability 0-1 that the classifier called the track danceable. */
  danceability: number | null;
  moods: {
    happy: number | null;
    sad: number | null;
    aggressive: number | null;
    relaxed: number | null;
  };
  genreLabels: string[];
}

/** What the resolver stores: the union of both endpoints. */
export interface AcousticFeatures extends AcousticHighLevel, AcousticLowLevel {
  mbid: string;
  /** `"F major"`, assembled from tonal.key_key + tonal.key_scale. */
  keySignature: string | null;
}

const LowLevelSchema = z
  .object({
    rhythm: z
      .object({ bpm: z.number().optional(), danceability: z.number().optional() })
      .loose()
      .optional(),
    tonal: z
      .object({ key_key: z.string().optional(), key_scale: z.string().optional() })
      .loose()
      .optional(),
    lowlevel: z.object({ average_loudness: z.number().optional() }).loose().optional(),
  })
  .loose();

const ClassifierSchema = z
  .object({
    value: z.string().optional(),
    probability: z.number().optional(),
    all: z.record(z.string(), z.number()).optional(),
  })
  .loose();

const HighLevelSchema = z
  .object({
    highlevel: z
      .object({
        danceability: ClassifierSchema.optional(),
        mood_happy: ClassifierSchema.optional(),
        mood_sad: ClassifierSchema.optional(),
        mood_aggressive: ClassifierSchema.optional(),
        mood_relaxed: ClassifierSchema.optional(),
        genre_dortmund: ClassifierSchema.optional(),
        genre_rosamerica: ClassifierSchema.optional(),
        genre_tzanetakis: ClassifierSchema.optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

/** The abbreviations `genre_rosamerica` and `genre_tzanetakis` return. */
const GENRE_LABELS: Record<string, string> = {
  cla: 'classical', dan: 'dance', hip: 'hip hop', jaz: 'jazz', pop: 'pop',
  rhy: 'rhythm and blues', roc: 'rock', spe: 'speech', blu: 'blues', cou: 'country',
  dis: 'disco', met: 'metal', reg: 'reggae',
  alternative: 'alternative', blues: 'blues', electronic: 'electronic',
  folkcountry: 'folk country', funksoulrnb: 'funk soul rnb', jazz: 'jazz',
  raphiphop: 'rap hip hop', rock: 'rock',
};

function isMbid(mbid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbid);
}

/** A 404 here is "we have no submission for this recording", not an error. */
function notInDataset<T>(reason: string): SourceResult<T> {
  return fail<T>('not_in_dataset', reason);
}

export async function getLowLevel(mbid: string): Promise<SourceResult<AcousticLowLevel>> {
  if (!isMbid(mbid)) return fail('invalid_request', `bad MBID ${mbid}`);

  const res = await fetchExternal({ url: `${BASE}/${mbid}/low-level`, ttlMs: TTL.acousticbrainz });
  if (!res.ok) {
    if (res.status === 404) return notInDataset(`no AcousticBrainz low-level data for ${mbid}`);
    return failureFromHttp(res);
  }

  const parsed = parseBody(res, LowLevelSchema);
  if (!parsed.ok) return parsed;

  const v = parsed.value;
  return ok(
    {
      bpm: typeof v.rhythm?.bpm === 'number' && v.rhythm.bpm > 0 ? v.rhythm.bpm : null,
      key: v.tonal?.key_key ?? null,
      scale: v.tonal?.key_scale ?? null,
      danceabilityScalar: v.rhythm?.danceability ?? null,
      averageLoudness: v.lowlevel?.average_loudness ?? null,
    },
    { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt },
  );
}

export async function getHighLevel(mbid: string): Promise<SourceResult<AcousticHighLevel>> {
  if (!isMbid(mbid)) return fail('invalid_request', `bad MBID ${mbid}`);

  const res = await fetchExternal({ url: `${BASE}/${mbid}/high-level`, ttlMs: TTL.acousticbrainz });
  if (!res.ok) {
    if (res.status === 404) return notInDataset(`no AcousticBrainz high-level data for ${mbid}`);
    return failureFromHttp(res);
  }

  const parsed = parseBody(res, HighLevelSchema);
  if (!parsed.ok) return parsed;

  const hl = parsed.value.highlevel;
  const prob = (c: z.infer<typeof ClassifierSchema> | undefined, key: string): number | null => {
    const p = c?.all?.[key];
    return typeof p === 'number' ? p : null;
  };

  // `genre_dortmund` is deliberately absent: api-reality.md §3.3 measured it returning
  // `electronic` for ALL 11 high-level hits on the sample (Talking Heads, Sade and the
  // Squirrel Nut Zippers included). A label that is constant across the sample carries no
  // information, and rule 5's genre bucket would be computed from it.
  const genreLabels = [hl?.genre_rosamerica?.value, hl?.genre_tzanetakis?.value]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => GENRE_LABELS[v] ?? v)
    .filter((v, i, all) => all.indexOf(v) === i);

  return ok(
    {
      danceability: prob(hl?.danceability, 'danceable'),
      moods: {
        happy: prob(hl?.mood_happy, 'happy'),
        sad: prob(hl?.mood_sad, 'sad'),
        aggressive: prob(hl?.mood_aggressive, 'aggressive'),
        relaxed: prob(hl?.mood_relaxed, 'relaxed'),
      },
      genreLabels,
    },
    { fromCache: parsed.fromCache, fetchedAt: parsed.fetchedAt },
  );
}

/**
 * Both endpoints for one MBID. They are independent, and the AcousticBrainz limiter is
 * 5 req/s, so they run concurrently. Succeeds if EITHER answers; the failure of one is
 * simply missing fields, which the resolver reports in `degraded`.
 */
export async function getFeatures(mbid: string): Promise<SourceResult<AcousticFeatures>> {
  const [low, high] = await Promise.all([getLowLevel(mbid), getHighLevel(mbid)]);
  if (!low.ok && !high.ok) return low.ok ? high : low;

  const l: AcousticLowLevel = low.ok
    ? low.value
    : { bpm: null, key: null, scale: null, danceabilityScalar: null, averageLoudness: null };
  const h: AcousticHighLevel = high.ok
    ? high.value
    : { danceability: null, moods: { happy: null, sad: null, aggressive: null, relaxed: null }, genreLabels: [] };

  return ok(
    {
      mbid,
      ...l,
      ...h,
      keySignature: l.key ? `${l.key}${l.scale ? ` ${l.scale}` : ''}` : null,
    },
    {
      fromCache: (low.ok ? low.fromCache : true) && (high.ok ? high.fromCache : true),
      fetchedAt: Date.now(),
    },
  );
}

export function describe(): SourceDescription {
  return { name: 'acousticbrainz', needsKey: false, configured: true };
}
