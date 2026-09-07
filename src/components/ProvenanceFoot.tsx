'use client';

/**
 * "where every number on this page came from".
 *
 * Not optional furniture: **if a number appears on the page and not here, one of the two
 * is a bug** (docs/design.md §9.17). Every entry is generated from the run that is actually
 * on screen — the year and its source, the missing tempo and the reasons it is missing, the
 * raw tag counts, the per-channel funnel with its drop rates, the weights, the score
 * formula with each model score, and the ring arithmetic.
 *
 * It also carries the credits the third-party terms require, and only when the key that
 * makes them required is actually configured: Last.fm's "powered by" credit, GetSongBPM's
 * attribution backlink, and the preview sources.
 */

import {
  PREVIEW_SECONDS,
  keyProvenance,
  pct1,
  score2,
  sourceStamp,
  tempoProvenance,
} from '@/lib/client/format';
import type { Health } from '@/lib/client/api';
import type { RunState } from '@/lib/client/useRecommendStream';
import { CHANNEL_BONUS, DEFAULT_DIMENSION_WEIGHTS, ENTHUSIASM_BONUS, SCORED_DIMENSIONS } from '@/lib/engine/rank';
import { weighted } from '@/components/ResultCard';
import type { Channel } from '@/lib/types';

const CHANNELS: Channel[] = ['A', 'B', 'C'];

function weightSentence(): string {
  const parts = SCORED_DIMENSIONS.map((d) => `${d} ×${DEFAULT_DIMENSION_WEIGHTS[d] ?? 0}`);
  const total = SCORED_DIMENSIONS.reduce((sum, d) => sum + (DEFAULT_DIMENSION_WEIGHTS[d] ?? 0), 0);
  return `${parts.join(', ')}. Total weight ${total}.`;
}

/**
 * Renders one of `format.ts`'s provenance sentences with the source stamp inside it set in
 * `<code>`, the way the year and tag rows set theirs.
 *
 * The sentence is NOT re-assembled here: it is the tested string, split around a substring
 * of itself, so the marked-up row and the string the vitest suite pins can never disagree.
 * A stamp that is somehow not in the sentence just renders the sentence unmarked.
 */
function Sourced({ sentence, stamp }: { sentence: string; stamp: string }) {
  const at = sentence.indexOf(stamp);
  if (at < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, at)}
      <code>{stamp}</code>
      {sentence.slice(at + stamp.length)}
    </>
  );
}

