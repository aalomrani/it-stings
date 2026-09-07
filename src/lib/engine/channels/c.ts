/**
 * Channel C — the model prior.
 *
 * The other two channels ask a catalogue ("what do people file next to this record?").
 * This one asks the model to remember music: given ONLY a description of how a track
 * behaves — its groove, its voice, its harmony, its production, the joke it is making —
 * name 25–40 other real records that behave the same way. It is the channel that can
 * cross a genre boundary, because nothing in its input knows what genre the seed is in.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: the seed's title and artist never reach the
 * model. Not in the prompt, not in the fingerprint's free text, not smuggled in a
 * `grounded_on` line like "Last.fm tags: the cure, post-punk". A model that recognises
 * the seed stops describing music and starts listing that artist's neighbours, which is
 * exactly the "other Cure singles" failure the spec names. So the payload is built by
 * `channelCPayload`, which:
 *   - sends the era as a DECADE, never the release year;
 *   - keeps only measurement-shaped `grounded_on` lines (bpm, duration, key, features,
 *     listener corrections) and drops the rest — crowd-tag lines are dropped outright
 *     because Last.fm's tag vocabulary is full of artist names, and the genre content of
 *     those lines is already in `genre_labels`;
 *   - redacts the seed's own name out of every remaining string when the pipeline passes
 *     `seedIdentity` (which is used for scrubbing ONLY and never serialised).
 *
 * Nothing here is verified — every entry is a claim about a record that may not exist.
 * Stage 4 checks all of them against iTunes/Deezer and drops what it cannot find; when
 * that drop rate is bad the pipeline re-runs this channel with `tightness: 'tight'`,
 * which trades recall for entries the model can actually vouch for.
 *
 * This file makes exactly one model call and no HTTP requests of its own.
 */

import { z } from 'zod';

import { REASON, callStructured, isNoApiKey, jsonBlock } from '@/lib/engine/model';
import type { ChannelContext, ChannelResult, ChannelSpread } from '@/lib/engine/channels/types';
import type { Candidate, Confidence, Fingerprint } from '@/lib/types';
import { normArtist, normTitle, trackNormKey } from '@/lib/util/normalize';

/* ------------------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------------------ */

/**
 * Part of the fingerprint/run cache keys upstream: change either system prompt or the
 * output schema and this string changes with it, so nothing replays a stale answer.
 */
export const CHANNEL_C_PROMPT_VERSION = 'ch-c-v2';

/** Hard cap on what this channel hands the pipeline, after dedupe (spec: 25–40). */
export const CHANNEL_C_MAX_CANDIDATES = 40;

/**
 * The Stage-4 drop rate above which the pipeline (Task P) re-runs this channel with
 * `tightness: 'tight'`. Lives here so the guard and the prompt it flips to are one edit
 * apart. spec.md: "if Channel C's drop rate exceeds ~20%, tighten its prompt".
 */
export const CHANNEL_C_TIGHTEN_DROP_RATE = 0.2;

/** `'tight'` asks for fewer, more canonical picks after a bad verification rate. */
export type Tightness = 'normal' | 'tight';

/** docs/spec.md: Channel C's list spans "at least three decades and at least three genre labels". */
export const CHANNEL_C_MIN_DECADES = 3;
/** One decade may hold at most this share of the dated entries before the spread is bad. */
export const CHANNEL_C_MAX_DECADE_SHARE = 0.6;

/* ------------------------------------------------------------------------------------ *
 * The output contract
 * ------------------------------------------------------------------------------------ */

export const ChannelCTrackSchema = z.object({
  artist: z
    .string()
    .describe('The performing artist, spelled as the release credits them.'),
  title: z
    .string()
    .describe(
      'The track title in its most common release spelling — the wording a catalogue ' +
        'search will match. Not a compilation or reissue variant, not a parenthetical ' +
        'you are unsure about.',
    ),
  year: z
    .number()
    .int()
    .nullable()
    .describe(
      'Approximate year of the original release. Null if you do not actually recall it — ' +
        'a wrong year is worse than none. Nothing displays this number: it helps the ' +
        'catalogue lookup and it is what the code checks your decade spread against.',
    ),
  modelNote: z
    .string()
    .describe(
      'ONE clause naming the concrete trait this record shares with the description: an ' +
        'instrument behaviour, a rhythmic figure, a vocal move, a production choice, the ' +
        'joke it is making. A genre name, a decade, "similar vibe", "same energy" or ' +
        'anything that would fit any two records in the same genre is rejected.',
    ),
});

