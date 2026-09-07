/**
 * The resolver: five keyless APIs (plus two optional keyed ones) joined into ONE
 * `TrackRecord`, cached in `tracks`, with provenance on every number.
 *
 * The order is fixed by docs/architecture.md "Resolver flow" and every step is optional:
 * a step that fails appends a human-readable line to `track.degraded` and the resolve
 * continues. The only fatal outcome is having no identity at all — no iTunes id, no
 * Deezer id, no ISRC — because then there is no cache key.
 *
 *   1. iTunes   canonical title/artist/artwork/preview/duration/release date
 *   2. Deezer   id, ISRC, bpm, release date, cover, link          -> the cache key
 *   3. cache    a `tracks` row younger than 30 days short-circuits everything below
 *   4. MusicBrainz  MBID + first-release-date (the year authority) + tags/genres
 *   5. AcousticBrainz  bpm/key/mood/danceability, keyed by that MBID
 *   6. Last.fm  crowd tags            (skipped without a key)
 *   7. Spotify  id + link             (deep link without credentials)
 *   8. tempo / year / key resolution with `Sourced` provenance
 *   9. upsert into `tracks` (never with a Deezer preview URL)
 *  10. return with a freshly minted preview
 *
 * Steps 4-7 run concurrently. MusicBrainz -> AcousticBrainz is the one sequential chain
 * (AB is keyed by the MBID); Last.fm, Spotify and GetSongBPM are independent of it.
 */

import * as tracksRepo from '@/lib/db/repos/tracks';
import * as acousticbrainz from '@/lib/sources/acousticbrainz';
import * as deezer from '@/lib/sources/deezer';
import * as getsongbpm from '@/lib/sources/getsongbpm';
import * as itunes from '@/lib/sources/itunes';
import * as lastfm from '@/lib/sources/lastfm';
import * as musicbrainz from '@/lib/sources/musicbrainz';
import * as spotify from '@/lib/sources/spotify';
import { log, yearOf } from '@/lib/sources/common';
import { withDeadline } from '@/lib/util/deadline';
import { hydratePreview, stripVolatilePreview } from '@/lib/resolve/hydratePreview';
import type { SourceRef, Sourced, TrackRecord } from '@/lib/types';

export interface ResolveInput {
  itunesId?: number;
  deezerId?: number;
  isrc?: string;
  artist: string;
  title: string;
  durationMs?: number;
}

export type ResolveResult =
  | { ok: true; track: TrackRecord; cached: boolean }
  | { ok: false; reason: 'not_found' | 'invalid_request' | 'error'; detail?: string };

/** A stored record older than this is re-resolved on the next request. */
export const TRACK_MAX_AGE_MS = 30 * 86_400_000;

/**
 * Hard wall-clock cap on the SEED's MusicBrainz + AcousticBrainz enrichment. Kept TIGHT: the
 * seed's AcousticBrainz mood/key never helps scoring (candidates carry no AcousticBrainz, so
 * every pair is at best a bpm+tags match), so the only thing worth waiting on is the seed's
 * MusicBrainz release-group YEAR, which a healthy MusicBrainz returns inside this window. If
 * MusicBrainz is degraded the seed abandons enrichment here and takes its year/tempo from
 * Deezer, so one slow service can never stall a run before candidates are even gathered.
 * Candidates never enrich, so this budget is spent at most once per run.
 */
export const SEED_ENRICH_BUDGET_MS = 4000;

/**
 * The `source.field` stamp architecture.md requires when the year came from an iTunes or
 * Deezer release date: those are the date of the EDITION the hit sits on ("Golden Brown"
 * shows 1983 on iTunes for a 1981 song), and the UI prints this next to the number.
 */
export const EDITION_DATE_FIELD = 'edition date — may be a reissue';

const sourced = <T>(value: T, source: SourceRef): Sourced<T> => ({ value, source });

