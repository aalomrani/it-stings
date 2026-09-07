'use client';

/**
 * Play control, progress ring and the two ways a track can have no audio.
 *
 * The ring is the hand-inked `#ring` path carrying `pathLength="100"`, so elapsed is
 * literally `stroke-dasharray:"{pct} {100-pct}"` — no circumference maths in the component
 * and no perfect `<circle>` breaking the direction's own rule. The path is authored at 12
 * o'clock running clockwise, so it needs no `rotate(-90)`.
 *
 * Reduced motion changes nothing here: the ring still advances with `audio.currentTime`.
 * It was never a boil.
 */

import { dash, mss, PREVIEW_SECONDS } from '@/lib/client/format';
import { usePlayerSnapshot, usePlayerStore, type PlayerFallback } from '@/lib/client/player';
import type { TrackRecord } from '@/lib/types';

const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;

export type PreviewMode = 'audio' | 'embed' | 'none';

/** What this card can do about audio right now. */
export function previewMode(track: TrackRecord, fallback: PlayerFallback | undefined): PreviewMode {
  if (fallback) return fallback.mode;
  if (track.preview) return 'audio';
  return track.ids.spotify && SPOTIFY_ID.test(track.ids.spotify) ? 'embed' : 'none';
}

export function PlayButton({ track, mode }: { track: TrackRecord; mode: PreviewMode }) {
  const store = usePlayerStore();
  const snap = usePlayerSnapshot();
  const current = snap.key === track.key;
  const playing = current && snap.playing;
  const elapsed = current ? snap.position : 0;

  if (mode !== 'audio') {
    return (
      <button
        className="play"
        type="button"
        disabled
        aria-label={`No preview available for ${track.title}`}
      >
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <use href="#ring" fill="none" stroke="#A8A296" strokeWidth="3" strokeDasharray="5 6" opacity="0.6" />
          <path d="M13 35 L35 13" stroke="#E33127" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  const label = playing
    ? `Pause preview of ${track.title}, ${Math.floor(elapsed)} seconds of 30 elapsed`
    : `Play 30 second preview of ${track.title}`;

  return (
    <button
      className="play"
      type="button"
      aria-label={label}
      aria-pressed={playing}
      onClick={() => void store.toggle(track)}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <use href="#ring" fill="none" stroke="#EDE9DD" strokeWidth="4" opacity="0.24" />
        {current && elapsed > 0 ? (
          <use
            href="#ring"
            fill="none"
            stroke="#D9F227"
            strokeWidth="4"
            strokeDasharray={dash(elapsed, snap.duration || PREVIEW_SECONDS)}
            strokeLinecap="butt"
          />
        ) : null}
        {playing ? (
          <path
            d="M19.5 16 L19.5 32 M28.5 16 L28.5 32"
            stroke="#EDE9DD"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
        ) : (
          <path d="M19 15 L34 24 L19 33 Z" fill="#EDE9DD" />
        )}
      </svg>
    </button>
  );
}

/** `0:11 / 0:30`. The elapsed number is acid, the total is dust: one is measured, one is fixed. */
export function PlayTime({ track }: { track: TrackRecord }) {
  const snap = usePlayerSnapshot();
  const elapsed = snap.key === track.key ? snap.position : 0;
  return (
    <span className="time">
      {mss(elapsed)}
      <span className="tot"> / {mss(PREVIEW_SECONDS)}</span>
    </span>
  );
}

/** The ochre tag beside a dead transport. Colour never carries the meaning: it says the word. */
export function NoPreviewTag() {
  return <span className="nop">no preview</span>;
}

export function spotifySearchUrl(track: TrackRecord): string {
  return (
    track.links.spotify ??
    `https://open.spotify.com/search/${encodeURIComponent(`${track.artist} ${track.title}`)}`
  );
}

export function appleSearchUrl(track: TrackRecord): string {
  return (
    track.links.itunes ??
    `https://music.apple.com/search?term=${encodeURIComponent(`${track.artist} ${track.title}`)}`
  );
}

/**
 * The "no preview" line: exactly what failed, then the way out. The card does not
 * disappear, does not grey out, and the `why` above it is unchanged and full size.
 */
export function NoPreviewNote({ track, note }: { track: TrackRecord; note?: string }) {
  return (
    <p className="nop-note">
      {note ?? 'deezer: no preview · itunes: no previewUrl · no spotify id to embed.'} The card
      stays —{' '}
      <a href={spotifySearchUrl(track)} target="_blank" rel="noopener noreferrer">
        open it on spotify
      </a>{' '}
      or{' '}
      <a href={appleSearchUrl(track)} target="_blank" rel="noopener noreferrer">
        on apple music
      </a>
      .
    </p>
  );
}

/** The last resort before "no preview": the Spotify embed, in place of the ring, 80px tall. */
export function SpotifyEmbed({ track }: { track: TrackRecord }) {
  const id = track.ids.spotify;
  if (!id || !SPOTIFY_ID.test(id)) return null;
  return (
    <iframe
      className="embed"
      src={`https://open.spotify.com/embed/track/${id}`}
      title={`Spotify player for ${track.title} by ${track.artist}`}
      loading="lazy"
      allow="encrypted-media"
    />
  );
}