export const ChannelCOutputSchema = z.object({
  decades_covered: z
    .array(z.string())
    .describe(
      'The decades your list spans, e.g. ["1950s", "1980s", "2010s"] — at least three. ' +
        'Fill this in before the track list and then make the list match it.',
    ),
  genre_families: z
    .array(z.string())
    .describe(
      'The distinct genre families your list reaches into — at least three. Spread ' +
        'bookkeeping only; a shared genre is never a reason to recommend something.',
    ),
  tracks: z.array(ChannelCTrackSchema).describe('The recommended tracks.'),
});

export type ChannelCOutput = z.infer<typeof ChannelCOutputSchema>;

/* ------------------------------------------------------------------------------------ *
 * The frozen system prompts
 * ------------------------------------------------------------------------------------ */

const SYSTEM_SHARED_HEAD = `You are given a structured description of one recording: how it moves, how the voice behaves, what it is made of, how it was recorded, and what its scene_context and signature_hook are.

You are NOT told what the recording is. Do not try to identify it, do not name it, and do not reason about who made it. The description is the whole brief.

Name other real, released recordings that share the described qualities.`;

const SYSTEM_SHARED_TAIL = `What a good answer looks like:

- Every entry is checked against a music catalogue (iTunes and Deezer) before anyone sees it. An entry nobody can find there is dropped and wasted. An invented track, a misremembered title, a title you are reconstructing rather than recalling — that is the worst outcome here, worse than a shorter list.
- When you are unsure of exact wording, give the canonical, well-known recording by that artist and the spelling the original release used.
- Match the specifics, not the category. signature_hook and scene_context are the point: the one weird move, the joke the record is making, the thing you would tell someone about. A record that shares only a genre label with the description is a failure of this task, however good it is.
- Spread it deliberately. Span at least three decades and at least three genre families, and record them in decades_covered and genre_families. The same trait turning up in a jump-blues side, an art-pop single and an electro-swing record three decades apart is a better answer than nine records from one scene. (Those are shapes of answer, not a hint about the recording you are reading — nothing here tells you when or where it is from.) Your list is checked against the years you give, so a list that claims three decades and delivers one is worse than an honest narrow answer.
- year is not decoration: give it whenever you actually recall it. It is what the spread check reads.
- modelNote is one clause about the music. "walking upright bass under a deadpan croon", not "similar vibe"; "the vocal collapses into nonsense syllables in the last chorus", not "1980s alternative".
- The description's tempo_bpm, when present, is a measurement of the source recording; era_decade is deliberately a decade, not a year. Do not treat either as a filter — a match two decades away is welcome if the trait is really shared.`;

/** Effort `high`: recall and real-track precision are both load-bearing here. */
export const CHANNEL_C_SYSTEM_NORMAL = `${SYSTEM_SHARED_HEAD}

Return 25 to 40 tracks.

${SYSTEM_SHARED_TAIL}`;

/**
 * The retry prompt. Reached only after Stage 4 failed to find more than
 * `CHANNEL_C_TIGHTEN_DROP_RATE` of the first list in any catalogue, so the trade is
 * explicit: fewer entries, all of them ones the model can actually vouch for.
 */
export const CHANNEL_C_SYSTEM_TIGHT = `${SYSTEM_SHARED_HEAD}

Return 18 to 25 tracks, and be strict about it.

A previous attempt at this list contained too many entries that could not be found in any catalogue. Raise the bar: include only recordings you are confident exist under exactly the artist and title you give — releases with real catalogue presence, the ones a search for that artist returns on the first page. Drop anything whose title you are reconstructing, anything you half-remember from a tracklist, and anything by an artist you cannot place. A short, fully findable list beats a long one that evaporates.

${SYSTEM_SHARED_TAIL}`;

export function channelCSystem(tightness: Tightness): string {
  return tightness === 'tight' ? CHANNEL_C_SYSTEM_TIGHT : CHANNEL_C_SYSTEM_NORMAL;
}

/** The one constant line of the user message; everything else is the fingerprint block. */
export const CHANNEL_C_USER_HEADER =
  'Description of the recording (its identity is deliberately withheld):';

/* ------------------------------------------------------------------------------------ *
 * Building the payload — the anti-leak layer
 * ------------------------------------------------------------------------------------ */

/**
 * The seed's own name. Passed by the pipeline so it can be scrubbed OUT of the
 * fingerprint's free text; it is never written into the request.
 */
export interface SeedIdentity {
  artist?: string;
  title?: string;
  /**
   * The seed's album. Scrubbed for the same reason as the artist: a fingerprint that
   * writes "the Japanese Whispers-era joke" into scene_context hands this call the answer
   * it is being kept from. The fingerprint prompt forbids naming it; this is the net.
   */
  album?: string;
}

