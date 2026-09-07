/**
 * Channel C — the model prior.
 *
 * The load-bearing test in this file is the first one: the seed's identity must not reach
 * the model. Everything else (dedupe, cap, degrade paths) is bookkeeping around that.
 *
 * No test makes a live model call. `setModelTransport` injects a fake that receives the
 * fully assembled request, so the assertions are on the real bytes rather than on a
 * summary of them.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  CHANNEL_C_MAX_CANDIDATES,
  CHANNEL_C_PROMPT_VERSION,
  CHANNEL_C_SYSTEM_NORMAL,
  CHANNEL_C_SYSTEM_TIGHT,
  CHANNEL_C_TIGHTEN_DROP_RATE,
  ChannelCOutputSchema,
  channelC,
  channelCPayload,
  channelCSystem,
  countRedactions,
  decadeLabel,
  measureSpread,
  redactSeedIdentity,
  spreadReason,
  type ChannelCOutput,
} from '@/lib/engine/channels/c';
import type { ChannelContext } from '@/lib/engine/channels/types';
import {
  createUsageCounter,
  setModelTransport,
  type ModelRequest,
  type ModelResponse,
  type ModelTransport,
} from '@/lib/engine/model';
import type { Fingerprint } from '@/lib/types';

/* ------------------------------------------------------------------------------------ *
 * Fixtures — the acceptance-test seed, whose identity must never leave this file
 * ------------------------------------------------------------------------------------ */

const SEED_IDENTITY = { artist: 'The Cure', title: 'The Lovecats' };

const FINGERPRINT: Fingerprint = {
  tempo_bpm: 132,
  tempo_feel: 'bouncing',
  rhythmic_character: 'swung shuffle, upright bass walking in quarters, brushed kit',
  instrumentation: ['upright bass', 'brushed kit', 'clean chorused guitar', 'piano'],
  vocal_delivery: 'playful and affected, breaks into scat and animal noises',
  harmonic_language: 'minor-key jazz voicings, chromatic descending bassline',
  emotional_register: 'arch, flirtatious, faintly sinister',
  production_texture: 'roomy early-eighties analogue, live-feeling, minimal reverb on the vocal',
  era: 1983,
  scene_context: 'The Cure, a post-punk band, deliberately playing lounge jazz',
  signature_hook: 'the meowing — the whole band impersonating cats behind the chorus',
  genre_labels: ['art pop', 'lounge jazz', 'post-punk'],
  confidence: {
    tempo_feel: 'high',
    rhythmic_character: 'high',
    instrumentation: 'medium',
    vocal_delivery: 'high',
    harmonic_language: 'medium',
    emotional_register: 'high',
    production_texture: 'medium',
    scene_context: 'high',
    signature_hook: 'high',
  },
  grounded_on: [
    'Deezer bpm 132',
    'AcousticBrainz: danceability 0.71, mood_happy 0.44',
    'duration 3:38',
    // Dropped by shape: crowd-tag vocabularies are full of artist names.
    'Last.fm tags: the cure, post-punk, new wave, 80s',
    'MusicBrainz genres: new wave, post-punk',
    // Dropped by shape: the era travels as a decade, not a year.
    'year 1983 (iTunes)',
    // Allowlisted SHAPE, but it names the seed -> dropped whole.
    'listener correction: vocal_delivery — nothing like the rest of The Cure',
  ],
  model: 'claude-opus-5',
};

const OUTPUT: ChannelCOutput = {
  decades_covered: ['1950s', '1980s', '2010s'],
  genre_families: ['jump blues', 'art pop', 'electro-swing'],
  tracks: [
    {
      artist: 'Louis Prima',
      title: 'Jump, Jive an’ Wail',
      year: 1956,
      modelNote: 'the same walking upright bass under a vocal that keeps mugging',
    },
    {
      artist: 'Caravan Palace',
      title: 'Lone Digger',
      year: 2015,
      modelNote: 'swung shuffle rebuilt from samples, with the same arch cabaret voice',
    },
    {
      artist: 'Squeeze',
      title: 'Cool for Cats',
      year: 1979,
      modelNote: 'deadpan spoken-sung delivery over a bouncing bassline',
    },
  ],
};

