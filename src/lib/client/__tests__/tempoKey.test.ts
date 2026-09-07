/**
 * The seed's measured tempo and key, and the sentences the page prints about them.
 *
 * The regression these exist for: the provenance foot read `run.fingerprint.tempo_bpm`
 * instead of `TrackRecord.tempoBpm`. A keyless run emits no `fingerprint` event at all, so
 * for `isrc:GBALB8300001` — The Cure, "The Lovecats", whose record carries
 * `tempoBpm { value: 91.9, source: deezer bpm 1143631 }` — the foot printed
 *
 *     "tempo_bpm — unknown. no source returned a BPM. No BPM is shown because none was
 *      measured."
 *
 * Deezer measured it. Fabricating an ABSENCE is as much a violation of docs/spec.md
 * "Never fabricate" as fabricating a number, so the phrase is asserted dead below.
 */

import { describe, expect, it } from 'vitest';

import {
  keyLine,
  keyProvenance,
  sourceStamp,
  tempoLine,
  tempoProvenance,
  tempoUnknownReasons,
} from '@/lib/client/format';
import type { TrackRecord } from '@/lib/types';

/** The false sentence, verbatim. No formatter may ever produce it again. */
const THE_LIE = 'no source returned a BPM';

const track = (over: Partial<TrackRecord> = {}): TrackRecord => ({
  key: 'isrc:GBALB8300001',
  isrc: 'GBALB8300001',
  title: 'The Lovecats',
  artist: 'The Cure',
  album: 'Japanese Whispers',
  year: { value: 1983, source: { source: 'musicbrainz', field: 'first-release-date' } },
  durationMs: { value: 209000, source: { source: 'itunes' } },
  artwork: null,
  preview: null,
  tempoBpm: null,
  keySignature: null,
  links: {},
  ids: { deezer: 1143631 },
  tags: null,
  features: null,
  resolvedAt: 0,
  degraded: [],
  ...over,
});

/** The record as the resolver actually stores it for the seed in the bug report. */
const lovecats = track({
  tempoBpm: { value: 91.9, source: { source: 'deezer', id: '1143631', field: 'bpm' } },
  keySignature: {
    value: 'F major',
    source: { source: 'acousticbrainz', id: 'ab-mbid', field: 'tonal.key_key+key_scale' },
  },
});

describe('sourceStamp', () => {
  it('names the field when the ref has one, and only the source when it does not', () => {
    expect(sourceStamp({ source: 'deezer', field: 'bpm' })).toBe('deezer bpm');
    expect(sourceStamp({ source: 'acousticbrainz' })).toBe('acousticbrainz');
  });
});

describe('tempoLine / keyLine — the seed card stamp line', () => {
  it('prints the measurement and who measured it', () => {
    expect(tempoLine(lovecats)).toBe('tempo: 91.9 bpm · deezer');
    expect(keyLine(lovecats)).toBe('key: F major · acousticbrainz');
  });

  it('prints nothing at all rather than a placeholder when nothing measured', () => {
    expect(tempoLine(track())).toBeNull();
    expect(keyLine(track())).toBeNull();
  });

  it('stamps whichever source actually supplied it', () => {
    const gsb = track({
      tempoBpm: { value: 128, source: { source: 'getsongbpm', field: 'tempo' } },
      keySignature: { value: 'A minor', source: { source: 'getsongbpm', field: 'key_of' } },
    });
    expect(tempoLine(gsb)).toBe('tempo: 128 bpm · getsongbpm');
    expect(keyLine(gsb)).toBe('key: A minor · getsongbpm');
  });
});