export function ProvenanceFoot({ run, health }: { run: RunState; health: Health | null }) {
  const keys = health?.keys ?? null;
  const caps = health?.caps ?? null;
  const seed = run.seed;
  const shown = run.final ?? run.provisional;
  const tags = seed?.tags?.value ?? [];

  const funnel = CHANNELS.map((channel) => {
    const state = run.channels[channel];
    if (state.status === 'skipped') return `${channel} skipped — ${state.reason ?? 'no reason given'}`;
    const found = state.found ?? 0;
    const kept = state.kept ?? 0;
    const dropped = state.dropped ?? 0;
    if (found === 0 && kept === 0) return `${channel} contributed nothing`;
    return `${channel} found ${found}, verified ${kept}, dropped ${dropped}${
      found > 0 ? ` = ${pct1(dropped, found)}` : ''
    }`;
  });

  return (
    <section className="prov">
      <h2>where every number on this page came from</h2>
      <dl>
        {health?.gate ? (
          <>
            <dt>invite-only instance</dt>
            <dd>
              this copy is behind an access token: a link without <code>?key=</code> lands on
              the invite page, and the API answers 401 rather than running anything.
              {caps?.perDay !== null && caps !== null ? (
                <>
                  {' '}
                  It is capped at <b>{caps.perDay}</b> runs a day
                  {caps.perIpPerHour !== null ? (
                    <>
                      {' '}
                      and <b>{caps.perIpPerHour}</b> an hour from one address
                    </>
                  ) : null}
                  ; a run replayed from the cache — which is what a shared{' '}
                  <code>/?seed=</code> link is — counts against neither.
                </>
              ) : null}
            </dd>
          </>
        ) : null}

        {run.cached ? (
          <>
            <dt>this run</dt>
            <dd>
              replayed out of the run cache — the stages, the funnel and the numbers below are
              the ones the original run recorded. Nothing was fetched today, so no evidence row
              on this page is stamped <code>live</code>.
            </dd>
          </>
        ) : null}

        {seed?.year ? (
          <>
            <dt>{seed.year.value}</dt>
            <dd>
              the seed&rsquo;s year: <code>{seed.year.source.source}</code>
              {seed.year.source.field ? ` ${seed.year.source.field}` : ''}. Copied, not inferred.
            </dd>
          </>
        ) : (
          <>
            <dt>year unknown</dt>
            <dd>no source gave a first-release year for the seed. No year is shown because none was found.</dd>
          </>
        )}

        {/* The tempo and the key are the SEED RECORD's, not the fingerprint's. The
            fingerprint is a copy of them and does not exist at all on a keyless run, so a
            row that read `run.fingerprint` printed "no source returned a BPM" over a BPM
            Deezer had measured — the one place this page fabricated an absence. */}
        <dt>tempo_bpm {seed?.tempoBpm ? seed.tempoBpm.value : 'unknown'}</dt>
        <dd>
          {seed?.tempoBpm ? (
            <Sourced
              sentence={tempoProvenance(seed, keys?.getsongbpm ?? null)}
              stamp={sourceStamp(seed.tempoBpm.source)}
            />
          ) : (
            tempoProvenance(seed, keys?.getsongbpm ?? null)
          )}
        </dd>

        {seed?.keySignature ? (
          <>
            <dt>key_signature {seed.keySignature.value}</dt>
            <dd>
              <Sourced
                sentence={keyProvenance(seed) ?? ''}
                stamp={sourceStamp(seed.keySignature.source)}
              />
            </dd>
          </>
        ) : null}

        {tags.length > 0 ? (
          <>
            <dt>tag counts {tags.slice(0, 6).map((t) => t.count).join(' / ')}</dt>
            <dd>
              <code>{seed?.tags?.source.source}</code>{' '}
              <code>{seed?.tags?.source.field ?? 'tags'}</code>, raw counts as returned — not
              re-weighted, and not from Last.fm unless that source says so.
            </dd>
          </>
        ) : null}

        <dt>the channel funnel</dt>
        <dd>{funnel.join(' · ')}. Anything that did not resolve to a real track in Deezer or iTunes was dropped in verify.</dd>

        <dt>{shown.length} shown</dt>
        <dd>
          {/* A run that ended in an `error` event is over: the stream has closed and
              nothing more can land, so calling the list provisional would be false. */}
          {run.final
            ? 'the ranked list: same artist as the seed excluded unless the toggle is on, one track per artist, then the spread pass.'
            : run.error !== null
              ? 'the run stopped before anything was ranked — this count is final, not provisional.'
              : 'provisional results in arrival order — the ranked list has not landed yet, so this count can still change.'}
        </dd>

        <dt>weights</dt>
        <dd>
          the default weights in <code>engine/rank.ts</code>, applied to every candidate in a run
          unless you change them in the weights panel above: {weightSentence()}{' '}
          A trait at <code>×0</code> never touches a match.
        </dd>

        {shown.length > 0 ? (
          <>
            <dt>{shown.slice(0, 6).map((r) => score2(r.finalScore)).join(' / ')}</dt>
            <dd>
              <code>
                finalScore = modelScore + {CHANNEL_BONUS} × (channels − 1) + {ENTHUSIASM_BONUS} if a
                live forum mention is high-enthusiasm
              </code>
              , capped at 1.00. Model scores{' '}
              {shown
                .slice(0, 6)
                .map((r) => {
                  const { sum, total } = weighted(r.dimensions);
                  return score2(total === 0 ? 0 : sum / total);
                })
                .join(' / ')}
              , each the weighted mean of the per-dimension bars on that card.
            </dd>
          </>
        ) : null}

        <dt>0:00 / 0:{PREVIEW_SECONDS}</dt>
        <dd>
          the audio element&rsquo;s position against the preview clip. The ring carries{' '}
          <code>pathLength=&quot;100&quot;</code>, so elapsed ÷ {PREVIEW_SECONDS} is drawn directly
          as <code>stroke-dasharray</code> — no circumference maths, and the ring is allowed to be
          hand-drawn.
        </dd>

        {run.degraded.length > 0 ? (
          <>
            <dt>what degraded</dt>
            <dd>{run.degraded.join(' · ')}</dd>
          </>
        ) : null}

        <dt>credits</dt>
        <dd>
          previews by{' '}
          <a href="https://www.deezer.com" target="_blank" rel="noopener noreferrer">
            Deezer
          </a>{' '}
          and{' '}
          <a href="https://music.apple.com" target="_blank" rel="noopener noreferrer">
            iTunes
          </a>
          ; search and artwork by iTunes; canonical ids by{' '}
          <a href="https://musicbrainz.org" target="_blank" rel="noopener noreferrer">
            MusicBrainz
          </a>
          .
          {keys?.lastfm ? (
            <>
              {' '}
              Tags and similar tracks powered by{' '}
              <a href="https://www.last.fm" target="_blank" rel="noopener noreferrer">
                Last.fm
              </a>
              .
            </>
          ) : null}
          {keys?.getsongbpm ? (
            <>
              {' '}
              Tempo data by{' '}
              <a href="https://getsongbpm.com" target="_blank" rel="noopener noreferrer">
                GetSongBPM
              </a>
              .
            </>
          ) : null}
        </dd>
      </dl>
    </section>
  );
}
