'use client';

/**
 * One recommendation.
 *
 * Collapsed it is: rank block, artwork, title, artist · year, the `why`, the transport row
 * and the score. Expanded — native `<details>`, keyboard-operable for free — it shows the
 * per-dimension bars with their weights and the halftone remainder, a score line that
 * reconstructs the final number **exactly** from figures visible on screen, and the
 * evidence trail with a `live` or `cached` stamp on every row.
 *
 * The weights and both bonuses are imported from `engine/rank.ts`, never retyped: the
 * arithmetic printed here is the arithmetic the ranker did, or it is a bug in one of them.
 *
 * Keyboard (the list is a roving-tabindex list, see `ResultList`): ↑/↓ and j/k move between
 * cards, Space toggles play on the focused card without scrolling the page, Enter toggles
 * the working, `s` opens save.
 */

import { useCallback, useRef, useState } from 'react';

import { ArtTile } from '@/components/ArtTile';
import { Caret } from '@/components/Icons';
import {
  NoPreviewNote,
  NoPreviewTag,
  PlayButton,
  PlayTime,
  previewMode,
  SpotifyEmbed,
} from '@/components/PlayButton';
import { SavePopover } from '@/components/SavePopover';
import { evidenceStamp, rank2, score2 } from '@/lib/client/format';
import { usePlayerSnapshot, usePlayerStore } from '@/lib/client/player';
import {
  CHANNEL_BONUS,
  DIMENSION_WEIGHTS,
  ENTHUSIASM_BONUS,
  SCORED_DIMENSIONS,
} from '@/lib/engine/rank';
import type { Channel, DimensionScore, Recommendation } from '@/lib/types';

const CHANNELS: Channel[] = ['A', 'B', 'C'];

/** The weighted sum and the total weight behind it — the two numbers the score line prints. */
export function weighted(dimensions: DimensionScore[]): { sum: number; total: number } {
  let sum = 0;
  let total = 0;
  const seen = new Set<string>();
  for (const d of dimensions) {
    if (seen.has(d.dimension)) continue;
    seen.add(d.dimension);
    const w = DIMENSION_WEIGHTS[d.dimension] ?? 0;
    if (w === 0) continue;
    sum += w * Math.max(0, Math.min(1, d.score));
    total += w;
  }
  return { sum, total };
}

/** The bar fill. Acid normally, ochre below 0.50, dust for a zero-weight dimension. */
function barFill(d: DimensionScore): string {
  if ((DIMENSION_WEIGHTS[d.dimension] ?? 0) === 0) return '#A8A296';
  return d.score < 0.5 ? '#D89B2A' : '#D9F227';
}

function MatchBar({ d }: { d: DimensionScore }) {
  const pct = `${Math.round(Math.max(0, Math.min(1, d.score)) * 100)}%`;
  return (
    // No viewBox: percentage widths map to CSS pixels, so the halftone dots stay round.
    <svg className="mbar" aria-hidden="true" focusable="false">
      <rect width="100%" height="12" fill="url(#ht-rem)" />
      <rect width={pct} height="12" fill={barFill(d)} />
      <rect x={pct} width="2" height="12" fill="#EDE9DD" />
    </svg>
  );
}

function ChannelBadges({ channels }: { channels: Channel[] }) {
  return (
    <span className="chn" aria-label={`Channels ${channels.join(' and ') || 'none'}`}>
      {CHANNELS.map((c) => (
        <i key={c} className={channels.includes(c) ? c.toLowerCase() : 'off'}>
          {c}
        </i>
      ))}
    </span>
  );
}