function ctxFor(signal?: AbortSignal): ChannelContext & { lines: string[] } {
  const lines: string[] = [];
  return {
    seedKey: 'isrc:GBALB8300001',
    usage: createUsageCounter(),
    signal,
    log: (line) => lines.push(line),
    lines,
  };
}

/** Injects a transport and records every assembled request it receives. */
function recorder(
  response: ModelResponse | ((req: ModelRequest) => ModelResponse),
): { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const transport: ModelTransport = async (request) => {
    requests.push(request);
    return typeof response === 'function' ? response(request) : response;
  };
  setModelTransport(transport);
  return { requests };
}

function ok(value: unknown): ModelResponse {
  return {
    stop_reason: 'end_turn',
    parsed_output: value,
    usage: { input_tokens: 900, output_tokens: 700, cache_read_input_tokens: 1_200 },
  };
}

/** Everything the transport was handed, as one string — nothing hides in a nested field. */
function wire(request: ModelRequest): string {
  return JSON.stringify(request);
}

const MENTIONS_CURE = /(?<![\p{L}\p{N}])cure(?![\p{L}\p{N}])/iu;
const MENTIONS_LOVECATS = /(?<![\p{L}\p{N}])love\s*cats(?![\p{L}\p{N}])/iu;

afterEach(() => {
  setModelTransport(null);
});

/* ------------------------------------------------------------------------------------ *
 * The rule this channel exists to enforce
 * ------------------------------------------------------------------------------------ */

