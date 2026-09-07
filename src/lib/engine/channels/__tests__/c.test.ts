/**
 * Channel C — keyless Deezer related→top candidate generation.
 *
 * No network, no model. Deezer is stubbed at `fetchExternal` (the source harness) with
 * inline bodies in Deezer's real shape, so every assertion is on the channel's own
 * union/dedupe/seed-drop logic rather than on a live catalogue.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  CHANNEL_C_MAX_CANDIDATES,
  CHANNEL_C_PROMPT_VERSION,
  CHANNEL_C_TIGHTEN_DROP_RATE,
  TOP_PER_ARTIST_TIGHT,
  channelC,
  measureNeighbourSpread,
} from '@/lib/engine/channels/c';
import type { ChannelContext } from '@/lib/engine/channels/types';
import { installFetch, resetHarness, type Route } from '@/lib/sources/__tests__/harness';
import { createUsageCounter } from '@/lib/engine/model';
import type { Fingerprint, TrackRecord } from '@/lib/types';

/* ------------------------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------------------------ */

const SEED_ARTIST_ID = 259;
const SEED_DEEZER_ID = 1143631;

const SEED: TrackRecord = {
  key: 'isrc:GBALB8300001',
  isrc: 'GBALB8300001',
  title: 'The Lovecats',
  artist: 'The Cure',
  album: null,
  year: null,
  durationMs: null,
  artwork: null,
  preview: null,
  tempoBpm: null,
  keySignature: null,
  links: {},
  ids: { deezer: SEED_DEEZER_ID },
  tags: null,
  features: null,
  resolvedAt: 1_700_000_000_000,
  degraded: [],
};

const FINGERPRINT: Fingerprint = {
  tempo_bpm: 132,
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
  genre_labels: ['art pop', 'lounge jazz'],
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
  grounded_on: ['Deezer bpm 132'],
  model: 'deterministic-v1',
};

/** A Deezer `/track/{id}` body carrying only the artist id the channel reads. */
function trackBody(artistId: number) {
  return { id: SEED_DEEZER_ID, title: 'The Lovecats', artist: { id: artistId, name: 'The Cure' } };
}

function related(...artists: [number, string][]) {
  return {
    data: artists.map(([id, name]) => ({
      id,
      name,
      nb_fan: 1000,
      tracklist: `https://api.deezer.com/artist/${id}/top`,
    })),
    total: artists.length,
  };
}

function topTrack(id: number, title: string, artist: [number, string], rank = 500_000) {
  return {
    id,
    title,
    title_short: title,
    duration: 200,
    rank,
    artist: { id: artist[0], name: artist[1] },
    contributors: [{ id: artist[0], name: artist[1] }],
  };
}

function top(...tracks: ReturnType<typeof topTrack>[]) {
  return { data: tracks, total: tracks.length };
}

function ctxFor(signal?: AbortSignal): ChannelContext & { lines: string[] } {
  const lines: string[] = [];
  return { seedKey: SEED.key, usage: createUsageCounter(), signal, log: (l) => lines.push(l), lines };
}

/** The seed's related returns three neighbours; every second-hop related is empty. */
function baseRoutes(extra: Route[] = []): Route[] {
  return [
    { when: `/track/${SEED_DEEZER_ID}`, body: trackBody(SEED_ARTIST_ID) },
    {
      when: `/artist/${SEED_ARTIST_ID}/related`,
      body: related([100, 'Siouxsie and the Banshees'], [101, 'Bauhaus'], [102, 'Joy Division']),
    },
    ...extra,
    // Second-hop related for any neighbour: empty, so widening adds nothing new.
    { when: '/related', body: { data: [], total: 0 } },
  ];
}

afterEach(() => resetHarness());

/* ------------------------------------------------------------------------------------ *
 * Union / dedupe / seed-drop
 * ------------------------------------------------------------------------------------ */

