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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { AddMatch } from '@/components/AddMatch';
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
import { WeightsPanel } from '@/components/WeightsPanel';
import { health as getHealth, resolve, type Health, type TypeaheadHit } from '@/lib/client/api';
import {
  getProfile,
  postFeedback,
  type FeedbackLabel,
  type FeedbackResult,
  type FeedbackSource,
  type ProfileView,
} from '@/lib/client/train';
import { mergeDegraded, useRecommendStream } from '@/lib/client/useRecommendStream';
import { typeaheadHint, useTypeahead } from '@/lib/client/useTypeahead';
import {
  hydrateWeights,
  readWeights,
  scoredFromLearned,
  weightsParam,
  type ScoredWeights,
} from '@/lib/client/weights';
import type { Channel, FingerprintField } from '@/lib/types';

const CHANNELS: Channel[] = ['A', 'B', 'C'];

/** A stable empty map for the "no votes on this seed yet" case — never a fresh object. */
const EMPTY_LABELS: Record<string, FeedbackLabel> = {};

/** A weight change re-ranks the same pool for free, but each drag tick would still re-open
 *  the SSE stream, so the URL write (which is what the stream keys on) is debounced. */
const WEIGHTS_DEBOUNCE_MS = 300;

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
  seedKey: string | null,
  sameArtist: boolean,
  corrections: Partial<Record<FingerprintField, string>>,
  weights: ScoredWeights,
  explicitWeights = false,
): string {
  const params = new URLSearchParams();
  // Weights survive a `clear` (no seed) so a mix the user is dialling in is not lost when
  // they drop back to the empty state to try another seed.
  if (seedKey) params.set('seed', seedKey);
  if (sameArtist) params.set('sameArtist', '1');
  if (Object.keys(corrections).length > 0) params.set('corrections', JSON.stringify(corrections));
  // `explicitWeights` forces the param even when the mix equals the engine default, so a
  // trained profile's learned weights are not silently re-applied by the recommend route
  // (see `weightsParam`). Set once the user has touched the panel — from then on the panel
  // is authoritative about the weights the run uses.
  const weights_ = weightsParam(weights, explicitWeights);
  if (weights_) params.set('weights', weights_);
  const query = params.toString();
  return query ? `/?${query}` : '/';
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

  // Weights ARE in the URL (share/reload keep them), but unlike corrections they also have
  // a live draft so the slider thumb tracks the drag before the debounced URL write lands.
  // `appliedWeights` (the diff the stream re-ranks on) is derived straight from the URL, and
  // the draft drives that URL — so the draft is seeded from the URL once, at mount, and
  // thereafter is the source. (Weight writes are `router.replace`, so there is no back/forward
  // history of weight states to follow, and a fresh navigation carries the draft along.)
  const weightsRaw = params.get('weights');
  const appliedWeights = useMemo(() => readWeights(weightsRaw), [weightsRaw]);
  const [weights, setWeights] = useState<ScoredWeights>(() => hydrateWeights(weightsRaw));

  // The slider updates the draft instantly; the URL (what the stream re-ranks on) follows
  // ~300ms later, so a burst of drags collapses to one replay instead of one per tick.
  const weightsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Once the user has touched the panel (dragged a slider, hit reset), the panel is the
  // authority on the run's weights: every URL write from here on must carry an explicit
  // `?weights=` — even a default one — so a trained profile's learned weights are never
  // silently substituted, and the sliders always show exactly what the ranker used.
  const panelTouched = useRef(false);
  // Any other URL write (same-artist, a correction, a new seed, clear) already carries the
  // current `weights` draft in its own runHref, so a still-pending weights-only write is
  // redundant AND dangerous: its closure captured the OLD seed/sameArtist/corrections and
  // would revert them when it fires. Cancel it before writing anything else.
  const cancelWeightsWrite = useCallback(() => {
    if (weightsTimer.current) {
      clearTimeout(weightsTimer.current);
      weightsTimer.current = null;
    }
  }, []);

  const setSameArtist = useCallback(
    (on: boolean) => {
      if (!seedKey) return;
      cancelWeightsWrite();
      router.replace(runHref(seedKey, on, corrections, weights, panelTouched.current), {
        scroll: false,
      });
    },
    [router, seedKey, corrections, weights, cancelWeightsWrite],
  );

  const setCorrections = useCallback(
    (next: Partial<Record<FingerprintField, string>>) => {
      if (!seedKey) return;
      cancelWeightsWrite();
      router.replace(runHref(seedKey, sameArtist, next, weights, panelTouched.current), {
        scroll: false,
      });
    },
    [router, seedKey, sameArtist, weights, cancelWeightsWrite],
  );

  const onWeightsChange = useCallback(
    (next: ScoredWeights) => {
      // A hand-set mix (a drag, or "reset to defaults") makes the panel authoritative: the
      // URL must carry it explicitly from now on, even at the default, so the server never
      // falls back to the profile's learned weights behind a default-looking panel.
      panelTouched.current = true;
      setWeights(next);
      if (weightsTimer.current) clearTimeout(weightsTimer.current);
      weightsTimer.current = setTimeout(() => {
        router.replace(runHref(seedKey, sameArtist, corrections, next, true), { scroll: false });
      }, WEIGHTS_DEBOUNCE_MS);
    },
    [router, seedKey, sameArtist, corrections],
  );
  useEffect(() => () => {
    if (weightsTimer.current) clearTimeout(weightsTimer.current);
  }, []);

  // The hook keys its effect on the derived URL, so a fresh object here re-opens nothing.
  const run = useRecommendStream({ seedKey, sameArtist, corrections, weights: appliedWeights });
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

  // This browser's anonymous training profile. Loaded once; `count` prints "tuned to your
  // N picks", and its learned weights become the panel baseline. A dead /api/profile just
  // leaves the panel on the engine defaults.
  //
  // Seeding the sliders happens right here in the load callback (never a setState-in-effect):
  // only when the URL isn't already carrying an explicit mix — an explicit `?weights=` always
  // wins and must show as-is — and only when the profile has trained something. No URL write:
  // with no `weights` param the recommend stream already auto-applies the learned weights
  // server-side, so the first run is personalised and the panel just displays the baseline.
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const seeded = useRef(false);
  useEffect(() => {
    let live = true;
    getProfile()
      .then((p) => {
        if (!live) return;
        setProfile(p);
        if (!seeded.current && weightsRaw === null && p.count > 0) {
          seeded.current = true;
          setWeights(scoredFromLearned(p.weights));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Mount-only: `weightsRaw` is read as it stood before any interaction, which is exactly
    // when seeding the baseline is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-candidate votes, scoped to the CURRENT seed (optimistic; the server is the record).
  // Stored WITH the seed they belong to and read back only when the seed still matches, so a
  // new seed starts clean without an effect writing state — a vote is about "matches THIS seed".
  const [votes, setVotes] = useState<{ seed: string | null; labels: Record<string, FeedbackLabel> }>({
    seed: null,
    labels: {},
  });
  const feedback = votes.seed === seedKey ? votes.labels : EMPTY_LABELS;
  const setLabel = useCallback(
    (candidateKey: string, label: FeedbackLabel | null) => {
      setVotes((prev) => {
        const base = prev.seed === seedKey ? prev.labels : {};
        const labels = { ...base };
        if (label === null) delete labels[candidateKey];
        else labels[candidateKey] = label;
        return { seed: seedKey, labels };
      });
    },
    [seedKey],
  );

  // A fresh vote re-learns the weights: adopt them as the new panel baseline and write them
  // to the URL so the stream re-opens and the pool re-ranks instantly (a free cache replay;
  // weights are out of the run-cache key). An explicit map in the URL also keeps precedence
  // unambiguous — what the panel shows is exactly what the ranker used.
  const applyLearned = useCallback(
    (result: FeedbackResult) => {
      seeded.current = true;
      setProfile((prev) =>
        prev
          ? { ...prev, weights: result.weights, count: result.count }
          : { id: '', displayName: null, weights: result.weights, count: result.count },
      );
      const next = scoredFromLearned(result.weights);
      setWeights(next);
      cancelWeightsWrite();
      router.replace(runHref(seedKey, sameArtist, corrections, next, panelTouched.current), {
        scroll: false,
      });
    },
    [router, seedKey, sameArtist, corrections, cancelWeightsWrite],
  );

  const onFeedback = useCallback(
    (candidateKey: string, label: FeedbackLabel, source: FeedbackSource) => {
      if (!seedKey) return;
      const previous = feedback[candidateKey] ?? null;
      setLabel(candidateKey, label);
      postFeedback({ seedKey, candidateKey, label, source })
        .then(applyLearned)
        .catch(() => setLabel(candidateKey, previous)); // never landed — put the button back
    },
    [seedKey, feedback, setLabel, applyLearned],
  );

  // "add a song you think matches": resolve the picked track, then vote it a match. Awaited
  // so the AddMatch control can show a pending line and surface a resolve failure.
  const onAddMatch = useCallback(
    async (hit: TypeaheadHit) => {
      if (!seedKey) throw new Error('no seed to match against');
      const track = await resolve(hit);
      const result = await postFeedback({
        seedKey,
        candidateKey: track.key,
        label: 'match',
        source: 'added',
      });
      setLabel(track.key, 'match');
      applyLearned(result);
    },
    [seedKey, setLabel, applyLearned],
  );

  const onSelect = useCallback(
    (hit: TypeaheadHit) => {
      setOpen(false);
      setResolving(true);
      setResolveError(null);
      setTyped(`${hit.title} — ${hit.artist}`);
      cancelWeightsWrite();
      resolve(hit)
        .then((track) => {
          // A new seed starts a clean run: no corrections, same-artist back to its default.
          // The weights the user dialled in before searching ride along, though.
          cancelWeightsWrite();
          router.replace(runHref(track.key, false, {}, weights, panelTouched.current), {
            scroll: false,
          });
        })
        .catch((err: unknown) => {
          setResolveError(
            `could not resolve that track — ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        })
        .finally(() => setResolving(false));
    },
    [router, weights, cancelWeightsWrite],
  );

  const onClear = useCallback(() => {
    setTyped('');
    setResolveError(null);
    cancelWeightsWrite();
    router.replace(runHref(null, false, {}, weights, panelTouched.current), { scroll: false });
  }, [router, weights, cancelWeightsWrite]);

  const credits = (
    <>
      search · previews <b>deezer</b>
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
        weightsPanel={
          <WeightsPanel
            weights={weights}
            onChange={onWeightsChange}
            variant="hero"
            tunedCount={profile?.count ?? 0}
          />
        }
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

  // "add a song you think matches" is the way to teach the engine a match it missed — which
  // is most wanted exactly when NOTHING survived verification (the common case on a keyless
  // instance). So it is one element rendered in BOTH the results header and the empty branch,
  // never only inside `ResultList` (which is absent when the pool is empty). It hides itself
  // until the seed resolves.
  const addMatch = <AddMatch onPick={onAddMatch} disabled={!resolved} />;

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

        {/* The weights filter, shut by default so the seed stays the focus. A change here
            debounces into the URL and the stream re-ranks the same scored pool for free. */}
        <WeightsPanel
          weights={weights}
          onChange={onWeightsChange}
          variant="sheet"
          tunedCount={profile?.count ?? 0}
        />

        {/* The bee bar + plain-word phase caption (the mascot rides this page too), and the
            degraded skip list folded into a small "!" badge. A hard run error stays a loud
            notice; the soft skips do not. Both sit above the seed card. */}
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
            feedback={feedback}
            onFeedback={onFeedback}
            addControl={addMatch}
          />
        ) : (
          <>
            <p className="keyhint" role="status">
              {run.streaming
                ? 'nothing scored yet — results appear as each candidate verifies, not in one burst at the end'
                : resolved
                  ? 'no candidate survived verification for this seed.'
                  : 'nothing was searched for — the seed never resolved to a track.'}
            </p>
            {/* Survives the empty pool: teach the engine the match it failed to surface. */}
            {addMatch}
          </>
        )}

        <ProvenanceFoot run={run} health={health} />
      </main>
    </>
  );
}