export interface ResultCardProps {
  rec: Recommendation;
  index: number;
  /** How long the list is, so a screen reader can say "item 3 of 15". */
  setSize: number;
  seedKey: string;
  /** The id of the shortcut hint printed above the list. */
  describedBy: string;
  /** Roving tabindex: exactly one card in the list is in the tab order. */
  focused: boolean;
  onFocus: () => void;
  onMove: (delta: number) => void;
  elRef: (el: HTMLElement | null) => void;
  /**
   * Channels that actually ran this run. The run-level gate on the evidence stamps (a
   * replayed run passes none) and what rule 3's enthusiasm bonus is judged against; each
   * row's own `live`/`fetchedAt` decide the rest.
   */
  liveChannels: Channel[];
  /** Alternates the nine-slice edge geometry down the list, so no two neighbours match. */
  alt: boolean;
}

export function ResultCard({
  rec,
  index,
  setSize,
  seedKey,
  describedBy,
  focused,
  onFocus,
  onMove,
  elRef,
  liveChannels,
  alt,
}: ResultCardProps) {
  const [open, setOpen] = useState(false);
  const [saveSignal, setSaveSignal] = useState(0);
  const store = usePlayerStore();
  const snap = usePlayerSnapshot();
  const self = useRef<HTMLElement | null>(null);

  // `s` opened the popover from the card, so dismissing it puts focus back on the card —
  // otherwise the user is left on a button outside the roving list and j/k go dead.
  const returnFocus = useCallback(() => self.current?.focus(), []);

  const track = rec.track;
  const mode = previewMode(track, snap.fallback[track.key]);
  const dims = SCORED_DIMENSIONS.map((name) => rec.dimensions.find((d) => d.dimension === name)).filter(
    (d): d is DimensionScore => d !== undefined,
  );
  const { sum, total } = weighted(dims);
  const model = total === 0 ? 0 : sum / total;
  const channels = new Set(rec.channels).size;
  const multi = CHANNEL_BONUS * Math.max(0, channels - 1);
  const enthusiastic = rec.evidence.some(
    (e) => e.kind === 'forum' && e.enthusiasm === 'high' && liveChannels.includes(e.channel),
  );
  const cachedEnthusiasm = rec.evidence.some(
    (e) => e.kind === 'forum' && e.enthusiasm === 'high' && !liveChannels.includes(e.channel),
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    // Only the card itself; a keystroke inside the save field or a link is not a shortcut.
    if (event.target !== event.currentTarget) return;
    const key = event.key;
    if (key === 'ArrowDown' || key === 'j') {
      event.preventDefault();
      onMove(1);
    } else if (key === 'ArrowUp' || key === 'k') {
      event.preventDefault();
      onMove(-1);
    } else if (key === ' ' || key === 'Spacebar') {
      // Space must never scroll the page out from under the card it just started.
      event.preventDefault();
      if (mode === 'audio') void store.toggle(track);
    } else if (key === 'Enter') {
      event.preventDefault();
      setOpen((was) => !was);
    } else if (key === 's' || key === 'S') {
      event.preventDefault();
      setSaveSignal((n) => n + 1);
    }
  }

  return (
    <article
      className={alt ? 'card alt' : 'card'}
      ref={(el) => {
        self.current = el;
        elRef(el);
      }}
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={setSize}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      aria-label={`Result ${index + 1}: ${track.title} by ${track.artist}`}
      aria-describedby={describedBy}
    >
      <div className="head">
        <div className="artwrap">
          <span className="rank">{rank2(index + 1)}</span>
          <ArtTile
            src={track.artwork?.large ?? null}
            title={track.title}
            artist={track.artist}
            trackKey={track.key}
          />
        </div>

        <div>
          <h3 className="title">{track.title}</h3>
          <p className="byline">
            {track.artist} ·{' '}
            {track.year ? (
              <span className="yr">{track.year.value}</span>
            ) : (
              <span className="unk">year unknown</span>
            )}
          </p>

          <p className="why">
            {rec.why}
            {rec.sharedTraits.length > 0 ? (
              <span className="rule">shared traits: {rec.sharedTraits.join(' · ')}</span>
            ) : null}
          </p>

          <div className="tools">
            <PlayButton track={track} mode={mode} />
            {mode === 'audio' ? <PlayTime track={track} /> : <NoPreviewTag />}
            <SavePopover
              trackKey={track.key}
              why={rec.why}
              seedKey={seedKey}
              openSignal={saveSignal}
              title={track.title}
              onReturnFocus={returnFocus}
            />
            {mode === 'embed' ? <SpotifyEmbed track={track} /> : null}
            <span className="meta">
              {rec.flags.map((flag) => (
                <span className="flag" key={flag}>
                  {flag}
                </span>
              ))}
              <ChannelBadges channels={rec.channels} />
              <span className="sc">{score2(rec.finalScore)}</span>
            </span>
          </div>

          {mode === 'none' ? (
            <NoPreviewNote track={track} note={snap.fallback[track.key]?.note} />
          ) : null}

          <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary>
              <Caret />
              <span className="lbl-shut">match &amp; evidence</span>
              <span className="lbl-open">hide the working</span>
            </summary>

            <div className="expand">
              <h4>
                per-dimension match against the seed fingerprint — model scores 0.00 to 1.00, with
                the weight each one carries into the overall
              </h4>
              {dims.length === 0 ? (
                <p className="dimnote">no per-dimension scores were recorded for this track.</p>
              ) : (
                <ul className="dims">
                  {dims.map((d) => (
                    <li key={d.dimension}>
                      <span className="dn">
                        {d.dimension} <span className="w">×{DIMENSION_WEIGHTS[d.dimension] ?? 0}</span>
                      </span>
                      <MatchBar d={d} />
                      <span className="dv">{score2(d.score)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="dimnote">
                weighted sum <b>{sum.toFixed(2)}</b> over total weight <b>{total}</b> = model score{' '}
                <b>{score2(model)}</b>. Final <span className="fin">{score2(rec.finalScore)}</span> ={' '}
                <b>{score2(model)}</b> +{' '}
                {channels > 1 ? (
                  <>
                    <b>{CHANNEL_BONUS.toFixed(2)}</b> × ({channels} channels − 1) ={' '}
                    <b>{multi.toFixed(2)}</b>
                  </>
                ) : (
                  <>
                    <b>0.00</b> (single channel, no multi-channel bonus)
                  </>
                )}{' '}
                + <b>{enthusiastic ? ENTHUSIASM_BONUS.toFixed(2) : '0.00'}</b> enthusiasm bonus
                {enthusiastic
                  ? ' — a live forum mention with high enthusiasm.'
                  : cachedEnthusiasm
                    ? ' — a high-enthusiasm mention below came out of the cache, and the channel that found it did not run today, so it earns nothing.'
                    : '.'}{' '}
                <b>era ×0</b>: distance in years counts toward spread, never against a match.
              </p>

              <h4>evidence</h4>
              {rec.evidence.length === 0 ? (
                <p className="dimnote">
                  no evidence rows: nothing on record says where this candidate came from. A
                  fabricated row would be worse than an empty trail, so the trail stays empty.
                </p>
              ) : (
                <ul className="evi">
                  {rec.evidence.map((e, i) => {
                    const stamp = evidenceStamp(e, liveChannels);
                    return (
                      <li key={`${e.channel}-${e.kind}-${e.url ?? i}`}>
                        <p className="et">
                          <span className="chn">
                            <i className={liveChannels.includes(e.channel) ? e.channel.toLowerCase() : 'off'}>
                              {e.channel}
                            </i>
                          </span>
                          <span className={`stamp ${stamp.cls}`}>{stamp.text}</span>
                          {e.detail ?? e.kind.replace(/_/g, ' ')}
                          {e.enthusiasm ? ` · enthusiasm ${e.enthusiasm}` : ''}
                        </p>
                        {e.sentence ? <p className="q">{e.sentence}</p> : null}
                        {e.url ? (
                          <a href={e.url} target="_blank" rel="noopener noreferrer">
                            {e.url}
                          </a>
                        ) : (
                          <p className="none">
                            no URL: a model prior is a claim, not a source.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}