/**
 * `grounded_on` lines that survive: measurements and the listener's own corrections.
 *
 * Everything else is dropped rather than filtered word by word. Tag lines ("Last.fm tags:
 * …", "MusicBrainz genres: …") are the specific hazard — crowd tag vocabularies are full
 * of artist names — and their useful content is already in `genre_labels`. Year lines go
 * too: the era is sent as a decade on purpose, and a `grounded_on` line would put the
 * exact year back.
 */
const GROUNDED_ON_KEEP =
  /^(?:deezer\s+bpm|bpm|tempo|getsongbpm|acousticbrainz|duration|key\b|key\s+signature|listener\s+correction)/i;

/** No `grounded_on` line is long enough to need more than this. */
const GROUNDED_ON_MAX_LINES = 10;
const GROUNDED_ON_MAX_CHARS = 160;

/** The tokens redaction leaves behind. Their presence marks a line as identity-bearing. */
export const REDACTED_ARTIST = '[seed artist]';
export const REDACTED_TITLE = '[seed title]';
export const REDACTED_ALBUM = '[seed album]';

/** Any of the three tokens: their presence means a name had to be taken out of free text. */
export const REDACTION_TOKENS = [REDACTED_ARTIST, REDACTED_TITLE, REDACTED_ALBUM] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The forms of a name worth scrubbing: the name itself, and the name without a leading
 * "the" so "The Cure" also catches a bare "Cure". Longest first, so the fuller form wins.
 * Short leftovers (under four characters) are skipped — redacting every "Sun" or "No" in
 * a description would destroy more meaning than it protects.
 */
function scrubPhrases(value: string | undefined): string[] {
  if (!value) return [];
  const out = new Set<string>();
  const trimmed = value.trim();
  if (trimmed.length >= 3) out.add(trimmed);
  const bare = trimmed.replace(/^the\s+/i, '').trim();
  if (bare.length >= 4) out.add(bare);
  return [...out].sort((a, b) => b.length - a.length);
}

function replacePhrase(text: string, phrase: string, token: string): string {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'giu');
  return text.replace(re, token);
}

/** Replaces the seed's artist/title/album wherever they appear in a fingerprint string. */
export function redactSeedIdentity(text: string, identity?: SeedIdentity): string {
  let out = text;
  for (const phrase of scrubPhrases(identity?.artist)) {
    out = replacePhrase(out, phrase, REDACTED_ARTIST);
  }
  for (const phrase of scrubPhrases(identity?.title)) {
    out = replacePhrase(out, phrase, REDACTED_TITLE);
  }
  for (const phrase of scrubPhrases(identity?.album)) {
    out = replacePhrase(out, phrase, REDACTED_ALBUM);
  }
  return out;
}