describe('channelC — Deezer related→top', () => {
  it('unions each neighbour\'s top tracks, dedupes, drops the seed artist and the seed track', async () => {
    installFetch(
      baseRoutes([
        {
          when: '/artist/100/top',
          body: top(
            topTrack(1, 'Cities in Dust', [100, 'Siouxsie and the Banshees'], 900_000),
            // A track credited to the seed artist: must be dropped.
            topTrack(2, 'Some Collab', [SEED_ARTIST_ID, 'The Cure']),
          ),
        },
        {
          when: '/artist/101/top',
          body: top(
            topTrack(3, 'Bela Lugosi’s Dead', [101, 'Bauhaus'], 800_000),
            // A duplicate of a neighbour 102 track (same artist+title): deduped.
            topTrack(4, 'Love Will Tear Us Apart', [102, 'Joy Division']),
          ),
        },
        {
          when: '/artist/102/top',
          body: top(
            topTrack(4, 'Love Will Tear Us Apart', [102, 'Joy Division'], 950_000),
            // The seed track itself surfaced from a neighbour: must be dropped.
            topTrack(5, 'The Lovecats', [SEED_ARTIST_ID, 'The Cure']),
          ),
        },
      ]),
    );

    const res = await channelC(SEED, FINGERPRINT, ctxFor());

    expect(res.status).toBe('done');
    expect(res.live).toBe(true);
    const pairs = res.candidates.map((c) => `${c.artist} — ${c.title}`).sort();
    expect(pairs).toEqual([
      'Bauhaus — Bela Lugosi’s Dead',
      'Joy Division — Love Will Tear Us Apart',
      'Siouxsie and the Banshees — Cities in Dust',
    ]);
    // No candidate credited to the seed artist survived.
    expect(res.candidates.some((c) => /the cure/i.test(c.artist))).toBe(false);
    // Every candidate is Channel C with a Deezer provenance hint.
    for (const c of res.candidates) {
      expect(c.channels).toEqual(['C']);
      expect(c.hints[0]?.modelNote).toMatch(/Deezer/);
    }
  });

  it('measures spread over the neighbours that contributed', async () => {
    installFetch(
      baseRoutes([
        { when: '/artist/100/top', body: top(topTrack(1, 'A', [100, 'Siouxsie and the Banshees'])) },
        { when: '/artist/101/top', body: top(topTrack(2, 'B', [101, 'Bauhaus'])) },
        { when: '/artist/102/top', body: top(topTrack(3, 'C', [102, 'Joy Division'])) },
      ]),
    );
    const res = await channelC(SEED, FINGERPRINT, ctxFor());
    expect(res.spread?.dated).toBe(3);
    expect(res.spread?.entries).toBe(3);
    expect(res.spread?.ok).toBe(true);
    // No decades: Deezer top tracks carry no release year.
    expect(res.spread?.decades).toEqual([]);
    // A healthy spread pushes no degraded line.
    expect(res.reason).toBeUndefined();
  });

  it('caps the candidate list', async () => {
    const many = Array.from({ length: 30 }, (_, i) => topTrack(i + 10, `Track ${i}`, [100, 'Siouxsie and the Banshees']));
    installFetch(
      baseRoutes([
        { when: '/artist/100/top', body: top(...many) },
        { when: '/artist/101/top', body: top(...Array.from({ length: 30 }, (_, i) => topTrack(i + 100, `Song ${i}`, [101, 'Bauhaus']))) },
        { when: '/artist/102/top', body: top() },
      ]),
    );
    const res = await channelC(SEED, FINGERPRINT, ctxFor(), { maxCandidates: 5 });
    expect(res.candidates).toHaveLength(5);
    expect(res.status).toBe('done');
  });

  it('tight tightness pulls fewer top tracks per neighbour', async () => {
    const h = installFetch(
      baseRoutes([
        { when: '/artist/100/top', body: top(topTrack(1, 'A', [100, 'Siouxsie and the Banshees'])) },
        { when: '/artist/101/top', body: top(topTrack(2, 'B', [101, 'Bauhaus'])) },
        { when: '/artist/102/top', body: top(topTrack(3, 'C', [102, 'Joy Division'])) },
      ]),
    );
    await channelC(SEED, FINGERPRINT, ctxFor(), { tightness: 'tight' });
    const topUrls = h.urls().filter((u) => u.includes('/top'));
    expect(topUrls.length).toBeGreaterThan(0);
    for (const u of topUrls) expect(u).toContain(`limit=${TOP_PER_ARTIST_TIGHT}`);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Degrade paths — this channel never throws
 * ------------------------------------------------------------------------------------ */

describe('channelC — degrade paths', () => {
  it('is skipped when the seed has no Deezer id', async () => {
    installFetch([]);
    const res = await channelC({ ...SEED, ids: {} }, FINGERPRINT, ctxFor());
    expect(res).toMatchObject({ channel: 'C', status: 'skipped', candidates: [] });
    expect(res.reason).toMatch(/no Deezer id/i);
  });

  it('errors (not throws) when the Deezer track lookup fails', async () => {
    installFetch([{ when: `/track/${SEED_DEEZER_ID}`, body: { error: { type: 'DataException', code: 800 } } }]);
    const res = await channelC(SEED, FINGERPRINT, ctxFor());
    expect(res.status).toBe('error');
    expect(res.reason).toMatch(/deezer getTrack/i);
    expect(res.candidates).toEqual([]);
  });

  it('returns an empty done when Deezer has no related artists', async () => {
    installFetch([
      { when: `/track/${SEED_DEEZER_ID}`, body: trackBody(SEED_ARTIST_ID) },
      { when: '/related', body: { data: [], total: 0 } },
    ]);
    const res = await channelC(SEED, FINGERPRINT, ctxFor());
    expect(res.status).toBe('done');
    expect(res.candidates).toEqual([]);
    expect(res.reason).toMatch(/no related artists/i);
  });

  it('returns before any request on an already-aborted signal', async () => {
    const h = installFetch([]);
    const controller = new AbortController();
    controller.abort();
    const res = await channelC(SEED, FINGERPRINT, ctxFor(controller.signal));
    expect(res).toMatchObject({ status: 'error', reason: 'aborted', candidates: [] });
    expect(h.urls()).toHaveLength(0);
  });

  it('never emits an ANTHROPIC_API_KEY degrade', async () => {
    installFetch([]);
    const res = await channelC({ ...SEED, ids: {} }, FINGERPRINT, ctxFor());
    expect(JSON.stringify(res)).not.toMatch(/ANTHROPIC/i);
  });
});

/* ------------------------------------------------------------------------------------ *
 * Pure helpers / constants
 * ------------------------------------------------------------------------------------ */

describe('measureNeighbourSpread', () => {
  it('is ok with ≥3 distinct neighbours and no single one dominating', () => {
    const s = measureNeighbourSpread(['a', 'b', 'c', 'a'], 4);
    expect(s.dated).toBe(3);
    expect(s.entries).toBe(4);
    expect(s.topDecadeShare).toBe(0.5);
    expect(s.ok).toBe(true);
  });

  it('is not ok when one neighbour supplies more than 60% of the pool', () => {
    const s = measureNeighbourSpread(['a', 'a', 'a', 'a', 'b', 'c'], 6);
    expect(s.topDecadeShare).toBeGreaterThan(0.6);
    expect(s.ok).toBe(false);
  });

  it('is not ok with fewer than three distinct neighbours', () => {
    expect(measureNeighbourSpread(['a', 'b'], 2).ok).toBe(false);
    expect(measureNeighbourSpread([], 0).ok).toBe(false);
  });

  it('disables the LLM-era tightening retry (threshold above 1.0)', () => {
    // The keyless Deezer channel never names a non-existent track, and the pipeline's
    // one-track-per-artist filter makes any reachable drop-rate threshold fire the retry on
    // every run — doubling wall-clock for no benefit. The constant is kept (the pipeline
    // guard still reads it) but set unreachable so the retry never triggers.
    expect(CHANNEL_C_TIGHTEN_DROP_RATE).toBeGreaterThan(1);
    expect(CHANNEL_C_MAX_CANDIDATES).toBeGreaterThan(0);
    expect(CHANNEL_C_PROMPT_VERSION).toMatch(/deezer/);
  });
});
