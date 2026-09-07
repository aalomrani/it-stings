'use client';

/**
 * The whole app, in one state machine.
 *
 * Empty state → type → typeahead → pick a row → `POST /api/resolve` → push `?seed=<key>`
 * → open the SSE stream → seed card, fingerprint panel and results streaming in. A reload
 * with `?seed=` restores the run from the server's cache down the same code path; there is
 * no second one.
 *
 * After a search the page goes quiet: the wasp leaves, the small vertical wordmark appears
 * in the left gutter (≥1180px), and the search strip holds the seed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { DegradedNotice } from '@/components/DegradedNotice';
import { EmptyState } from '@/components/EmptyState';
import { PlaylistsLink } from '@/components/PlaylistsLink';
import { ProvenanceFoot } from '@/components/ProvenanceFoot';
import { ResultList } from '@/components/ResultList';
import { SameArtistToggle } from '@/components/SameArtistToggle';
import { SearchBar } from '@/components/SearchBar';
import { SeedCard } from '@/components/SeedCard';
import { ShareLink } from '@/components/ShareLink';
import { StageLine } from '@/components/StageLine';
import { health as getHealth, resolve, type Health, type TypeaheadHit } from '@/lib/client/api';
import { mergeDegraded, useRecommendStream } from '@/lib/client/useRecommendStream';
import { typeaheadHint, useTypeahead } from '@/lib/client/useTypeahead';
import type { Channel, FingerprintField } from '@/lib/types';

const CHANNELS: Channel[] = ['A', 'B', 'C'];

/** The run's inputs live in the URL, so a reload or a shared link restores the run the
 *  user was actually looking at rather than an uncorrected one at the same address. */
function readCorrections(raw: string | null): Partial<Record<FingerprintField, string>> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Partial<Record<FingerprintField, string>> = {};
    for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[field as FingerprintField] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function runHref(
  seedKey: string,
  sameArtist: boolean,
  corrections: Partial<Record<FingerprintField, string>>,
): string {
  const params = new URLSearchParams({ seed: seedKey });
  if (sameArtist) params.set('sameArtist', '1');
  if (Object.keys(corrections).length > 0) params.set('corrections', JSON.stringify(corrections));
  return `/?${params.toString()}`;
}