describe('tempoProvenance — the provenance foot', () => {
  it('says deezer measured it, and never that nothing did', () => {
    const said = tempoProvenance(lovecats, false);
    expect(said).toContain('91.9');
    expect(said).toContain('measured by deezer');
    expect(said).toContain('deezer bpm (id 1143631)');
    expect(said).not.toContain(THE_LIE);
    expect(said).not.toMatch(/unknown/i);
  });

  it('says acousticbrainz measured it when acousticbrainz is the source', () => {
    const ab = track({
      tempoBpm: {
        value: 120.5,
        source: { source: 'acousticbrainz', id: 'mbid-1', field: 'rhythm.bpm' },
      },
    });
    const said = tempoProvenance(ab, false);
    expect(said).toContain('measured by acousticbrainz');
    expect(said).toContain('acousticbrainz rhythm.bpm (id mbid-1)');
    expect(said).not.toContain(THE_LIE);
  });

  it('does not depend on a fingerprint existing — a keyless run gets the same sentence', () => {
    // There is no fingerprint argument to depend on: that IS the fix.
    expect(tempoProvenance(lovecats, false)).toBe(tempoProvenance(lovecats, true));
  });

  it('is honestly unknown only when the record has no tempo, and gives the real reasons', () => {
    const none = track({
      degraded: ['tempo unknown: Deezer reports 0 and no fallback source had it'],
    });
    const said = tempoProvenance(none, false);
    expect(said).toMatch(/^unknown\./);
    expect(said).toContain('Deezer reports 0 and no fallback source had it');
    expect(said).not.toContain(THE_LIE);
  });

  it('derives the reasons from the record when it carries no degraded line', () => {
    const said = tempoProvenance(track({ ids: {} }), false);
    expect(said).toContain('no Deezer match, so no Deezer bpm');
    expect(said).toContain('no GETSONGBPM_API_KEY');
    expect(said).toContain('no AcousticBrainz match for this recording');
    expect(said).not.toContain(THE_LIE);
  });

  it('claims nothing about GetSongBPM when the caller does not know the key', () => {
    const said = tempoProvenance(track(), undefined);
    expect(said).not.toMatch(/GETSONGBPM|GetSongBPM/);
  });

  it('says there is no record rather than inventing an absence of measurement', () => {
    expect(tempoProvenance(null)).toBe(
      'no seed record on this run yet, so there is no tempo to account for.',
    );
    expect(tempoProvenance(null)).not.toContain(THE_LIE);
  });
});

describe('tempoUnknownReasons', () => {
  it('prefers the degraded lines the record itself carries over anything derived', () => {
    const said = tempoUnknownReasons(
      track({
        degraded: [
          'Deezer: no match — no ISRC, no BPM and no Deezer preview',
          'GetSongBPM: no tempo (not_found)',
          'AcousticBrainz: nothing for mbid-9 (the dataset stops at 2022)',
          'Last.fm skipped: no LASTFM_API_KEY (the fingerprint loses crowd tags)',
        ],
      }),
      true,
    );
    expect(said).toContain('GetSongBPM: no tempo (not_found)');
    expect(said).toContain('AcousticBrainz: nothing for mbid-9');
    // Unrelated degradations are not dragged in as tempo reasons.
    expect(said).not.toContain('LASTFM_API_KEY');
  });

  it('says acousticbrainz had the recording but not the bpm when features are present', () => {
    const withFeatures = track({
      ids: { deezer: 1 },
      features: { source: { source: 'acousticbrainz', id: 'm', field: 'high-level' } },
    });
    expect(tempoUnknownReasons(withFeatures, true)).toBe(
      'Deezer has the track but reports bpm 0 · GetSongBPM returned no tempo · AcousticBrainz has this recording but no rhythm.bpm',
    );
  });
});

describe('keyProvenance', () => {
  it('names acousticbrainz and the exact fields the key was read out of', () => {
    expect(keyProvenance(lovecats)).toBe(
      'F major, measured by acousticbrainz tonal.key_key+key_scale (id ab-mbid) and copied onto the record, not inferred.',
    );
  });

  it('is null — no row at all — when no source gave a key', () => {
    expect(keyProvenance(track())).toBeNull();
    expect(keyProvenance(null)).toBeNull();
  });
});
