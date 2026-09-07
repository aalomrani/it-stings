/**
 * Stage 2 — `engine/fingerprint.ts`, now DETERMINISTIC and KEYLESS.
 *
 * There is no model here and no transport to inject. The tests assert that
 * `fingerprintTrack` assembles a complete `Fingerprint` from the record's measured signals:
 *
 *   - the four code-owned fields (`tempo_bpm`, `era`, `model`, `grounded_on`) are copied
 *     off the record, never invented — a BPM or a year the record does not carry is `null`;
 *   - the nine judgement fields are templated from measured data (tempo bucket, mood vector,
 *     key + scale, tags) with an honest "not interpreted (keyless)" where no signal exists,
 *     and a per-field confidence that follows data presence;
 *   - it ALWAYS returns `{ ok: true }` — there is no key to be missing;
 *   - a listener's verbatim correction is used as-is and shows in `grounded_on`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { getDb } from '@/lib/db';
import * as fingerprintsRepo from '@/lib/db/repos/fingerprints';
import {
  ENGINE_MODEL_ID,
  FINGERPRINT_PROMPT_VERSION,
  applyCorrections,
  buildGroundedOn,
  fingerprintPromptKey,
  fingerprintTrack,
  markGenreRestatements,
  normaliseCorrections,
} from '@/lib/engine/fingerprint';
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

/** A minimal base `Fingerprint` for unit-testing the pure helpers. */
function baseFingerprint(over: Partial<Fingerprint> = {}): Fingerprint {
  return {
    tempo_bpm: 132,
    tempo_feel: 'bouncing',
    rhythmic_character: 'a bouncing groove around 120 BPM',
    instrumentation: ['post-punk'],
    vocal_delivery: 'vocal delivery not interpreted (keyless)',
    harmonic_language: 'F# minor tonality',
    emotional_register: 'classified relaxed',
    production_texture: 'production texture not interpreted (keyless)',
    era: 1983,
    scene_context: 'filed under post-punk',
    signature_hook: 'signature hook not interpreted (keyless)',
    genre_labels: ['post-punk'],
    confidence: {
      tempo_feel: 'high',
      rhythmic_character: 'high',
      instrumentation: 'low',
      vocal_delivery: 'low',
      harmonic_language: 'medium',
      emotional_register: 'medium',
      production_texture: 'low',
      scene_context: 'low',
      signature_hook: 'low',
    },
    grounded_on: [],
    model: ENGINE_MODEL_ID,
    ...over,
  };
}

beforeEach(() => {
  getDb().exec('DELETE FROM fingerprints;');
});

/* ------------------------------------------------------------------------------------ *
 * No model, no key — always ok
 * ------------------------------------------------------------------------------------ */

describe('the deterministic call', () => {
  it('returns ok with a full fingerprint and no model id', async () => {
    const res = await fingerprintTrack(track());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cached).toBe(false);
    expect(res.fingerprint.model).toBe(ENGINE_MODEL_ID);
    expect(res.fingerprint.model).not.toMatch(/claude/i);
  });

  it('is a pure function of the record — same input, identical fingerprint', async () => {
    const a = await fingerprintTrack(track(), { force: true });
    const b = await fingerprintTrack(track(), { force: true });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.fingerprint).toEqual(b.fingerprint);
  });

  it('serves the cached row on the second call', async () => {
    const first = await fingerprintTrack(track());
    const second = await fingerprintTrack(track());
    expect(first).toMatchObject({ ok: true, cached: false });
    expect(second).toMatchObject({ ok: true, cached: true });
    if (first.ok && second.ok) expect(second.fingerprint).toEqual(first.fingerprint);
  });

  it('never fails on a key — there is none to be missing', async () => {
    const res = await fingerprintTrack(track({ tempoBpm: null, keySignature: null, features: null, tags: null }));
    expect(res.ok).toBe(true);
  });

  it('short-circuits on an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fingerprintTrack(track(), { signal: controller.signal })).resolves.toEqual({
      ok: false,
      reason: 'aborted',
    });
  });
});

/* ------------------------------------------------------------------------------------ *
 * Measurements are copied, never invented
 * ------------------------------------------------------------------------------------ */

describe('measurements are copied off the record', () => {
  it('copies tempo_bpm and era from the record', async () => {
    const res = await fingerprintTrack(track());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.tempo_bpm).toBe(132);
    expect(res.fingerprint.era).toBe(1983);
    expect(res.fingerprint.grounded_on).toContain('tempo 132 BPM (Deezer bpm)');
    expect(res.fingerprint.grounded_on).toContain('year 1983 (MusicBrainz first-release-date)');
  });

  it('leaves tempo_bpm and era null when no source measured them', async () => {
    const res = await fingerprintTrack(track({ tempoBpm: null, year: null }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.tempo_bpm).toBeNull();
    expect(res.fingerprint.era).toBeNull();
    expect(res.fingerprint.grounded_on).toContain('tempo unknown — no source');
    expect(res.fingerprint.grounded_on).toContain('year unknown — no source');
  });

  it('keeps the seed identity out of grounded_on (Channel C is handed this list)', () => {
    const lines = buildGroundedOn(track()).join('\n').toLowerCase();
    expect(lines).not.toContain('lovecats');
    expect(lines).not.toContain('cure');
    expect(lines).not.toContain('japanese whispers');
  });
});