export function App() {
  const router = useRouter();
  const params = useSearchParams();
  const seedKey = params.get('seed');

  // `null` means "the user has not touched the field", in which case the strip shows the
  // seed the run is for. Derived rather than written back by an effect, so a reload with
  // `?seed=` fills the field the moment the `seed` event lands and never fights typing.
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  // The whole health answer, not just the keys: it also says whether this instance is
  // invite-only and what its run caps are, which the provenance foot prints.
  const [health, setHealth] = useState<Health | null>(null);
  const keys = health?.keys ?? null;

  // Not state: the address describes the page. A reload, a back step or a shared link all
  // restore the same run, corrections and all.
  const sameArtist = params.get('sameArtist') === '1';
  const correctionsRaw = params.get('corrections');
  const corrections = useMemo(() => readCorrections(correctionsRaw), [correctionsRaw]);

  const setSameArtist = useCallback(
    (on: boolean) => {
      if (!seedKey) return;
      router.replace(runHref(seedKey, on, corrections), { scroll: false });
    },
    [router, seedKey, corrections],
  );

  const setCorrections = useCallback(
    (next: Partial<Record<FingerprintField, string>>) => {
      if (!seedKey) return;
      router.replace(runHref(seedKey, sameArtist, next), { scroll: false });
    },
    [router, seedKey, sameArtist],
  );

  // The hook keys its effect on the derived URL, so a fresh object here re-opens nothing.
  const run = useRecommendStream({ seedKey, sameArtist, corrections });
  const seed = run.seed;
  const query = typed ?? (seed ? `${seed.title} — ${seed.artist}` : '');
  const typeahead = useTypeahead(query, open);

  // Which keys are configured decides the credits line and the provenance foot. It never
  // decides whether the page renders: a dead /api/health leaves both honest but shorter.
  useEffect(() => {
    let live = true;
    getHealth()
      .then((h) => {
        if (live) setHealth(h);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const onSelect = useCallback(
    (hit: TypeaheadHit) => {
      setOpen(false);
      setResolving(true);
      setResolveError(null);
      setTyped(`${hit.title} — ${hit.artist}`);
      resolve(hit)
        .then((track) => {
          // A new seed starts a clean run: no corrections, same-artist back to its default.
          router.replace(runHref(track.key, false, {}), { scroll: false });
        })
        .catch((err: unknown) => {
          setResolveError(
            `could not resolve that track — ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        })
        .finally(() => setResolving(false));
    },
    [router],
  );

  const onClear = useCallback(() => {
    setTyped('');
    setResolveError(null);
    router.replace('/', { scroll: false });
  }, [router]);

  const credits = (
    <>
      search <b>itunes</b> · previews <b>deezer</b>
      {keys?.lastfm ? (
        <>
          {' '}
          · tags <b>last.fm</b>
        </>
      ) : null}{' '}
      · ids <b>musicbrainz</b>
      {/* The only way from a fresh page to the saved playlists: the results branch has its
          own link under the search bar, and a visitor with no seed had none at all. */}{' '}
      · <PlaylistsLink inline />
    </>
  );

  if (!seedKey) {
    return (
      <EmptyState
        value={query}
        onChange={setTyped}
        onSelect={onSelect}
        typeahead={typeahead}
        open={open}
        onOpenChange={setOpen}
        hint={resolveError ?? typeaheadHint(typeahead, query, open)}
        resolving={resolving}
        credits={credits}
      />
    );
  }

  // Channels that actually ran this run: everything else on a card is stamped `cached`.
  // A cached run REPLAYS those channel events without fetching anything, so nothing on a
  // replayed run may be stamped `live`.
  const liveChannels = run.cached
    ? []
    : CHANNELS.filter((c) => {
        const state = run.channels[c];
        return state.status === 'start' || state.status === 'done';
      });
  const results = run.final ?? run.provisional;
  const verified = CHANNELS.reduce((sum, c) => sum + (run.channels[c].kept ?? 0), 0);

  // The seed never resolved: the notices say so, and drawing a record card for a track the
  // page just called imaginary — with a play button and an offer to save it — would not.
  const resolved =
    seed !== null && run.stages.resolve !== 'error' && !seed.degraded.includes('not resolved');

  // The seed record carries its OWN degraded lines (`Spotify skipped: no client
  // credentials — linking to a search deep link`), and a skipped thing the user cannot
  // see is a lie by omission. `mergeDegraded` dedupes against the run's own array.
  const degraded = resolved ? mergeDegraded(run.degraded, seed.degraded) : run.degraded;

  return (
    <>
      {/* The name of the page, in the heading tree at every width. The vertical spine
          below is the same words drawn, and it is `display:none` under 1180px — a
          screen reader may not be the only thing that loses the page title. */}
      <h1 className="sr">It Stings</h1>
      <p className="spine" aria-hidden="true">
        It Stings
      </p>

      <main className="sheet">
        <SearchBar
          variant="bar"
          value={query}
          onChange={setTyped}
          onSelect={onSelect}
          onClear={onClear}
          typeahead={typeahead}
          open={open}
          onOpenChange={setOpen}
        />

        {/* Phase 4, additive: the way to the saved playlists, and how many tracks are in
            them. Under the search bar — nothing ever goes above it. */}
        <PlaylistsLink />

        <StageLine run={run} />
        <DegradedNotice lines={degraded} error={run.error ?? resolveError} />

        {resolved && seed ? (
          <>
            <SeedCard
              seed={seed}
              fingerprint={run.fingerprint}
              applied={corrections}
              onRerun={setCorrections}
            />
            {seed.artist ? (
              <SameArtistToggle artist={seed.artist} on={sameArtist} onChange={setSameArtist} />
            ) : null}
            {/* Sharing is about the SEED, not about how many candidates survived: the
                control lives here, above the results/empty branch, so a run that found
                nothing — every run on a keyless instance — can still be passed on. */}
            <p className="keyhint">
              <ShareLink seedKey={seedKey} />
            </p>
          </>
        ) : null}

        {results.length > 0 ? (
          <ResultList
            results={results}
            seedKey={seedKey}
            liveChannels={liveChannels}
            provisional={run.final === null}
            scored={results.length}
            verified={verified}
          />
        ) : (
          <p className="keyhint" role="status">
            {run.streaming
              ? 'nothing scored yet — results appear as each candidate verifies, not in one burst at the end'
              : resolved
                ? 'no candidate survived verification for this seed.'
                : 'nothing was searched for — the seed never resolved to a track.'}
          </p>
        )}

        <ProvenanceFoot run={run} health={health} />
      </main>
    </>
  );
}
