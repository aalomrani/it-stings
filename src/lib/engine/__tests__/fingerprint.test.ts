/**
 * Stage 2 — `engine/fingerprint.ts`.
 *
 * There is no `ANTHROPIC_API_KEY` here and no test may make a live call, so every path
 * runs through an injected transport. The tests that matter most are the two the spec
 * calls non-negotiable:
 *
 *   - a BPM or a year the model invented can never reach the fingerprint (the transport
 *     returns bogus ones on purpose and the record's measured values win);
 *   - a listener correction is used verbatim and is visible in `grounded_on`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDb } from '@/lib/db';
import * as fingerprintsRepo from '@/lib/db/repos/fingerprints';
import {
  FINGERPRINT_PROMPT_VERSION,
  FINGERPRINT_SYSTEM_PROMPT,
  FingerprintModelSchema,
  applyCorrections,
  buildFingerprintUserMessage,
  buildGroundedOn,
  fingerprintPromptKey,
  fingerprintTrack,
  normaliseCorrections,
  type FingerprintModelOutput,
} from '@/lib/engine/fingerprint';
import {
  MODEL,
  createUsageCounter,
  setModelTransport,
  type ModelRequest,
  type ModelResponse,
} from '@/lib/engine/model';
import type { Fingerprint, TrackRecord } from '@/lib/types';

/* ------------------------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------------------------ */

function track(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    key: 'isrc:GBAAM8300010',
    isrc: 'GBAAM8300010',
    title: 'The Lovecats',
    artist: 'The Cure',
    album: 'Japanese Whispers',
    year: { value: 1983, source: { source: 'musicbrainz', field: 'first-release-date' } },
    durationMs: { value: 217_000, source: { source: 'itunes', field: 'trackTimeMillis' } },
    artwork: null,
    preview: null,
    tempoBpm: { value: 132, source: { source: 'deezer', id: '3135556', field: 'bpm' } },
    keySignature: { value: 'F# minor', source: { source: 'acousticbrainz' } },
    links: {},
    ids: { deezer: 3135556 },
    tags: {
      value: [
        { name: 'post-punk', count: 100 },
        { name: 'new wave', count: 80 },
      ],
      source: { source: 'lastfm', field: 'toptags' },
    },
    features: {
      source: { source: 'acousticbrainz', field: 'high-level' },
      danceability: 0.71,
      moodHappy: 0.34,
      genreLabels: ['jazz', 'pop'],
    },
    resolvedAt: 1_757_000_000_000,
    degraded: [],
    ...overrides,
  };
}

/** A schema-valid model answer. Extra keys are added per-test to prove they are stripped. */
function judged(overrides: Partial<FingerprintModelOutput> = {}): FingerprintModelOutput {
  return {
    tempo_feel: 'bouncing',
    rhythmic_character: 'swung shuffle, upright bass walking in quarters under brushed kit',
    instrumentation: ['upright bass', 'brushed kit', 'clean chorused guitar'],
    vocal_delivery: 'playful, affected, dissolves into scat and cat noises',
    harmonic_language: 'minor-key jazz voicings over a chromatic descending bassline',
    emotional_register: 'arch, flirtatious, faintly sinister',
    production_texture: 'roomy analogue, live-feeling, minimal reverb on the vocal',
    scene_context: 'post-punk band deliberately playing lounge jazz',
    signature_hook: 'the meowing in the outro',
    genre_labels: ['post-punk', 'jazz pop'],
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
    ...overrides,
  };
}

/**
 * Injects a transport and records every request it saw. `answer` may be a bare object so
 * a test can return fields the schema does not admit.
 */
function transport(answer: unknown = judged(), usage = { input_tokens: 10, output_tokens: 5 }) {
  const seen: Array<{ request: ModelRequest; name: string; effort: string }> = [];
  setModelTransport(async (request, meta): Promise<ModelResponse> => {
    seen.push({ request, name: meta.name, effort: meta.effort });
    return { stop_reason: 'end_turn', parsed_output: answer, usage };
  });
  return seen;
}