/* ------------------------------------------------------------------------------------ *
 * The templated fields
 * ------------------------------------------------------------------------------------ */

describe('the templated judgement fields', () => {
  it('buckets tempo_feel from the measured BPM', async () => {
    const cases: [number, string][] = [
      [60, 'dragging'],
      [80, 'relaxed'],
      [100, 'walking'],
      [120, 'bouncing'],
      [140, 'driving'],
      [160, 'frantic'],
    ];
    for (const [bpm, feel] of cases) {
      const res = await fingerprintTrack(
        track({ tempoBpm: { value: bpm, source: { source: 'deezer', field: 'bpm' } } }),
        { force: true },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.fingerprint.tempo_feel, `${bpm} BPM`).toBe(feel);
      expect(res.fingerprint.confidence.tempo_feel).toBe('high');
      expect(res.fingerprint.rhythmic_character).toContain(`${bpm} BPM`);
    }
  });

  it('falls back to a walking feel, low confidence, when no BPM was measured', async () => {
    const res = await fingerprintTrack(track({ tempoBpm: null }), { force: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.tempo_feel).toBe('walking');
    expect(res.fingerprint.confidence.tempo_feel).toBe('low');
  });

  it('templates harmonic_language from key + scale', async () => {
    const res = await fingerprintTrack(track());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.harmonic_language).toBe('F# minor tonality');
    expect(res.fingerprint.confidence.harmonic_language).toBe('medium');
  });

  it('says harmonic_language is keyless when no key was measured', async () => {
    const res = await fingerprintTrack(track({ keySignature: null }), { force: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.harmonic_language).toContain('not interpreted (keyless)');
    expect(res.fingerprint.confidence.harmonic_language).toBe('low');
  });

  it('classifies emotional_register from the AB mood vector', async () => {
    const res = await fingerprintTrack(
      track({
        features: {
          source: { source: 'acousticbrainz', field: 'high-level' },
          moodRelaxed: 0.8,
          moodAggressive: 0.1,
        },
      }),
      { force: true },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.emotional_register).toContain('relaxed');
    expect(res.fingerprint.emotional_register).toContain('low-aggression');
    expect(res.fingerprint.confidence.emotional_register).toBe('medium');
  });

  it('leaves the no-keyless-signal fields honestly blank at low confidence', async () => {
    const res = await fingerprintTrack(track());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.vocal_delivery).toContain('not interpreted (keyless)');
    expect(res.fingerprint.signature_hook).toContain('not interpreted (keyless)');
    expect(res.fingerprint.production_texture).toContain('not interpreted (keyless)');
    expect(res.fingerprint.confidence.vocal_delivery).toBe('low');
    expect(res.fingerprint.confidence.signature_hook).toBe('low');
    expect(res.fingerprint.confidence.production_texture).toBe('low');
  });

  it('unions normalized tags and AB classifier labels into genre_labels, capped at five', async () => {
    const res = await fingerprintTrack(track(), { force: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.genre_labels).toEqual(['post-punk', 'new wave', 'jazz', 'pop']);
  });

  it('caps genre_labels at five', async () => {
    const res = await fingerprintTrack(
      track({
        tags: {
          value: [
            { name: 'a', count: 6 },
            { name: 'b', count: 5 },
            { name: 'c', count: 4 },
            { name: 'd', count: 3 },
            { name: 'e', count: 2 },
            { name: 'f', count: 1 },
          ],
          source: { source: 'lastfm', field: 'toptags' },
        },
        features: null,
      }),
      { force: true },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.genre_labels).toHaveLength(5);
  });

  it('carries the full confidence record — one entry per judged field', async () => {
    const res = await fingerprintTrack(track());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.fingerprint.confidence).sort()).toEqual(
      [
        'emotional_register',
        'harmonic_language',
        'instrumentation',
        'production_texture',
        'rhythmic_character',
        'scene_context',
        'signature_hook',
        'tempo_feel',
        'vocal_delivery',
      ],
    );
  });
});

/* ------------------------------------------------------------------------------------ *
 * markGenreRestatements — kept as a guard on the two load-bearing fields
 * ------------------------------------------------------------------------------------ */

describe('markGenreRestatements', () => {
  it('forces confidence low and notes it when a load-bearing field is a bare genre label', () => {
    const out = markGenreRestatements(
      baseFingerprint({
        scene_context: '1980s alternative rock',
        signature_hook: 'new wave',
        confidence: { ...baseFingerprint().confidence, scene_context: 'high', signature_hook: 'high' },
      }),
    );
    expect(out.confidence.scene_context).toBe('low');
    expect(out.confidence.signature_hook).toBe('low');
    const grounded = out.grounded_on.join(' | ');
    expect(grounded).toContain('scene_context read as a genre label');
    expect(grounded).toContain('signature_hook read as a genre label');
  });

  it('leaves a concrete field alone', () => {
    const out = markGenreRestatements(baseFingerprint());
    expect(out.confidence.scene_context).toBe('low'); // unchanged from base
    expect(out.grounded_on.join(' | ')).not.toContain('read as a genre label');
  });
});