async function timed<T>(
  name: string,
  timings: Record<string, number>,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    timings[name] = Date.now() - started;
  }
}

export async function resolveTrack(
  input: ResolveInput,
  // `candidate: true` is the FAST path for verifying a recommendation candidate: it skips
  // the entire MusicBrainz -> AcousticBrainz block (MusicBrainz is strictly serial at 1 req/s,
  // and pushing 40+ candidates through it is what made a fresh run take minutes). A candidate
  // then scores on Deezer tempo + edition year + the coarse iTunes genre tag — enough for
  // tempo/era/genre similarity — while the SEED keeps the full resolve. Never set it for a seed.
  opts: { force?: boolean; candidate?: boolean } = {},
): Promise<ResolveResult> {
  const started = Date.now();
  const timings: Record<string, number> = {};
  const degraded: string[] = [];

  if (!input.artist?.trim() && !input.itunesId && !input.deezerId && !input.isrc) {
    return { ok: false, reason: 'invalid_request', detail: 'need an id or an artist' };
  }

  /* ---- 1. iTunes -------------------------------------------------------------- */
  const itunesHit = await timed('itunes', timings, async () => {
    if (input.itunesId) {
      const byId = await itunes.lookupById(input.itunesId);
      if (byId.ok) return byId.value;
      degraded.push(`iTunes: id ${input.itunesId} did not resolve (${byId.reason})`);
    }
    // FAST candidate path: skip the iTunes SEARCH entirely. iTunes is rate-limited to 20
    // requests / 60 s, so searching it for every candidate re-introduces a serial wait; a
    // candidate scores on Deezer tempo/year + the Deezer album genre instead.
    if (opts.candidate) return null;
    if (!input.artist?.trim() || !input.title?.trim()) return null;
    const found = await itunes.findTrack(input.artist, input.title, {
      durationMs: input.durationMs,
    });
    if (found.ok) return found.value;
    degraded.push(`iTunes: no match for ${input.artist} — ${input.title} (${found.reason})`);
    return null;
  });

  // What we SEARCH with. The caller's strings are a query, never an identity.
  const queryArtist = itunesHit?.artist ?? input.artist;
  const queryTitle = itunesHit?.title ?? input.title;
  const durationHint = itunesHit?.durationMs ?? input.durationMs;

  /* ---- 2. Deezer -------------------------------------------------------------- */
  const dz = await timed('deezer', timings, async () => {
    if (input.deezerId) {
      const byId = await deezer.getTrack(input.deezerId);
      if (byId.ok) return byId.value;
      degraded.push(`Deezer: id ${input.deezerId} did not resolve (${byId.reason})`);
    }
    if (queryArtist.trim() && queryTitle.trim()) {
      const hits = await deezer.searchTrack(queryArtist, queryTitle);
      if (hits.ok) {
        const best = deezer.pickBestMatch(hits.value, {
          artist: queryArtist,
          title: queryTitle,
          durationMs: durationHint,
        });
        if (best) {
          const full = await deezer.getTrack(best.id);
          if (full.ok) return full.value;
          // The search item already carries isrc/preview/artwork; only bpm is lost.
          degraded.push(`Deezer: /track/${best.id} failed (${full.reason}), using the search hit`);
          return { ...best, bpm: null, releaseDate: null, fetchedAt: Date.now() };
        }
      } else {
        degraded.push(`Deezer: search failed (${hits.reason})`);
      }
    }
    if (input.isrc) {
      const byIsrc = await deezer.getTrackByIsrc(input.isrc);
      if (byIsrc.ok) return byIsrc.value;
      degraded.push(`Deezer: ISRC ${input.isrc} did not resolve (${byIsrc.reason})`);
    }
    return null;
  });

  if (!dz) degraded.push('Deezer: no match — no ISRC, no BPM and no Deezer preview');

  /**
   * The record's IDENTITY comes from whichever source supplied it, never from the caller.
   * With iTunes missing, labelling the row with the caller's strings produced records
   * carrying a name no upstream API ever attached to that recording — a row reading
   * "Sia — Titanium" whose only id resolved to "Sia Momo — Titanium (2T21 Edit)".
   * The caller's input survives only when nothing identified the track, and in that case
   * there is no key either, so the row is never written.
   */
  const artist = itunesHit?.artist ?? (dz?.artist.name || null) ?? input.artist;
  const title = itunesHit?.title ?? (dz?.titleShort || null) ?? input.title;

  const isrc = dz?.isrc ?? input.isrc ?? null;
  const key = isrc
    ? `isrc:${isrc}`
    : dz
      ? `deezer:${dz.id}`
      : itunesHit
        ? `itunes:${itunesHit.itunesId}`
        : null;

  if (!key) {
    return {
      ok: false,
      reason: 'not_found',
      detail: `neither iTunes nor Deezer knows ${input.artist} — ${input.title}`,
    };
  }

  /* ---- 3. cache --------------------------------------------------------------- */
  if (!opts.force) {
    const stored = tracksRepo.get(key);
    if (stored && Date.now() - stored.resolvedAt < TRACK_MAX_AGE_MS) {
      const hydrated = await hydratePreview(stored);
      log(`resolve ${artist} — ${title}: cache hit ${key} (${Date.now() - started}ms)`);
      return { ok: true, track: hydrated, cached: true };
    }
  }

  /* ---- 4+5. MusicBrainz -> AcousticBrainz, 6. Last.fm, 7. Spotify (concurrent) -- */
  // The FAST candidate path skips MusicBrainz + AcousticBrainz entirely — the serial 1 req/s
  // MusicBrainz queue is the whole reason a fresh run was minutes long.
  // The shape both the fast candidate path and the seed's deadline fallback resolve to.
  const noMbAb = {
    recording: null as musicbrainz.MbRecording | null,
    features: null as acousticbrainz.AcousticFeatures | null,
    via: 'isrc' as 'isrc' | 'search',
    releaseGroupYear: null as number | null,
  };

  const mbAndAb = opts.candidate
    ? // FAST candidate path: skip MusicBrainz AND AcousticBrainz entirely. Both are the slow,
      // frequently-degraded dependencies — MusicBrainz is a strictly serial 1 req/s queue and
      // AcousticBrainz is often down (10 s / multi-retry timeouts either one), which is what
      // made a fresh run take minutes. A candidate is scored on Deezer instead: tempo (Deezer
      // BPM), edition year (Deezer release date) and its genre tag (Deezer album genres) —
      // enough for a tempo / era / genre match. Only the SEED pays for MusicBrainz+AcousticBrainz.
      Promise.resolve(noMbAb)
    : // The SEED enriches with MusicBrainz + AcousticBrainz, but under a HARD deadline: those
      // sources can each hang for 10 s and the seed makes up to three serial MusicBrainz calls,
      // so a degraded service could otherwise stall the whole run for a minute before a single
      // candidate is gathered. If enrichment does not finish in time the seed proceeds on its
      // Deezer features (tempo / year / genre) — the same tier candidates score on anyway.
      withDeadline(SEED_ENRICH_BUDGET_MS, noMbAb, timed('musicbrainz+acousticbrainz', timings, async () => {
    let recording: musicbrainz.MbRecording | null = null;
    let via: 'isrc' | 'search' = 'isrc';

    if (isrc) {
      const byIsrc = await musicbrainz.lookupByIsrc(isrc, { lengthMs: durationHint });
      if (byIsrc.ok) recording = byIsrc.value;
      else degraded.push(`MusicBrainz: ISRC ${isrc} not found (${byIsrc.reason})`);
    }
    if (!recording && artist.trim() && title.trim()) {
      const bySearch = await musicbrainz.searchRecording(artist, title, { lengthMs: durationHint });
      if (bySearch.ok) {
        recording = bySearch.value;
        via = 'search';
      } else {
        degraded.push(`MusicBrainz: no recording for ${artist} — ${title} (${bySearch.reason})`);
      }
    }
    if (!recording) return { recording: null, features: null, via, releaseGroupYear: null };

    // The ISRC lookup carries no tags/genres on some responses; one extra serial call
    // (the MB limiter guarantees the spacing) fills them in.
    if (recording.tags.length === 0 && recording.genres.length === 0) {
      const full = await musicbrainz.getRecording(recording.mbid);
      if (full.ok) recording = { ...full.value, year: full.value.year ?? recording.year };
    }

    // Step 7's second year source, only when the recording carried no date of its own:
    // the earliest release-group date across the releases it appears on.
    let releaseGroupYear: number | null = null;
    if (recording.year === null) {
      const earliest = await musicbrainz.getEarliestReleaseYear(recording.mbid);
      if (earliest.ok) releaseGroupYear = earliest.value;
      else degraded.push(`MusicBrainz: no release-group date for ${recording.mbid} (${earliest.reason})`);
    }

    const features = await acousticbrainz.getFeatures(recording.mbid);
    if (!features.ok) {
      degraded.push(
        features.reason === 'not_in_dataset'
          ? `AcousticBrainz: nothing for ${recording.mbid} (the dataset stops at 2022)`
          : `AcousticBrainz: ${features.reason}`,
      );
      return { recording, features: null, via, releaseGroupYear };
    }
    return { recording, features: features.value, via, releaseGroupYear };
  }));

  const tagsTask = timed('lastfm', timings, async () => {
    const res = await lastfm.getTopTags(artist, title);
    if (res.ok) return res.value;
    degraded.push(
      res.reason === 'no_api_key'
        ? 'Last.fm skipped: no LASTFM_API_KEY (the fingerprint loses crowd tags)'
        : `Last.fm: top tags unavailable (${res.reason})`,
    );
    return null;
  });

  const spotifyTask = timed('spotify', timings, async () => {
    if (!spotify.configured()) {
      degraded.push('Spotify skipped: no client credentials — linking to a search deep link');
      return null;
    }
    const res = await spotify.searchTrack(artist, title, { durationMs: durationHint });
    if (res.ok) return res.value;
    degraded.push(`Spotify: no track id (${res.reason}) — linking to a search deep link`);
    return null;
  });

  const tempoFallbackTask = timed('getsongbpm', timings, async () => {
    if (dz?.bpm) return null; // Deezer already has the tempo; do not spend the call
    if (!getsongbpm.configured()) return null;
    const res = await getsongbpm.lookup(artist, title);
    if (res.ok) return res.value;
    degraded.push(`GetSongBPM: no tempo (${res.reason})`);
    return null;
  });

  // The song's genre, from one keyless Deezer /album call — the genres of the ALBUM this
  // track sits on (its own record, not a blanket artist label), including sub-genres where
  // Deezer carries them. Run for the SEED as well as candidates so both sides of the "genre"
  // dimension share the same taxonomy — a seed left with only iTunes' single coarse genre
  // would otherwise barely overlap a candidate's richer Deezer genre set.
  const deezerGenreTask = timed('deezer-genre', timings, async () => {
    if (!dz?.album.id) return null;
    const res = await deezer.getAlbumGenres(dz.album.id);
    return res.ok ? res.value : null;
  });

  const [
    { recording: mb, features: ab, via: mbVia, releaseGroupYear },
    tags,
    sp,
    gsb,
    deezerGenres,
  ] = await Promise.all([mbAndAb, tagsTask, spotifyTask, tempoFallbackTask, deezerGenreTask]);

  /* ---- 8. tempo, key, year, duration, artwork --------------------------------- */
  let tempoBpm: Sourced<number> | null = null;
  if (dz?.bpm) {
    tempoBpm = sourced(dz.bpm, { source: 'deezer', id: String(dz.id), field: 'bpm' });
  } else if (gsb?.bpm) {
    tempoBpm = sourced(gsb.bpm, {
      source: 'getsongbpm',
      field: 'tempo',
      ...(gsb.url ? { url: gsb.url } : {}),
    });
  } else if (ab?.bpm) {
    tempoBpm = sourced(ab.bpm, { source: 'acousticbrainz', id: ab.mbid, field: 'rhythm.bpm' });
  } else {
    degraded.push('tempo unknown: Deezer reports 0 and no fallback source had it');
  }

  let keySignature: Sourced<string> | null = null;
  if (ab?.keySignature) {
    keySignature = sourced(ab.keySignature, {
      source: 'acousticbrainz',
      id: ab.mbid,
      field: 'tonal.key_key+key_scale',
    });
  } else if (gsb?.key) {
    keySignature = sourced(gsb.key, {
      source: 'getsongbpm',
      field: 'key_of',
      ...(gsb.url ? { url: gsb.url } : {}),
    });
  }

  // Year precedence, docs/architecture.md step 7:
  //   MusicBrainz recording `first-release-date`
  //     -> MusicBrainz release-group first release
  //       -> the EARLIER of the iTunes / Deezer edition dates, stamped as a possible reissue.
  // iTunes and Deezer both date the EDITION a track sits on (a compilation or a reissue),
  // which disagreed with the truth for 5 of 15 sample tracks — so when the year comes from
  // one of them, `source.field` says so and the UI can print the warning next to it.
  let year: Sourced<number> | null = null;
  const itunesYear = itunesHit?.releaseYear ?? null;
  const deezerYear = yearOf(dz?.releaseDate);
  const editionYear =
    itunesYear !== null && deezerYear !== null
      ? Math.min(itunesYear, deezerYear)
      : (itunesYear ?? deezerYear);
  const mbYear = mb?.year ?? null;
  if (mb && mbYear) {
    const disagree = itunesYear !== null && Math.abs(itunesYear - mbYear) > 1;
    // When the MBID came from the ISRC join, MusicBrainz wins outright (architecture.md).
    // When it came from the fuzzy title search the recording identity is a guess, and
    // BOTH dates are release dates of *something*, so the earlier one is closer to the
    // original: iTunes dates the compilation a track sits on, MusicBrainz dates the
    // earliest release of that particular recording entity. Neither can predate the
    // original recording. (Louis Prima: iTunes 1956 vs a 1986 compilation entity.)
    const preferItunes = disagree && mbVia === 'search' && itunesYear !== null && itunesYear < mbYear;
    if (preferItunes && itunesHit) {
      year = sourced(itunesYear, {
        source: 'itunes',
        id: String(itunesHit.itunesId),
        field: EDITION_DATE_FIELD,
      });
    } else {
      year = sourced(mbYear, { source: 'musicbrainz', id: mb.mbid, field: 'first-release-date' });
    }
    if (disagree) {
      degraded.push(
        `year: iTunes says ${itunesYear}, MusicBrainz says ${mbYear} — using ` +
          `${preferItunes ? 'iTunes (the MusicBrainz recording came from a title search)' : 'MusicBrainz'}`,
      );
    }
  } else if (mb && releaseGroupYear !== null) {
    year = sourced(releaseGroupYear, {
      source: 'musicbrainz',
      id: mb.mbid,
      field: 'release-group first release',
    });
  } else if (editionYear !== null) {
    // Last resort. It is an EDITION date, and the stamp says so — architecture.md wants
    // the UI to print that warning rather than pass a reissue year off as the song's.
    const fromItunes = itunesYear !== null && itunesYear === editionYear;
    year = sourced(
      editionYear,
      fromItunes
        ? {
            source: 'itunes',
            id: String(itunesHit?.itunesId),
            field: EDITION_DATE_FIELD,
          }
        : { source: 'deezer', id: String(dz?.id), field: EDITION_DATE_FIELD },
    );
    if (itunesYear !== null && deezerYear !== null && itunesYear !== deezerYear) {
      degraded.push(
        `year: iTunes says ${itunesYear}, Deezer says ${deezerYear} and MusicBrainz had ` +
          `no date — using the earlier edition date (${editionYear})`,
      );
    }
  }

  let durationMs: Sourced<number> | null = null;
  if (itunesHit?.durationMs) {
    durationMs = sourced(itunesHit.durationMs, {
      source: 'itunes',
      id: String(itunesHit.itunesId),
      field: 'trackTimeMillis',
    });
  } else if (dz?.duration) {
    durationMs = sourced(dz.duration * 1000, {
      source: 'deezer',
      id: String(dz.id),
      field: 'duration',
    });
  } else if (input.durationMs) {
    durationMs = sourced(input.durationMs, { source: 'user' });
  }

  let artwork: TrackRecord['artwork'] = null;
  if (itunesHit?.artworkSmall && itunesHit.artworkLarge) {
    artwork = {
      small: itunesHit.artworkSmall,
      large: itunesHit.artworkLarge,
      source: { source: 'itunes', id: String(itunesHit.itunesId), field: 'artworkUrl100' },
    };
  } else if (dz?.album.cover && dz.album.coverXl) {
    artwork = {
      small: dz.album.cover,
      large: dz.album.coverXl,
      source: { source: 'deezer', id: String(dz.album.id ?? dz.id), field: 'album.cover' },
    };
  } else {
    degraded.push('artwork: neither iTunes nor Deezer returned a cover');
  }

  // Last.fm is the intended tag source. Without a key, MusicBrainz tags+genres are real
  // crowd data with real provenance, and the fingerprint needs SOMETHING to stand on.
  let trackTags: TrackRecord['tags'] = null;
  if (tags && tags.length > 0) {
    trackTags = sourced(
      tags.slice(0, 25).map((t) => ({ name: t.name, count: t.count })),
      { source: 'lastfm', field: 'track.getTopTags' },
    );
  } else if (mb && (mb.tags.length > 0 || mb.genres.length > 0)) {
    const merged = new Map<string, number>();
    for (const t of [...mb.genres, ...mb.tags]) {
      merged.set(t.name, Math.max(merged.get(t.name) ?? 0, t.count));
    }
    trackTags = sourced(
      [...merged.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 25),
      { source: 'musicbrainz', id: mb.mbid, field: 'tags+genres' },
    );
  } else if (itunesHit?.genre) {
    // Coarse iTunes genre when we do have an iTunes hit (e.g. the iTunes-fallback verify path).
    trackTags = sourced([{ name: itunesHit.genre, count: 1 }], {
      source: 'itunes',
      id: String(itunesHit.itunesId),
      field: 'primaryGenreName',
    });
  } else if (deezerGenres && deezerGenres.length > 0) {
    // FAST candidate path: the Deezer album genre keeps the tag-overlap dimensions from going
    // empty without any iTunes or MusicBrainz call.
    trackTags = sourced(
      deezerGenres.slice(0, 5).map((name) => ({ name, count: 1 })),
      {
        source: 'deezer',
        ...(dz?.album.id ? { id: String(dz.album.id) } : {}),
        field: 'album.genres',
      },
    );
  }

  // Enrich a non-Deezer primary with the song's Deezer album genres, deduped, so the "genre"
  // dimension compares the same taxonomy on both sides (a seed with only iTunes' one coarse
  // genre would barely overlap a candidate's Deezer genre set). Candidates already have Deezer
  // as their primary, so the guard skips them. The primary source's provenance is kept —
  // these are an additive genre enrichment.
  if (
    deezerGenres && deezerGenres.length > 0
    && trackTags !== null
    && trackTags.source.source !== 'deezer'
  ) {
    const have = new Set(trackTags.value.map((t) => t.name.toLowerCase()));
    const extra = deezerGenres
      .filter((name) => name.trim().length > 0 && !have.has(name.toLowerCase()))
      .slice(0, 5)
      .map((name) => ({ name, count: 1 }));
    if (extra.length > 0) {
      trackTags = { value: [...trackTags.value, ...extra], source: trackTags.source };
    }
  }

  const features: TrackRecord['features'] = ab
    ? {
        source: { source: 'acousticbrainz', id: ab.mbid, field: 'high-level' },
        ...(ab.danceability !== null ? { danceability: ab.danceability } : {}),
        ...(ab.moods.happy !== null ? { moodHappy: ab.moods.happy } : {}),
        ...(ab.moods.aggressive !== null ? { moodAggressive: ab.moods.aggressive } : {}),
        ...(ab.moods.relaxed !== null ? { moodRelaxed: ab.moods.relaxed } : {}),
        ...(ab.moods.sad !== null ? { moodSad: ab.moods.sad } : {}),
        ...(ab.genreLabels.length > 0 ? { genreLabels: ab.genreLabels } : {}),
        // AcousticBrainz texture signals — feed the deterministic scorer's harmonic,
        // production and vocal dimensions. Present only when AB actually scored them.
        ...(ab.keyStrength != null ? { keyStrength: ab.keyStrength } : {}),
        ...(ab.averageLoudness != null ? { loudness: ab.averageLoudness } : {}),
        ...(ab.dynamicComplexity != null ? { dynamicComplexity: ab.dynamicComplexity } : {}),
        ...(ab.spectralCentroid != null ? { spectralCentroid: ab.spectralCentroid } : {}),
        ...(ab.voiceInstrumental != null ? { voiceInstrumental: ab.voiceInstrumental } : {}),
      }
    : null;

  const links: TrackRecord['links'] = {
    ...(itunesHit?.url ? { itunes: itunesHit.url } : {}),
    ...(dz?.link ? { deezer: dz.link } : {}),
    spotify: sp?.url ?? spotify.searchDeepLink(artist, title),
    ...(mb ? { musicbrainz: mb.url } : {}),
    lastfm: lastfm.catalogueUrl(artist, title),
  };

  const ids: TrackRecord['ids'] = {
    ...(itunesHit ? { itunes: itunesHit.itunesId } : {}),
    ...(dz ? { deezer: dz.id } : {}),
    ...(sp ? { spotify: sp.id } : {}),
    ...(mb ? { mbid: mb.mbid } : {}),
  };

  const track: TrackRecord = {
    key,
    isrc,
    title,
    artist,
    album: itunesHit?.album ?? dz?.album.title ?? null,
    year,
    durationMs,
    artwork,
    // Persisted preview: iTunes only. A Deezer URL would be a 403 within 15 minutes.
    preview: itunesHit?.previewUrl
      ? {
          url: itunesHit.previewUrl,
          source: { source: 'itunes', id: String(itunesHit.itunesId), field: 'previewUrl' },
          expiresAt: null,
        }
      : null,
    tempoBpm,
    keySignature,
    links,
    ids,
    tags: trackTags,
    features,
    resolvedAt: Date.now(),
    degraded,
  };

  /* ---- 9. persist ------------------------------------------------------------- */
  try {
    tracksRepo.upsert(stripVolatilePreview(track));
  } catch (err) {
    degraded.push(`cache write failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  /* ---- 10. mint a preview and answer ------------------------------------------ */
  const hydrated = await hydratePreview(track);
  log(
    `resolve ${artist} — ${title}: ${key} in ${Date.now() - started}ms ` +
      `[${Object.entries(timings)
        .map(([k, v]) => `${k} ${v}ms`)
        .join(', ')}]${degraded.length > 0 ? ` degraded=${degraded.length}` : ''}`,
  );
  return { ok: true, track: hydrated, cached: false };
}
