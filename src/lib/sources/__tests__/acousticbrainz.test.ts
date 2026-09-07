import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getFeatures, getHighLevel, getLowLevel } from '@/lib/sources/acousticbrainz';
import { fixture, installFetch, resetHarness } from './harness';

const MBID = '1c19fbb9-edce-49e1-a934-de6071dd7964';
const VAMPIRE_MBID = '0c846a8e-debd-4a63-bb93-6c57f5178b45';

beforeEach(() => resetHarness());
afterEach(() => resetHarness());

describe('getLowLevel', () => {
  it('reads bpm and key from the documented paths', async () => {
    installFetch([{ when: '/low-level', body: fixture('ab-low-level-1c19fbb9') }]);
    const res = await getLowLevel(MBID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.bpm).toBeCloseTo(91.68, 2);
    expect(res.value.key).toBe('F');
    expect(res.value.scale).toBe('major');
    expect(res.value.danceabilityScalar).toBeCloseTo(1.22, 2);
  });

  it('additively exposes key_strength, dynamic_complexity and (absent) spectral_centroid', async () => {
    // ADDITIVE keyless dimensions for the deterministic scorer; the pruned fixture has no
    // spectral_centroid, which must read as null rather than throw.
    installFetch([{ when: '/low-level', body: fixture('ab-low-level-1c19fbb9') }]);
    const res = await getLowLevel(MBID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.keyStrength).toBeCloseTo(0.5041, 3);
    expect(res.value.dynamicComplexity).toBeCloseTo(3.4266, 3);
    expect(res.value.spectralCentroid).toBeNull();
  });
});

describe('getHighLevel', () => {
  it('reads mood probabilities and maps the genre abbreviations', async () => {
    installFetch([{ when: '/high-level', body: fixture('ab-high-level-1c19fbb9') }]);
    const res = await getHighLevel(MBID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.moods.happy).toBeCloseTo(0.3346, 3);
    expect(res.value.moods.sad).toBeGreaterThan(0);
    // `genre_dortmund` ("electronic" for every high-level hit on the sample) is dropped:
    // api-reality.md §3.3 measured it constant, so it is noise, not a label.
    expect(res.value.genreLabels).toEqual(['rhythm and blues', 'jazz']);
  });

  it('additively exposes voice, party/acoustic/electronic moods and tonality', async () => {
    installFetch([{ when: '/high-level', body: fixture('ab-high-level-1c19fbb9') }]);
    const res = await getHighLevel(MBID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.voiceInstrumental).toBeCloseTo(0.2082, 3); // p(voice)
    expect(res.value.moodElectronic).toBeCloseTo(0.9794, 3);
    expect(res.value.moodParty).toBeCloseTo(0, 3);
    expect(res.value.tonal).toBeCloseTo(0.0788, 3);
  });

  it('reports a 404 as not_in_dataset, which is normal after 2022', async () => {
    installFetch([{ when: '/high-level', status: 404, body: fixture('ab-high-level-not-found') }]);
    const res = await getHighLevel(VAMPIRE_MBID);
    expect(res).toMatchObject({ ok: false, reason: 'not_in_dataset' });
  });

  it('never sends a request for a malformed MBID', async () => {
    const h = installFetch([]);
    expect(await getHighLevel('1c19fbb9')).toMatchObject({ ok: false, reason: 'invalid_request' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('getFeatures', () => {
  it('combines both endpoints into one feature set', async () => {
    installFetch([
      { when: '/low-level', body: fixture('ab-low-level-1c19fbb9') },
      { when: '/high-level', body: fixture('ab-high-level-1c19fbb9') },
    ]);
    const res = await getFeatures(MBID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.keySignature).toBe('F major');
    expect(res.value.bpm).toBeCloseTo(91.68, 2);
    expect(res.value.genreLabels).toContain('jazz');
  });

  it('survives one endpoint being missing', async () => {
    installFetch([
      { when: '/low-level', body: fixture('ab-low-level-1c19fbb9') },
      { when: '/high-level', status: 404, body: fixture('ab-high-level-not-found') },
    ]);
    const res = await getFeatures(MBID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.bpm).toBeCloseTo(91.68, 2);
    expect(res.value.moods.happy).toBeNull();
    expect(res.value.genreLabels).toEqual([]);
  });

  it('fails only when BOTH endpoints have nothing', async () => {
    installFetch([
      { when: '/low-level', status: 404, body: { message: 'Not found' } },
      { when: '/high-level', status: 404, body: { message: 'Not found' } },
    ]);
    expect(await getFeatures(VAMPIRE_MBID)).toMatchObject({ ok: false, reason: 'not_in_dataset' });
  });
});