/* ------------------------------------------------------------------------------------ *
 * Corrections
 * ------------------------------------------------------------------------------------ */

describe('corrections — the verbatim form', () => {
  it('overwrites the templated value, raises confidence and records it in grounded_on', async () => {
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
  });

  it('splits a list field on commas', async () => {
    const res = await fingerprintTrack(track(), {
      corrections: { instrumentation: 'upright bass, brushes, vibraphone' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fingerprint.instrumentation).toEqual(['upright bass', 'brushes', 'vibraphone']);
    expect(res.fingerprint.confidence.instrumentation).toBe('high');
  });

  it('takes a tempo_feel correction only when it is one of the six', () => {
    const base = baseFingerprint();
    const good = applyCorrections(base, normaliseCorrections({ tempo_feel: 'Walking' }));
    expect(good.tempo_feel).toBe('walking');
    expect(good.confidence.tempo_feel).toBe('high');

    const bad = applyCorrections(base, normaliseCorrections({ tempo_feel: 'quite fast really' }));
    expect(bad.tempo_feel).toBe('bouncing'); // the templated reading survives
    expect(bad.grounded_on).toEqual([]);
  });

  it('ignores an empty correction — a blank box is not a disagreement', async () => {
    const res = await fingerprintTrack(track(), { corrections: { scene_context: '   ' } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The templated scene_context stands.
    expect(res.fingerprint.scene_context).toContain('filed under');
  });

  it('does not mutate the fingerprint it was handed', () => {
    const base = baseFingerprint();
    const out = applyCorrections(base, normaliseCorrections({ signature_hook: 'the whistle' }));
    expect(out.signature_hook).toBe('the whistle');
    expect(base.signature_hook).toBe('signature hook not interpreted (keyless)');
    expect(base.grounded_on).toEqual([]);
  });
});

describe('corrections — the `wrong` form is a deterministic no-op', () => {
  it('leaves the field as templated (there is no model to re-ask)', async () => {
    const plain = await fingerprintTrack(track(), { force: true });
    const rejected = await fingerprintTrack(track(), {
      corrections: { vocal_delivery: 'wrong' },
      force: true,
    });
    expect(plain.ok && rejected.ok).toBe(true);
    if (!plain.ok || !rejected.ok) return;
    expect(rejected.fingerprint.vocal_delivery).toBe(plain.fingerprint.vocal_delivery);
    expect(rejected.fingerprint.grounded_on.join(' ')).not.toContain('listener correction');
  });
});

/* ------------------------------------------------------------------------------------ *
 * The cache
 * ------------------------------------------------------------------------------------ */

describe('the fingerprint cache', () => {
  it('keys on the engine prompt version, plus a hash of any corrections', () => {
    expect(fingerprintPromptKey(undefined)).toBe(FINGERPRINT_PROMPT_VERSION);
    expect(fingerprintPromptKey({})).toBe(FINGERPRINT_PROMPT_VERSION);
    expect(FINGERPRINT_PROMPT_VERSION).toBe('fp-det-1');

    const a = fingerprintPromptKey({ vocal_delivery: 'sneering' });
    const b = fingerprintPromptKey({ vocal_delivery: 'wrong' });
    expect(a).toContain(`${FINGERPRINT_PROMPT_VERSION}+c`);
    expect(a).not.toBe(b);
    expect(fingerprintPromptKey({ vocal_delivery: 'x', scene_context: 'y' })).toBe(
      fingerprintPromptKey({ scene_context: 'y', vocal_delivery: 'x' }),
    );
  });

  it('writes the row under (track key, engine id, prompt key)', async () => {
    await fingerprintTrack(track());
    const row = fingerprintsRepo.get({
      trackKey: 'isrc:GBAAM8300010',
      model: ENGINE_MODEL_ID,
      promptVersion: FINGERPRINT_PROMPT_VERSION,
    });
    expect(row?.model).toBe(ENGINE_MODEL_ID);
    expect(row?.tempo_bpm).toBe(132);
  });

  it('does not serve a corrected fingerprint from the uncorrected row', async () => {
    await fingerprintTrack(track());
    const corrected = await fingerprintTrack(track(), {
      corrections: { signature_hook: 'the whistle' },
    });
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.fingerprint.signature_hook).toBe('the whistle');
    const row = fingerprintsRepo.get({
      trackKey: 'isrc:GBAAM8300010',
      model: ENGINE_MODEL_ID,
      promptVersion: fingerprintPromptKey({ signature_hook: 'the whistle' }),
    });
    expect(row?.signature_hook).toBe('the whistle');
  });
});
