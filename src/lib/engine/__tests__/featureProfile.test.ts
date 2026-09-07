import { describe, expect, it } from 'vitest';

import {
  bucketTempoFeel,
  buildFeatureProfile,
  splitKeySignature,
} from '@/lib/engine/featureProfile';
import type { SourceRef, TrackRecord } from '@/lib/types';

const SRC: SourceRef = { source: 'deezer' };

/** A resolved TrackRecord with everything nulled out; override the fields under test. */
function makeTrack(partial: Partial<TrackRecord> = {}): TrackRecord {
  return {
    key: 'deezer:1',
    isrc: null,
    title: 'Test Title',
    artist: 'Test Artist',
    album: null,
    year: null,
    durationMs: null,
    artwork: null,
    preview: null,
    tempoBpm: null,
    keySignature: null,
    links: {},
    ids: {},
    tags: null,
    features: null,
    resolvedAt: 0,
    degraded: [],
    ...partial,
  };
}

describe('bucketTempoFeel', () => {
  it('buckets bpm at the documented boundaries', () => {
    expect(bucketTempoFeel(60)).toBe('dragging');
    expect(bucketTempoFeel(80)).toBe('relaxed');
    expect(bucketTempoFeel(100)).toBe('walking');
    expect(bucketTempoFeel(120)).toBe('bouncing');
    expect(bucketTempoFeel(140)).toBe('driving');
    expect(bucketTempoFeel(160)).toBe('frantic');
  });

  it('treats null / zero / negative bpm as unknown', () => {
    expect(bucketTempoFeel(null)).toBeNull();
    expect(bucketTempoFeel(0)).toBeNull();
    expect(bucketTempoFeel(-5)).toBeNull();
  });
});

describe('splitKeySignature', () => {
  it('splits "C# minor" and tolerates a bare "F"', () => {
    expect(splitKeySignature('C# minor')).toEqual({ keyName: 'C#', scale: 'minor' });
    expect(splitKeySignature('F major')).toEqual({ keyName: 'F', scale: 'major' });
    expect(splitKeySignature('F')).toEqual({ keyName: 'F', scale: null });
    expect(splitKeySignature(null)).toEqual({ keyName: null, scale: null });
  });
});

describe('buildFeatureProfile', () => {
  it('derives every field a fully-resolved AcousticBrainz track carries', () => {
    const track = makeTrack({
      key: 'isrc:GBALB8300001',
      title: 'The Lovecats',
      artist: 'The Cure',
      year: { value: 1983, source: SRC },
      tempoBpm: { value: 91.9, source: SRC },
      keySignature: { value: 'F major', source: SRC },
      tags: {
        value: [
          { name: 'new wave', count: 9 },
          { name: 'British', count: 4 },
        ],
        source: SRC,
      },
      features: {
        source: { source: 'acousticbrainz' },
        danceability: 0.7,
        moodHappy: 0.33,
        moodSad: 0.6,
        moodAggressive: 0.1,
        moodRelaxed: 0.8,
        genreLabels: ['jazz', 'rhythm and blues'],
      },
    });
    const p = buildFeatureProfile(track);

    expect(p.bpm).toBe(91.9);
    expect(p.tempoFeel).toBe('relaxed'); // 70 <= 91.9 < 92
    expect(p.keyName).toBe('F');
    expect(p.scale).toBe('major');
    expect(p.moodVector).toEqual({ happy: 0.33, sad: 0.6, aggressive: 0.1, relaxed: 0.8 });
    expect(p.danceability).toBe(0.7);
    expect(p.year).toBe(1983);
    expect(p.genreLabels).toEqual(['jazz', 'rhythm and blues']);
    // Tags normalised: "British" dropped, "new wave" kept with its count.
    expect(p.normalizedTags).toEqual([{ name: 'new wave', count: 9 }]);
    // Full coverage -> all three tiers.
    expect(p.tiers).toEqual(['ab-vector', 'bpm', 'tags']);
    // AB texture extras absent on THIS record -> null, never invented.
    expect(p.keyStrength).toBeNull();
    expect(p.loudness).toBeNull();
    expect(p.voiceInstrumental).toBeNull();
    expect(p.itunesGenre).toBeNull();
  });

  it('plumbs the AcousticBrainz texture extras off the record when present', () => {
    const p = buildFeatureProfile(
      makeTrack({
        keySignature: { value: 'A minor', source: SRC },
        features: {
          source: { source: 'acousticbrainz' },
          keyStrength: 0.82,
          loudness: 0.91,
          dynamicComplexity: 3.4,
          spectralCentroid: 1800,
          voiceInstrumental: 0.95,
        },
      }),
    );
    // These are the 6/15 weight the scorer's harmonic/production/vocal dims read: no
    // longer a constant null, so they can actually discriminate.
    expect(p.keyStrength).toBe(0.82);
    expect(p.loudness).toBe(0.91);
    expect(p.dynComplexity).toBe(3.4);
    expect(p.centroid).toBe(1800);
    expect(p.voiceInstrumental).toBe(0.95);
  });

  it('reports an empty tier list for a bare track (no bpm, moods, or tags)', () => {
    const p = buildFeatureProfile(makeTrack());
    expect(p.tiers).toEqual([]);
    expect(p.tempoFeel).toBeNull();
    expect(p.moodVector).toEqual({ happy: null, sad: null, aggressive: null, relaxed: null });
    expect(p.normalizedTags).toEqual([]);
  });

  it('tiers reflect a bpm+tags track with no AcousticBrainz moods', () => {
    const p = buildFeatureProfile(
      makeTrack({
        tempoBpm: { value: 128, source: SRC },
        tags: { value: [{ name: 'house', count: 5 }], source: SRC },
      }),
    );
    expect(p.tiers).toEqual(['bpm', 'tags']);
    expect(p.tempoFeel).toBe('bouncing');
  });
});