function userMessageOf(seen: ReturnType<typeof transport>, i = 0): string {
  return seen[i].request.messages[0].content;
}

beforeEach(() => {
  getDb().exec('DELETE FROM fingerprints;');
  setModelTransport(null);
});

afterEach(() => {
  setModelTransport(null);
});

/* ------------------------------------------------------------------------------------ *
 * The call shape
 * ------------------------------------------------------------------------------------ */

describe('the model call', () => {
  it('is one high-effort `fingerprint` call with the frozen system prompt cached', async () => {
    const seen = transport();
    const res = await fingerprintTrack(track());

    expect(res.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('fingerprint');
    expect(seen[0].effort).toBe('high');
    expect(seen[0].request.output_config.effort).toBe('high');
    expect(seen[0].request.system).toEqual([
      { type: 'text', text: FINGERPRINT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ]);
    // Nothing volatile in the cacheable half.
    expect(seen[0].request.system[0].text).not.toContain('Lovecats');
    expect(seen[0].request.system[0].text).not.toContain('1983');
  });

  it('counts itself in the run usage', async () => {
    transport(judged(), { input_tokens: 900, output_tokens: 120 });
    const usage = createUsageCounter();

    await fingerprintTrack(track(), { usage });

    expect(usage.calls).toBe(1);
    expect(usage.inputTokens).toBe(900);
    expect(usage.outputTokens).toBe(120);
  });

  it('does not call the model again when the answer is cached', async () => {
    const usage = createUsageCounter();
    const seen = transport();

    const first = await fingerprintTrack(track(), { usage });
    const second = await fingerprintTrack(track(), { usage });

    expect(first).toMatchObject({ ok: true, cached: false });
    expect(second).toMatchObject({ ok: true, cached: true });
    expect(seen).toHaveLength(1);
    expect(usage.calls).toBe(1);
    if (first.ok && second.ok) expect(second.fingerprint).toEqual(first.fingerprint);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Never fabricate — the one rule the schema, not the prompt, enforces
 * ------------------------------------------------------------------------------------ */

describe('measurements are copied, never invented', () => {
  it('ignores a tempo, era, model and grounding the model tried to emit', async () => {
    transport({
      ...judged(),
      tempo_bpm: 999,
      era: 1999,
      model: 'some-other-model',
      grounded_on: ['I just know things'],
    });

    const res = await fingerprintTrack(track());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.fingerprint.tempo_bpm).toBe(132); // Deezer's measurement
    expect(res.fingerprint.era).toBe(1983); // MusicBrainz's measurement
    expect(res.fingerprint.model).toBe(MODEL);
    expect(res.fingerprint.grounded_on).not.toContain('I just know things');
    expect(res.fingerprint.grounded_on).toContain('tempo 132 BPM (Deezer bpm)');
    expect(res.fingerprint.grounded_on).toContain('year 1983 (MusicBrainz first-release-date)');
  });

  it('leaves tempo and era null when no source measured them', async () => {
    const seen = transport({ ...judged(), tempo_bpm: 120, era: 1984 });

    const res = await fingerprintTrack(track({ tempoBpm: null, year: null }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.fingerprint.tempo_bpm).toBeNull();
    expect(res.fingerprint.era).toBeNull();
    expect(res.fingerprint.grounded_on).toContain('tempo unknown — no source');
    expect(res.fingerprint.grounded_on).toContain('year unknown — no source');
    // And the model was told, rather than left to assume.
    expect(userMessageOf(seen)).toContain('do not guess one');
  });

  it('keeps the seed identity out of `grounded_on` (Channel C is handed this list)', () => {
    const lines = buildGroundedOn(track()).join('\n').toLowerCase();
    expect(lines).not.toContain('lovecats');
    expect(lines).not.toContain('cure');
    expect(lines).not.toContain('japanese whispers');
  });

  it('the model schema has no field for a measurement at all', () => {
    const shape = Object.keys(FingerprintModelSchema.shape);
    expect(shape).not.toContain('tempo_bpm');
    expect(shape).not.toContain('era');
    expect(shape).not.toContain('model');
    expect(shape).not.toContain('grounded_on');
    expect(shape).toContain('signature_hook');
    expect(shape).toContain('scene_context');
  });
});

/* ------------------------------------------------------------------------------------ *
 * The hard-data block
 * ------------------------------------------------------------------------------------ */

describe('the hard-data block', () => {
  it('labels every value measured, crowd or absent', async () => {
    const seen = transport();
    await fingerprintTrack(track());
    const user = userMessageOf(seen);

    expect(user).toContain('=== SEED TRACK — hard data ===');
    expect(user).toContain('title: The Lovecats');
    expect(user).toContain('artist: The Cure');
    expect(user).toContain('album: Japanese Whispers');
    expect(user).toContain('year: 1983  [MEASURED — MusicBrainz first-release-date]');
    expect(user).toContain('duration: 3:37  [MEASURED — iTunes trackTimeMillis]');
    expect(user).toContain('tempo: 132 BPM  [MEASURED — Deezer bpm]');
    expect(user).toContain('danceability 0.71; mood happy 0.34; classifier genre jazz, pop');
    expect(user).toContain('[MEASURED — AcousticBrainz high-level]');
    expect(user).toContain('lastfm top tags: post-punk (100), new wave (80)');
    expect(user).toContain('[CROWD — Last.fm track.getTopTags');
    expect(user).toContain('=== end of hard data ===');
  });

  it('says ABSENT — not nothing — for every value no source has', async () => {
    const seen = transport();
    await fingerprintTrack(
      track({
        album: null,
        durationMs: null,
        keySignature: null,
        features: null,
        tags: null,
      }),
    );
    const user = userMessageOf(seen);

    expect(user).toContain('album: ABSENT');
    expect(user).toContain('duration: ABSENT');
    expect(user).toContain('key: ABSENT');
    expect(user).toContain('audio features: ABSENT (none)');
    expect(user).toContain('musicbrainz tags/genres: ABSENT (none)');
    expect(user).toContain('lastfm top tags: ABSENT (not available)');
  });

  it('reports MusicBrainz tags on their own line when Last.fm gave none', async () => {
    const seen = transport();
    await fingerprintTrack(
      track({
        tags: {
          value: [
            { name: 'new wave', count: 1 },
            { name: 'gothic rock', count: 1 },
          ],
          source: { source: 'musicbrainz', id: 'mbid', field: 'tags+genres' },
        },
      }),
    );
    const user = userMessageOf(seen);

    expect(user).toContain('musicbrainz tags/genres: new wave, gothic rock  [CROWD — MusicBrainz]');
    expect(user).toContain('lastfm top tags: ABSENT (not available)');
  });

  it('has no corrections block when the listener has not disagreed', async () => {
    const seen = transport();
    await fingerprintTrack(track());
    expect(userMessageOf(seen)).not.toContain('LISTENER CORRECTIONS');
  });
});

/* ------------------------------------------------------------------------------------ *
 * Corrections
 * ------------------------------------------------------------------------------------ */

describe('corrections — the `wrong` form', () => {
  it('quotes the rejected reading back and asks for a re-interpretation', async () => {
    const seen = transport();
    const previous: Fingerprint = {
      ...judged(),
      rhythmic_character: 'four-on-the-floor disco pump',
      tempo_bpm: 132,
      era: 1983,
      grounded_on: [],
      model: MODEL,
    };

    await fingerprintTrack(track(), {
      corrections: { rhythmic_character: 'wrong' },
      previous,
    });
    const user = userMessageOf(seen);

    expect(user).toContain('=== LISTENER CORRECTIONS ===');
    expect(user).toContain('rhythmic_character: REJECTED');
    expect(user).toContain('"four-on-the-floor disco pump"');
    expect(user).toContain('do not restate the rejected reading in other words');
  });

  it('falls back to the cached uncorrected fingerprint for the rejected value', async () => {
    const seen = transport();

    // Run once with no corrections: that row is what the listener was looking at.
    await fingerprintTrack(track());
    // Now they reject a field, and nothing hands us the previous object.
    await fingerprintTrack(track(), { corrections: { signature_hook: 'wrong' } });

    expect(seen).toHaveLength(2);
    expect(userMessageOf(seen, 1)).toContain('"the meowing in the outro"');
  });

  it('still says the field was rejected when the previous reading is unknown', async () => {
    const seen = transport();
    await fingerprintTrack(track(), { corrections: { vocal_delivery: 'wrong' } });

    const user = userMessageOf(seen);
    expect(user).toContain('vocal_delivery: REJECTED');
    expect(user).toContain('Re-interpret it from the data');
  });

  it('does not overwrite the model on a rejection — it asked for a new reading', async () => {
    transport();
    const res = await fingerprintTrack(track(), { corrections: { vocal_delivery: 'wrong' } });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.vocal_delivery).toBe(judged().vocal_delivery);
    expect(res.fingerprint.grounded_on.join(' ')).not.toContain('listener correction');
  });
});

describe('corrections — the verbatim form', () => {
  it('overwrites the model, raises the confidence and records it in `grounded_on`', async () => {
    const seen = transport();
    const res = await fingerprintTrack(track(), {
      corrections: { vocal_delivery: 'half-sung, half-spoken, sneering' },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.fingerprint.vocal_delivery).toBe('half-sung, half-spoken, sneering');
    expect(res.fingerprint.confidence.vocal_delivery).toBe('high');
    expect(res.fingerprint.grounded_on).toContain(
      'listener correction: vocal_delivery = "half-sung, half-spoken, sneering"',
    );
    // The model was told too, so the neighbouring fields can follow the correction.
    expect(userMessageOf(seen)).toContain('"half-sung, half-spoken, sneering"');
  });

  it('splits a list field on commas', async () => {
    transport();
    const res = await fingerprintTrack(track(), {
      corrections: { instrumentation: 'upright bass, brushes, vibraphone' },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.instrumentation).toEqual(['upright bass', 'brushes', 'vibraphone']);
    expect(res.fingerprint.confidence.instrumentation).toBe('high');
  });

  it('takes a `tempo_feel` correction that is one of the six, and only then', () => {
    const base: Fingerprint = {
      ...judged(),
      tempo_bpm: null,
      era: null,
      grounded_on: [],
      model: MODEL,
    };

    const good = applyCorrections(base, normaliseCorrections({ tempo_feel: 'Walking' }));
    expect(good.tempo_feel).toBe('walking');
    expect(good.confidence.tempo_feel).toBe('high');

    const bad = applyCorrections(base, normaliseCorrections({ tempo_feel: 'quite fast really' }));
    expect(bad.tempo_feel).toBe('bouncing'); // the model's reading survives
    expect(bad.grounded_on).toEqual([]);
  });

  it('ignores an empty correction — a blank box is not a disagreement', async () => {
    const seen = transport();
    const res = await fingerprintTrack(track(), { corrections: { scene_context: '   ' } });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.scene_context).toBe(judged().scene_context);
    expect(userMessageOf(seen)).not.toContain('LISTENER CORRECTIONS');
  });

  it('does not mutate the fingerprint it was handed', () => {
    const base: Fingerprint = {
      ...judged(),
      tempo_bpm: null,
      era: null,
      grounded_on: [],
      model: MODEL,
    };
    const out = applyCorrections(base, normaliseCorrections({ signature_hook: 'the whistle' }));

    expect(out.signature_hook).toBe('the whistle');
    expect(base.signature_hook).toBe('the meowing in the outro');
    expect(base.grounded_on).toEqual([]);
    expect(base.confidence.signature_hook).toBe('high');
  });
});

/* ------------------------------------------------------------------------------------ *
 * Cache keys
 * ------------------------------------------------------------------------------------ */

describe('the fingerprint cache', () => {
  it('keys on the prompt version, and on a hash of the corrections when there are any', () => {
    expect(fingerprintPromptKey(undefined)).toBe(FINGERPRINT_PROMPT_VERSION);
    expect(fingerprintPromptKey({})).toBe(FINGERPRINT_PROMPT_VERSION);
    expect(fingerprintPromptKey({ scene_context: '  ' })).toBe(FINGERPRINT_PROMPT_VERSION);

    const a = fingerprintPromptKey({ vocal_delivery: 'sneering' });
    const b = fingerprintPromptKey({ vocal_delivery: 'wrong' });
    expect(a).not.toBe(FINGERPRINT_PROMPT_VERSION);
    expect(a).toContain(`${FINGERPRINT_PROMPT_VERSION}+c`);
    expect(a).not.toBe(b);
    // Stable regardless of key order.
    expect(fingerprintPromptKey({ vocal_delivery: 'x', scene_context: 'y' })).toBe(
      fingerprintPromptKey({ scene_context: 'y', vocal_delivery: 'x' }),
    );
  });

  it('writes the row under (track key, model, prompt key)', async () => {
    transport();
    await fingerprintTrack(track());

    const row = fingerprintsRepo.get({
      trackKey: 'isrc:GBAAM8300010',
      model: MODEL,
      promptVersion: FINGERPRINT_PROMPT_VERSION,
    });
    expect(row?.signature_hook).toBe('the meowing in the outro');
  });

  it('does not serve a corrected fingerprint from the uncorrected row', async () => {
    const seen = transport();
    await fingerprintTrack(track());
    await fingerprintTrack(track(), { corrections: { signature_hook: 'the whistle' } });

    expect(seen).toHaveLength(2);
    const corrected = fingerprintsRepo.get({
      trackKey: 'isrc:GBAAM8300010',
      model: MODEL,
      promptVersion: fingerprintPromptKey({ signature_hook: 'the whistle' }),
    });
    expect(corrected?.signature_hook).toBe('the whistle');
  });

  it('`force` skips the read but still refreshes the row', async () => {
    const seen = transport();
    await fingerprintTrack(track());

    transport(judged({ signature_hook: 'the key change into the last chorus' }));
    const res = await fingerprintTrack(track(), { force: true });

    expect(res).toMatchObject({ ok: true, cached: false });
    if (!res.ok) return;
    expect(res.fingerprint.signature_hook).toBe('the key change into the last chorus');
    expect(seen).toHaveLength(1); // the first transport was replaced, not called twice

    const row = fingerprintsRepo.get({
      trackKey: 'isrc:GBAAM8300010',
      model: MODEL,
      promptVersion: FINGERPRINT_PROMPT_VERSION,
    });
    expect(row?.signature_hook).toBe('the key change into the last chorus');
  });
});

/* ------------------------------------------------------------------------------------ *
 * Degrade paths
 * ------------------------------------------------------------------------------------ */

describe('failure degrades, never throws', () => {
  it('returns the reason when the model refuses', async () => {
    setModelTransport(async () => ({
      stop_reason: 'refusal',
      stop_details: { category: 'other' },
    }));

    await expect(fingerprintTrack(track())).resolves.toEqual({
      ok: false,
      reason: 'refusal:other',
    });
  });

  it('returns `parse_failed` when the answer does not fit the schema', async () => {
    transport({ tempo_feel: 'bouncing' }); // everything else missing

    const res = await fingerprintTrack(track());
    expect(res).toEqual({ ok: false, reason: 'parse_failed' });
    // Nothing half-formed was cached.
    expect(
      fingerprintsRepo.get({
        trackKey: 'isrc:GBAAM8300010',
        model: MODEL,
        promptVersion: FINGERPRINT_PROMPT_VERSION,
      }),
    ).toBeNull();
  });

  it('returns `no_api_key` with no key and no transport — the runtime path here', async () => {
    setModelTransport(null);
    await expect(fingerprintTrack(track())).resolves.toEqual({
      ok: false,
      reason: 'no_api_key',
    });
  });

  it('returns `aborted` on an aborted signal without calling the model', async () => {
    const seen = transport();
    const controller = new AbortController();
    controller.abort();

    await expect(fingerprintTrack(track(), { signal: controller.signal })).resolves.toEqual({
      ok: false,
      reason: 'aborted',
    });
    expect(seen).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Tidying the model's lists
 * ------------------------------------------------------------------------------------ */

describe('list hygiene', () => {
  it('dedupes instrumentation and caps genre labels at five', async () => {
    transport(
      judged({
        instrumentation: ['upright bass', 'Upright Bass', ' brushed kit ', ''],
        genre_labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      }),
    );

    const res = await fingerprintTrack(track());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.fingerprint.instrumentation).toEqual(['upright bass', 'brushed kit']);
    expect(res.fingerprint.genre_labels).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

/* ------------------------------------------------------------------------------------ *
 * A fingerprint that answers with a genre label
 * ------------------------------------------------------------------------------------ */

describe('the two load-bearing fields, read as genre labels', () => {
  it('forces confidence to low and says so in grounded_on', async () => {
    transport(judged({ scene_context: '1980s alternative rock', signature_hook: 'new wave' }));

    const res = await fingerprintTrack(track());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // The value is kept — it is the model's answer and the listener can correct it — but
    // nothing downstream may treat a genre restatement as a confident reading.
    expect(res.fingerprint.scene_context).toBe('1980s alternative rock');
    expect(res.fingerprint.confidence.scene_context).toBe('low');
    expect(res.fingerprint.confidence.signature_hook).toBe('low');
    const grounded = res.fingerprint.grounded_on.join(' | ');
    expect(grounded).toContain('scene_context read as a genre label');
    expect(grounded).toContain('signature_hook read as a genre label');
  });

  it('leaves a real answer alone', async () => {
    transport();
    const res = await fingerprintTrack(track());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.confidence.scene_context).toBe('high');
    expect(res.fingerprint.grounded_on.join(' | ')).not.toContain('read as a genre label');
  });
});

/* ------------------------------------------------------------------------------------ *
 * The prompt itself — the things a reviewer reads it for
 * ------------------------------------------------------------------------------------ */

describe('the frozen prompt', () => {
  it('forbids naming the act, its members, the producer, the album or the title', () => {
    // Channel C reads this description with the identity withheld; a name anywhere in it
    // is the "other Cure singles" failure arriving by the back door, and no scrub
    // downstream knows a band member's name.
    expect(FINGERPRINT_SYSTEM_PROMPT).toContain(
      'Never name the artist, its members, the producer, the album or the song title',
    );
  });

  it('invites the model to use what it knows, not only the data block', () => {
    expect(FINGERPRINT_SYSTEM_PROMPT).toContain('You will often know this recording');
    expect(FINGERPRINT_SYSTEM_PROMPT).toMatch(/not about your ear/);
  });

  it('forbids inventing a measurement and demands specificity', () => {
    const p = FINGERPRINT_SYSTEM_PROMPT;
    expect(p).toContain('never report a tempo in BPM');
    expect(p).toContain('ABSENT means nobody knows');
    expect(p).toContain('signature_hook');
    expect(p).toContain('scene_context');
    expect(p).toContain('LISTENER CORRECTIONS');
    // The failure mode the spec names, quoted back as a failure.
    expect(p.toLowerCase()).toContain('is a failed fingerprint');
  });

  it('every judged field carries a description for the model', () => {
    for (const [name, field] of Object.entries(FingerprintModelSchema.shape)) {
      expect(field.description, `${name} needs a .describe()`).toBeTruthy();
      expect((field.description as string).length).toBeGreaterThan(40);
    }
  });

  it('builds the same user message twice for the same input', () => {
    const t = track();
    expect(buildFingerprintUserMessage(t)).toBe(buildFingerprintUserMessage(t));
  });
});