/** 1983 → "1980s". Null stays null: an unknown year is never rounded into a decade. */
export function decadeLabel(year: number | null): string | null {
  if (year === null || !Number.isFinite(year)) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

/** Exactly what Channel C sends. Deliberately NOT a `Fingerprint`. */
export interface ChannelCPayload {
  era_decade: string | null;
  tempo_bpm: number | null;
  tempo_feel: string;
  rhythmic_character: string;
  instrumentation: string[];
  vocal_delivery: string;
  harmonic_language: string;
  emotional_register: string;
  production_texture: string;
  scene_context: string;
  signature_hook: string;
  genre_labels: string[];
  confidence: Record<string, Confidence>;
  grounded_on: string[];
}

/**
 * The fingerprint, minus everything that could name the seed.
 *
 * Exported so a reviewer (and the tests) can check the scrubbing without going through a
 * transport, and so the pipeline can log what it is about to send.
 */
export function channelCPayload(
  fingerprint: Fingerprint,
  identity?: SeedIdentity,
): ChannelCPayload {
  const clean = (s: string): string => redactSeedIdentity(s, identity).trim();

  const grounded = fingerprint.grounded_on
    .map((line) => line.trim())
    .filter((line) => GROUNDED_ON_KEEP.test(line))
    .map((line) => redactSeedIdentity(line, identity))
    // A measurement line that named the seed is dropped whole rather than shipped with a
    // hole in it: the redaction token would itself advertise that a name was there.
    .filter((line) => !REDACTION_TOKENS.some((token) => line.includes(token)))
    .map((line) => line.slice(0, GROUNDED_ON_MAX_CHARS))
    .slice(0, GROUNDED_ON_MAX_LINES);

  return {
    era_decade: decadeLabel(fingerprint.era),
    tempo_bpm: fingerprint.tempo_bpm,
    tempo_feel: fingerprint.tempo_feel,
    rhythmic_character: clean(fingerprint.rhythmic_character),
    instrumentation: fingerprint.instrumentation.map(clean).filter((s) => s.length > 0),
    vocal_delivery: clean(fingerprint.vocal_delivery),
    harmonic_language: clean(fingerprint.harmonic_language),
    emotional_register: clean(fingerprint.emotional_register),
    production_texture: clean(fingerprint.production_texture),
    scene_context: clean(fingerprint.scene_context),
    signature_hook: clean(fingerprint.signature_hook),
    genre_labels: fingerprint.genre_labels.map(clean).filter((s) => s.length > 0),
    confidence: { ...fingerprint.confidence },
    grounded_on: grounded,
  };
}

/**
 * The spread the list ACTUALLY has, from the years the model gave, not from the arrays it
 * filled in about itself. `decades_covered` is a claim; this is the check on it.
 *
 * `dated` is the base for `topDecadeShare`, so an answer with two years does not report a
 * confident 100 % skew. When nothing carried a year the spread is unmeasurable and `ok` is
 * false — an unverifiable claim of three decades is not evidence of three decades.
 */
export function measureSpread(
  years: (number | null)[],
  families: string[],
): ChannelSpread {
  const counts = new Map<string, number>();
  let dated = 0;
  for (const year of years) {
    const label = decadeLabel(typeof year === 'number' ? year : null);
    if (label === null) continue;
    dated += 1;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const decades = [...counts.keys()].sort();
  const top = Math.max(0, ...counts.values());
  const topDecadeShare = dated === 0 ? 0 : Math.round((top / dated) * 1000) / 1000;
  return {
    decades,
    genres: families,
    entries: years.length,
    dated,
    topDecadeShare,
    ok:
      dated > 0
      && decades.length >= CHANNEL_C_MIN_DECADES
      && topDecadeShare <= CHANNEL_C_MAX_DECADE_SHARE
      && families.length >= CHANNEL_C_MIN_DECADES,
  };
}

/** The one-line complaint that goes into `degraded[]` when the spread ask was not met. */
export function spreadReason(spread: ChannelSpread): string | null {
  if (spread.ok) return null;
  if (spread.dated === 0) {
    return `spread unverifiable: none of the ${spread.entries} entries carried a year`;
  }
  const parts: string[] = [];
  if (spread.decades.length < CHANNEL_C_MIN_DECADES) {
    parts.push(`${spread.decades.length} decade(s) (${spread.decades.join(', ')})`);
  }
  if (spread.topDecadeShare > CHANNEL_C_MAX_DECADE_SHARE) {
    parts.push(`${Math.round(spread.topDecadeShare * 100)}% of dated entries in one decade`);
  }
  if (spread.genres.length < CHANNEL_C_MIN_DECADES) {
    parts.push(`${spread.genres.length} genre family/ies`);
  }
  return `narrow spread: ${parts.join(' · ')} — the spec asks for at least three decades and three genre families`;
}

/* ------------------------------------------------------------------------------------ *
 * The channel
 * ------------------------------------------------------------------------------------ */

export interface ChannelCOptions {
  /** `'tight'` after a bad Stage-4 drop rate. Task P flips it; default `'normal'`. */
  tightness?: Tightness;
  /**
   * The seed's name, used ONLY to scrub it out of the fingerprint. It is never sent.
   * Optional so the channel is usable (and testable) without it; the pipeline passes it.
   */
  seedIdentity?: SeedIdentity;
  /** Test seam / safety valve. Defaults to `CHANNEL_C_MAX_CANDIDATES`. */
  maxCandidates?: number;
}

/** How many redaction tokens the scrub had to leave in the payload's free text. */
export function countRedactions(payload: ChannelCPayload): number {
  const text = JSON.stringify(payload);
  let count = 0;
  for (const token of REDACTION_TOKENS) {
    count += text.split(token).length - 1;
  }
  return count;
}

function result(
  status: ChannelResult['status'],
  extra: Partial<ChannelResult> = {},
): ChannelResult {
  return { channel: 'C', status, candidates: [], live: false, ...extra };
}

/**
 * One model call, from the fingerprint alone, to a deduped candidate list.
 *
 * Never throws and never rejects: a missing key is `skipped`, any other model failure is
 * `error` with the reason string, and both come back with an empty candidate list so the
 * pipeline degrades on this channel instead of on the run.
 */
export async function channelC(
  fingerprint: Fingerprint,
  ctx: ChannelContext,
  opts: ChannelCOptions = {},
): Promise<ChannelResult> {
  const tightness: Tightness = opts.tightness ?? 'normal';
  const cap = opts.maxCandidates ?? CHANNEL_C_MAX_CANDIDATES;

  if (ctx.signal?.aborted) return result('error', { reason: REASON.aborted });

  const payload = channelCPayload(fingerprint, opts.seedIdentity);
  ctx.log(`channel C: model prior (${tightness}, ${CHANNEL_C_PROMPT_VERSION}), seed identity withheld`);

  // A token in the payload means the FINGERPRINT named the seed and the scrub had to take
  // the name back out. The scrub held, but the prompt regression that produced the name is
  // invisible unless it is said out loud here — and the next name it writes may be a band
  // member's, which no scrub knows about.
  const redactions = countRedactions(payload);
  if (redactions > 0) {
    ctx.log(
      `channel C: WARNING — the fingerprint named the seed in ${redactions} place(s); ` +
        'the text was redacted before sending, but Stage 2 should not have written it',
    );
  }

  const res = await callStructured({
    name: 'channelC',
    schema: ChannelCOutputSchema,
    system: channelCSystem(tightness),
    user: `${CHANNEL_C_USER_HEADER}\n\n${jsonBlock(payload)}`,
    effort: 'high',
    usage: ctx.usage,
    signal: ctx.signal,
  });

  if (!res.ok) {
    if (isNoApiKey(res.reason)) {
      ctx.log('channel C: skipped — no ANTHROPIC_API_KEY');
      return result('skipped', { reason: 'no ANTHROPIC_API_KEY' });
    }
    ctx.log(`channel C: model call failed — ${res.reason}`);
    return result('error', { reason: res.reason });
  }

  const seedKey =
    opts.seedIdentity?.artist && opts.seedIdentity.title
      ? trackNormKey(opts.seedIdentity.artist, opts.seedIdentity.title)
      : null;

  const byKey = new Map<string, Candidate>();
  // The year the model gave for each candidate it kept: the only evidence the code has
  // about the decade spread it was asked for. Nothing downstream displays it.
  const yearByKey = new Map<string, number | null>();
  let dropped = 0;

  for (const entry of res.value.tracks) {
    const artist = (entry.artist ?? '').trim();
    const title = (entry.title ?? '').trim();
    // An entry with no artist or no title cannot be verified and cannot be displayed.
    // `normArtist`/`normTitle` catch the ones that are pure punctuation.
    if (!artist || !title || !normArtist(artist) || !normTitle(title)) {
      dropped += 1;
      continue;
    }

    const key = trackNormKey(artist, title);
    if (seedKey !== null && key === seedKey) {
      // The model reached the seed itself from its own description. Not a candidate.
      dropped += 1;
      continue;
    }

    const note = (entry.modelNote ?? '').trim();
    const existing = byKey.get(key);
    if (existing) {
      // Same record twice, usually a spelling variant: keep one candidate and both notes.
      if (note && !existing.hints.some((h) => h.modelNote === note)) {
        existing.hints.push({ modelNote: note });
      }
      continue;
    }
    if (byKey.size >= cap) continue;
    yearByKey.set(key, typeof entry.year === 'number' && Number.isFinite(entry.year) ? entry.year : null);
    byKey.set(key, {
      artist,
      title,
      channels: ['C'],
      hints: note ? [{ modelNote: note }] : [],
    });
  }

  const candidates = [...byKey.values()];
  const claimed = res.value.decades_covered.filter((d) => d.trim().length > 0);
  const families = res.value.genre_families.filter((g) => g.trim().length > 0);
  const spread = measureSpread([...yearByKey.values()], families);
  ctx.log(
    `channel C: ${candidates.length} candidates from ${res.value.tracks.length} entries ` +
      `(${dropped} unusable, ${res.value.tracks.length - dropped - candidates.length} duplicate/over cap) · ` +
      `decades claimed ${claimed.join(', ') || 'unstated'} · measured ` +
      `${spread.decades.join(', ') || 'none'} (${spread.dated}/${spread.entries} dated, top ` +
      `${Math.round(spread.topDecadeShare * 100)}%) · families ${families.join(', ') || 'unstated'}`,
  );

  const reason = spreadReason(spread);
  if (reason) ctx.log(`channel C: ${reason}`);

  return result('done', {
    candidates,
    live: true,
    spread,
    ...(reason ? { reason } : {}),
  });
}
