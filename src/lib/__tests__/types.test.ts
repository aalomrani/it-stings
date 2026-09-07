import { describe, expect, it } from 'vitest';

import {
  FingerprintSchema,
  PipelineEventSchema,
  RecommendationSchema,
  RunOptionsSchema,
  TrackRecordSchema,
  type Fingerprint,
  type PipelineEvent,
  type Recommendation,
  type TrackRecord,
} from '@/lib/types';

const track: TrackRecord = {
  key: 'isrc:GBAAM8300010',
  isrc: 'GBAAM8300010',
  title: 'The Lovecats',
  artist: 'The Cure',
  album: 'Japanese Whispers',
  year: { value: 1983, source: { source: 'musicbrainz' } },
  durationMs: { value: 217000, source: { source: 'itunes' } },
  artwork: null,
  preview: { url: 'https://cdnt-preview.dzcdn.net/x', source: { source: 'deezer' }, expiresAt: 1 },
  tempoBpm: null,
  keySignature: null,
  links: { deezer: 'https://www.deezer.com/track/3135556' },
  ids: { deezer: 3135556 },
  tags: null,
  features: null,
  resolvedAt: 1_757_000_000_000,
  degraded: ['acousticbrainz: not_in_dataset'],
};

const fingerprint: Fingerprint = {
  tempo_bpm: null,
  tempo_feel: 'bouncing',
  rhythmic_character: 'swung shuffle',
  instrumentation: ['upright bass'],
  vocal_delivery: 'playful',
  harmonic_language: 'minor-key jazz voicings',
  emotional_register: 'arch',
  production_texture: 'roomy analogue',
  era: 1983,
  scene_context: 'post-punk band playing lounge jazz',
  signature_hook: 'the meowing',
  genre_labels: ['post-punk'],
  confidence: {
    tempo_feel: 'high',
    rhythmic_character: 'high',
    instrumentation: 'medium',
    vocal_delivery: 'high',
    harmonic_language: 'low',
    emotional_register: 'high',
    production_texture: 'medium',
    scene_context: 'high',
    signature_hook: 'high',
  },
  grounded_on: ['Last.fm tags: post-punk'],
  model: 'claude-opus-5',
};

const recommendation: Recommendation = {
  track,
  channels: ['A'],
  evidence: [{ channel: 'A', kind: 'lastfm_similar', detail: 'match 0.42' }],
  dimensions: [{ dimension: 'rhythmic_character', score: 0.9, note: 'same shuffle' }],
  modelScore: 0.8,
  finalScore: 0.8,
  why: 'the same swung upright-bass walk',
  sharedTraits: ['walking upright bass in quarters'],
  sameArtist: false,
  flags: [],
};

describe('schemas accept the types they mirror', () => {
  it('TrackRecord', () => {
    expect(TrackRecordSchema.parse(track)).toEqual(track);
  });

  it('Fingerprint', () => {
    expect(FingerprintSchema.parse(fingerprint)).toEqual(fingerprint);
  });

  it('Recommendation', () => {
    expect(RecommendationSchema.parse(recommendation)).toEqual(recommendation);
  });

  it('RunOptions', () => {
    expect(RunOptionsSchema.parse({ includeSameArtist: true })).toEqual({
      includeSameArtist: true,
    });
  });

  it('every PipelineEvent variant', () => {
    const events: PipelineEvent[] = [
      { type: 'run', runId: 'run_1', cached: false },
      { type: 'stage', stage: 'resolve', status: 'start' },
      { type: 'seed', track },
      { type: 'fingerprint', fingerprint },
      { type: 'channel', channel: 'B', status: 'skipped', reason: 'no TAVILY_API_KEY' },
      { type: 'verified', channel: 'A', kept: 12, dropped: 3 },
      { type: 'result', item: recommendation, provisional: true },
      {
        type: 'final',
        results: [recommendation],
        degraded: [],
        stats: {
          perChannel: {
            A: { found: 1, verified: 1, dropped: 0 },
            B: { found: 0, verified: 0, dropped: 0, skipped: 'no key' },
            C: { found: 0, verified: 0, dropped: 0 },
          },
          durationMs: 1,
          modelCalls: 1,
        },
      },
      { type: 'error', message: 'boom' },
    ];
    for (const event of events) {
      expect(PipelineEventSchema.parse(event)).toEqual(event);
    }
  });
});

describe('schemas reject malformed data', () => {
  it('rejects a TrackRecord with the wrong nullability', () => {
    expect(TrackRecordSchema.safeParse({ ...track, isrc: undefined }).success).toBe(false);
    expect(TrackRecordSchema.safeParse({ ...track, degraded: 'nope' }).success).toBe(false);
  });

  it('rejects an unknown tempo_feel and a missing confidence key', () => {
    expect(FingerprintSchema.safeParse({ ...fingerprint, tempo_feel: 'fast' }).success).toBe(false);
    const { signature_hook, ...rest } = fingerprint.confidence;
    void signature_hook;
    expect(FingerprintSchema.safeParse({ ...fingerprint, confidence: rest }).success).toBe(false);
  });

  it('rejects an unknown PipelineEvent type and a bad provisional flag', () => {
    expect(PipelineEventSchema.safeParse({ type: 'nope' }).success).toBe(false);
    expect(
      PipelineEventSchema.safeParse({ type: 'result', item: recommendation, provisional: false })
        .success,
    ).toBe(false);
  });
});

describe('RunOptions.weights — the per-run scoring weights (Feature 1)', () => {
  it('accepts a partial map of scored dimensions with integer weights 0..10', () => {
    const parsed = RunOptionsSchema.parse({
      includeSameArtist: false,
      weights: { era: 1, rhythmic_character: 5, scene_context: 0 },
    });
    expect(parsed.weights).toEqual({ era: 1, rhythmic_character: 5, scene_context: 0 });
  });

  it('rejects tempo_feel — it is measured, never scored, so never weighted', () => {
    expect(
      RunOptionsSchema.safeParse({ includeSameArtist: false, weights: { tempo_feel: 2 } }).success,
    ).toBe(false);
  });

  it('rejects an unknown dimension key rather than dropping it silently', () => {
    expect(
      RunOptionsSchema.safeParse({ includeSameArtist: false, weights: { loudness: 2 } }).success,
    ).toBe(false);
  });

  it('rejects a non-integer or an out-of-range weight', () => {
    const bad = (weights: Record<string, number>) =>
      RunOptionsSchema.safeParse({ includeSameArtist: false, weights }).success;
    expect(bad({ era: 1.5 })).toBe(false);
    expect(bad({ era: 11 })).toBe(false);
    expect(bad({ era: -1 })).toBe(false);
  });
});