describe('channelC — the seed identity never reaches the model', () => {
  it('sends no artist, no title and no release year', async () => {
    const { requests } = recorder(ok(OUTPUT));
    const res = await channelC(FINGERPRINT, ctxFor(), { seedIdentity: SEED_IDENTITY });

    expect(res.status).toBe('done');
    expect(requests).toHaveLength(1);
    const sent = wire(requests[0]);

    expect(sent).not.toMatch(MENTIONS_CURE);
    expect(sent).not.toMatch(MENTIONS_LOVECATS);
    // The era travels as a decade; the release year itself never travels. Asserted on
    // the user message because the frozen system prompt has example years of its own.
    const data = requests[0].messages[0].content;
    expect(data).not.toContain('1983');
    expect(data).toContain('1980s');
  });

  it('strips grounded_on lines that name the artist, and tag/year lines wholesale', () => {
    const payload = channelCPayload(FINGERPRINT, SEED_IDENTITY);

    expect(payload.grounded_on).toEqual([
      'Deezer bpm 132',
      'AcousticBrainz: danceability 0.71, mood_happy 0.44',
      'duration 3:38',
    ]);
    // The correction line was allowlisted by shape and dropped only because it named the
    // seed — dropped whole, not shipped with a redaction hole in it.
    expect(payload.grounded_on.join(' ')).not.toContain('[seed');
    expect(payload.grounded_on.some((l) => /listener correction/i.test(l))).toBe(false);
    expect(payload.grounded_on.some((l) => /last\.fm|musicbrainz/i.test(l))).toBe(false);
  });

  it('redacts the seed name out of the fingerprint free text, keeping the sense of it', () => {
    const payload = channelCPayload(FINGERPRINT, SEED_IDENTITY);

    expect(payload.scene_context).toBe(
      '[seed artist], a post-punk band, deliberately playing lounge jazz',
    );
    // Free text keeps its own words: only the seed's NAME is scrubbed, not the prose.
    expect(payload.production_texture).toContain('roomy early-eighties analogue');
    expect(payload.signature_hook).toContain('the meowing');
  });

  it('redaction is word-bounded: it does not eat "obscure" or "cures"', () => {
    const text = 'an obscure record that cures nothing, by The Cure, and by Cure';
    expect(redactSeedIdentity(text, SEED_IDENTITY)).toBe(
      'an obscure record that cures nothing, by [seed artist], and by [seed artist]',
    );
  });

  it('a payload built without an identity still drops the tag and year lines', () => {
    // The pipeline always passes an identity; a caller that forgets must not leak the
    // artist through Last.fm's tag vocabulary anyway.
    const payload = channelCPayload(FINGERPRINT);
    expect(payload.grounded_on.some((l) => /last\.fm/i.test(l))).toBe(false);
    expect(payload.grounded_on.some((l) => /year/i.test(l))).toBe(false);
    expect(payload.era_decade).toBe('1980s');
  });

  it('decadeLabel floors the year and never invents one', () => {
    expect(decadeLabel(1983)).toBe('1980s');
    expect(decadeLabel(2005)).toBe('2000s');
    expect(decadeLabel(1900)).toBe('1900s');
    expect(decadeLabel(null)).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------ *
 * The request
 * ------------------------------------------------------------------------------------ */

describe('channelC — the assembled call', () => {
  it('is one high-effort `channelC` call with the frozen system prompt', async () => {
    const { requests } = recorder(ok(OUTPUT));
    await channelC(FINGERPRINT, ctxFor(), { seedIdentity: SEED_IDENTITY });

    const req = requests[0];
    expect(req.system).toHaveLength(1);
    expect(req.system[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    expect(req.system[0].text).toBe(CHANNEL_C_SYSTEM_NORMAL);
    expect(req.output_config.effort).toBe('high');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
    // Volatile data lives in the user message only — the system prompt stays cacheable.
    expect(req.system[0].text).not.toContain('brushed kit');
    expect(req.messages[0].content).toContain('brushed kit');
  });

  it('asks for spread explicitly: the schema carries the decade and genre-family fields', async () => {
    const { requests } = recorder(ok(OUTPUT));
    await channelC(FINGERPRINT, ctxFor(), { seedIdentity: SEED_IDENTITY });

    const schema = JSON.stringify(requests[0].output_config.format.schema);
    expect(schema).toContain('decades_covered');
    expect(schema).toContain('genre_families');
    expect(schema).toContain('modelNote');
    expect(requests[0].output_config.format.type).toBe('json_schema');
    // The prompt says it out loud too, not just in the schema.
    expect(CHANNEL_C_SYSTEM_NORMAL).toMatch(/at least three decades/i);
    expect(CHANNEL_C_SYSTEM_NORMAL).toMatch(/at least three genre families/i);
  });

  it('the prompt forbids a genre-only reason and warns that entries are verified', () => {
    expect(CHANNEL_C_SYSTEM_NORMAL).toMatch(/similar vibe/i);
    expect(CHANNEL_C_SYSTEM_NORMAL).toMatch(/catalogue/i);
    expect(CHANNEL_C_SYSTEM_NORMAL).toMatch(/only a genre label/i);
    expect(CHANNEL_C_SYSTEM_NORMAL).toMatch(/do not try to identify it/i);
  });

  it('tightness switches to the stricter variant', async () => {
    const { requests } = recorder(ok(OUTPUT));
    await channelC(FINGERPRINT, ctxFor(), { tightness: 'tight' });

    expect(requests[0].system[0].text).toBe(CHANNEL_C_SYSTEM_TIGHT);
    expect(channelCSystem('normal')).toBe(CHANNEL_C_SYSTEM_NORMAL);
    expect(channelCSystem('tight')).toBe(CHANNEL_C_SYSTEM_TIGHT);
    // Fewer, more canonical picks — and it says why the bar moved.
    expect(CHANNEL_C_SYSTEM_TIGHT).toMatch(/18 to 25/);
    expect(CHANNEL_C_SYSTEM_NORMAL).toMatch(/25 to 40/);
    expect(CHANNEL_C_SYSTEM_TIGHT).toMatch(/could not be found in any catalogue/i);
    expect(CHANNEL_C_SYSTEM_TIGHT).not.toBe(CHANNEL_C_SYSTEM_NORMAL);
  });

  it('the run is told which prompt version produced the list', async () => {
    recorder(ok(OUTPUT));
    const ctx = ctxFor();
    await channelC(FINGERPRINT, ctx, { seedIdentity: SEED_IDENTITY });
    expect(ctx.lines.join('\n')).toContain(CHANNEL_C_PROMPT_VERSION);
    expect(CHANNEL_C_TIGHTEN_DROP_RATE).toBe(0.2);
  });

  it('counts its token usage into the run', async () => {
    recorder(ok(OUTPUT));
    const ctx = ctxFor();
    await channelC(FINGERPRINT, ctx, { seedIdentity: SEED_IDENTITY });

    expect(ctx.usage.calls).toBe(1);
    expect(ctx.usage.inputTokens).toBe(900);
    expect(ctx.usage.outputTokens).toBe(700);
    expect(ctx.usage.cacheReadTokens).toBe(1_200);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Turning the answer into candidates
 * ------------------------------------------------------------------------------------ */

describe('channelC — candidate assembly', () => {
  it('carries artist, title, channel C and the model note', async () => {
    recorder(ok(OUTPUT));
    const res = await channelC(FINGERPRINT, ctxFor(), { seedIdentity: SEED_IDENTITY });

    expect(res).toMatchObject({ channel: 'C', status: 'done', live: true });
    expect(res.candidates).toHaveLength(3);
    expect(res.candidates[0]).toEqual({
      artist: 'Louis Prima',
      title: 'Jump, Jive an’ Wail',
      channels: ['C'],
      hints: [{ modelNote: 'the same walking upright bass under a vocal that keeps mugging' }],
    });
  });

  it('dedupes by trackNormKey and merges the notes of the duplicates', async () => {
    recorder(
      ok({
        ...OUTPUT,
        tracks: [
          { artist: 'The Cramps', title: 'Goo Goo Muck', year: 1981, modelNote: 'first note' },
          // Same record: normalisation folds the remaster suffix and the ampersand form.
          {
            artist: 'The Cramps',
            title: 'Goo Goo Muck - 2001 Remaster',
            year: 2001,
            modelNote: 'second note',
          },
          { artist: 'the cramps', title: 'goo goo muck', year: 1981, modelNote: 'first note' },
        ],
      }),
    );
    const res = await channelC(FINGERPRINT, ctxFor());

    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0].hints).toEqual([
      { modelNote: 'first note' },
      { modelNote: 'second note' },
    ]);
  });

  it('drops entries with no artist or no title instead of shipping half a candidate', async () => {
    recorder(
      ok({
        ...OUTPUT,
        tracks: [
          { artist: '', title: 'Nameless', year: null, modelNote: 'x' },
          { artist: 'Someone', title: '   ', year: null, modelNote: 'x' },
          { artist: '—', title: '???', year: null, modelNote: 'x' },
          { artist: 'Betty Hutton', title: 'He’s a Demon', year: 1951, modelNote: 'y' },
        ],
      }),
    );
    const res = await channelC(FINGERPRINT, ctxFor());

    expect(res.candidates.map((c) => c.artist)).toEqual(['Betty Hutton']);
  });

  it('drops the seed itself if the model reaches it from its own description', async () => {
    recorder(
      ok({
        ...OUTPUT,
        tracks: [
          // Exact `trackNormKey` match only: "The Lovecats" and "The Love Cats" are
          // deliberately DIFFERENT keys (see util/normalize) — a spelling variant that
          // resolves back to the seed is Stage 4's and the pipeline's job, not this one's.
          { artist: 'The Cure', title: 'The Lovecats', year: 1983, modelNote: 'the meowing' },
          { artist: 'Squeeze', title: 'Cool for Cats', year: 1979, modelNote: 'deadpan' },
        ],
      }),
    );
    const res = await channelC(FINGERPRINT, ctxFor(), { seedIdentity: SEED_IDENTITY });

    expect(res.candidates.map((c) => c.artist)).toEqual(['Squeeze']);
  });

  it('caps the list, keeping the first entries and still merging later duplicates', async () => {
    const tracks = Array.from({ length: 60 }, (_, i) => ({
      artist: `Artist ${i}`,
      title: `Title ${i}`,
      year: 1960 + i,
      modelNote: `note ${i}`,
    }));
    // A duplicate of an in-cap entry, arriving after the cap is full.
    tracks.push({ artist: 'Artist 0', title: 'Title 0', year: 1960, modelNote: 'late note' });
    recorder(ok({ ...OUTPUT, tracks }));

    const res = await channelC(FINGERPRINT, ctxFor());
    expect(res.candidates).toHaveLength(CHANNEL_C_MAX_CANDIDATES);
    expect(res.candidates[0].hints).toEqual([{ modelNote: 'note 0' }, { modelNote: 'late note' }]);
    expect(res.candidates.at(-1)?.artist).toBe(`Artist ${CHANNEL_C_MAX_CANDIDATES - 1}`);
  });

  it('honours a lower cap from the caller', async () => {
    recorder(ok(OUTPUT));
    const res = await channelC(FINGERPRINT, ctxFor(), { maxCandidates: 2 });
    expect(res.candidates).toHaveLength(2);
  });

  it('logs the spread the model claimed AND the one its years actually show', async () => {
    recorder(ok(OUTPUT));
    const ctx = ctxFor();
    await channelC(FINGERPRINT, ctx);
    const log = ctx.lines.join('\n');
    expect(log).toContain('decades claimed 1950s, 1980s, 2010s');
    // The claim is not the check: the measured decades come from the years it gave.
    expect(log).toContain('measured 1950s, 1970s, 2010s');
    expect(log).toContain('families jump blues, art pop, electro-swing');
  });
});

/* ------------------------------------------------------------------------------------ *
 * Degrade paths — this channel never throws
 * ------------------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------------------ *
 * The spread ask, checked rather than trusted
 * ------------------------------------------------------------------------------------ */

describe('channelC — the spread it delivered, not the one it claimed', () => {
  it('measures the decades from the years, and returns them on the result', async () => {
    recorder(ok(OUTPUT));
    const res = await channelC(FINGERPRINT, ctxFor());
    expect(res.spread).toEqual({
      decades: ['1950s', '1970s', '2010s'],
      genres: ['jump blues', 'art pop', 'electro-swing'],
      entries: 3,
      dated: 3,
      topDecadeShare: 0.333,
      ok: true,
    });
    expect(res.reason).toBeUndefined();
  });

  it('says so when 26 tracks all come from one decade, however the arrays are filled in', async () => {
    const oneDecade: ChannelCOutput = {
      decades_covered: ['1950s', '1980s', '2010s'],
      genre_families: ['new wave', 'post-punk', 'art pop'],
      tracks: Array.from({ length: 26 }, (_, i) => ({
        artist: `Act ${i}`,
        title: `Track ${i}`,
        year: 1983,
        modelNote: 'the same brushed kit',
      })),
    };
    recorder(ok(oneDecade));
    const ctx = ctxFor();
    const res = await channelC(FINGERPRINT, ctx);

    expect(res.candidates).toHaveLength(26);
    expect(res.spread?.ok).toBe(false);
    expect(res.spread?.decades).toEqual(['1980s']);
    // The pipeline turns a `done` result's `reason` into a `degraded[]` line.
    expect(res.reason).toMatch(/narrow spread/);
    expect(ctx.lines.join('\n')).toMatch(/narrow spread/);
  });

  it('will not call an unverifiable claim of three decades a spread', () => {
    const spread = measureSpread([null, null, null], ['a', 'b', 'c']);
    expect(spread.ok).toBe(false);
    expect(spreadReason(spread)).toMatch(/none of the 3 entries carried a year/);
  });
});

/* ------------------------------------------------------------------------------------ *
 * The album is scrubbed too, and a scrub that had to fire is said out loud
 * ------------------------------------------------------------------------------------ */

describe('channelC — a fingerprint that named the seed', () => {
  const NAMED: Fingerprint = {
    ...FINGERPRINT,
    scene_context: 'the Japanese Whispers-era joke, a post-punk band playing lounge jazz',
    vocal_delivery: "Robert Smith's affected purr, sliding into scat",
  };
  const IDENTITY = { ...SEED_IDENTITY, album: 'Japanese Whispers' };

  it('redacts the album out of the free text', () => {
    const payload = channelCPayload(NAMED, IDENTITY);
    expect(payload.scene_context).not.toMatch(/japanese whispers/i);
    expect(payload.scene_context).toContain('[seed album]');
    expect(countRedactions(payload)).toBeGreaterThan(0);
  });

  it('warns in the log when a redaction had to fire — Stage 2 should not have written it', async () => {
    recorder(ok(OUTPUT));
    const ctx = ctxFor();
    await channelC(NAMED, ctx, { seedIdentity: IDENTITY });
    expect(ctx.lines.join('\n')).toMatch(/WARNING — the fingerprint named the seed/);
  });
});

describe('channelC — the frozen prompts', () => {
  it('name no year, so they cannot hand the model the seed\'s own decade', () => {
    for (const prompt of [CHANNEL_C_SYSTEM_NORMAL, CHANNEL_C_SYSTEM_TIGHT]) {
      expect(prompt).not.toMatch(/\b(?:1[89]\d{2}|20[0-4]\d)\b/);
    }
  });
});

describe('channelC — every failure degrades', () => {
  it('no ANTHROPIC_API_KEY and no transport -> skipped, nothing called', async () => {
    setModelTransport(null);
    const ctx = ctxFor();
    const res = await channelC(FINGERPRINT, ctx, { seedIdentity: SEED_IDENTITY });

    expect(res).toEqual({
      channel: 'C',
      status: 'skipped',
      reason: 'no ANTHROPIC_API_KEY',
      candidates: [],
      live: false,
    });
    expect(ctx.usage.calls).toBe(0);
  });

  it('a refusal is an error with the reason, not a throw', async () => {
    recorder({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'general_harms' },
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    const res = await channelC(FINGERPRINT, ctxFor());

    expect(res.status).toBe('error');
    expect(res.reason).toBe('refusal:general_harms');
    expect(res.candidates).toEqual([]);
    expect(res.live).toBe(false);
  });

  it('a truncated answer is an error, not a half list', async () => {
    recorder({ stop_reason: 'max_tokens', usage: { input_tokens: 10, output_tokens: 16_000 } });
    const res = await channelC(FINGERPRINT, ctxFor());
    expect(res).toMatchObject({ status: 'error', reason: 'max_tokens', live: false });
  });

  it('an answer the schema rejects is parse_failed', async () => {
    recorder(ok({ decades_covered: ['1980s'], tracks: 'not an array' }));
    const res = await channelC(FINGERPRINT, ctxFor());
    expect(res).toMatchObject({ status: 'error', reason: 'parse_failed' });
  });

  it('a transport that throws degrades to error:<message>', async () => {
    setModelTransport(async () => {
      throw new Error('socket hang up');
    });
    const res = await channelC(FINGERPRINT, ctxFor());
    expect(res.status).toBe('error');
    expect(res.reason).toContain('socket hang up');
  });

  it('an already-aborted signal returns before calling the model', async () => {
    const { requests } = recorder(ok(OUTPUT));
    const controller = new AbortController();
    controller.abort();

    const res = await channelC(FINGERPRINT, ctxFor(controller.signal));
    expect(res).toMatchObject({ status: 'error', reason: 'aborted', live: false });
    expect(requests).toHaveLength(0);
  });

  it('an abort during the call is reported as aborted', async () => {
    const controller = new AbortController();
    setModelTransport(async () => {
      controller.abort();
      return ok(OUTPUT);
    });

    const res = await channelC(FINGERPRINT, ctxFor(controller.signal));
    expect(res).toMatchObject({ status: 'error', reason: 'aborted' });
  });
});

/* ------------------------------------------------------------------------------------ *
 * The schema itself
 * ------------------------------------------------------------------------------------ */

describe('ChannelCOutputSchema', () => {
  it('accepts a well-formed answer and a null year', () => {
    const parsed = ChannelCOutputSchema.safeParse({
      decades_covered: ['1980s'],
      genre_families: ['art pop'],
      tracks: [{ artist: 'A', title: 'B', year: null, modelNote: 'the bass walks' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an entry that omits the note or the year field', () => {
    expect(
      ChannelCOutputSchema.safeParse({
        decades_covered: [],
        genre_families: [],
        tracks: [{ artist: 'A', title: 'B' }],
      }).success,
    ).toBe(false);
  });
});
