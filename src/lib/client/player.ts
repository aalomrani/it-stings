'use client';

/**
 * The preview player: ONE `<audio>` element for the whole page, owned by the layout's
 * client provider. Only one card can play at a time — starting another stops the current
 * one — which is the whole reason this is a store and not per-card state.
 *
 * Source order per track (docs/tasks/phase2-ui.md, "Preview player"):
 *   1. `track.preview.url` (Deezer, HMAC-signed, `expiresAt` ~14 min out)
 *   2. if that has expired, or the element fires `error`: `GET /api/preview?key=` once and
 *      retry. That route re-mints from Deezer and falls back to the persisted iTunes
 *      preview, so "iTunes if that was not the source already" happens server-side, where
 *      the track row lives.
 *   3. a Spotify embed iframe, only when `track.ids.spotify` exists — rendered by the card
 *      in place of the ring.
 *   4. the "no preview" state. The card stays, the `why` is unchanged and full size.
 */

import { createContext, useContext, useSyncExternalStore } from 'react';

import { preview as mintPreview } from '@/lib/client/api';
import { PREVIEW_SECONDS } from '@/lib/client/format';
import type { TrackRecord } from '@/lib/types';

export interface PlayerFallback {
  mode: 'embed' | 'none';
  /** The mono line the card prints: exactly what failed, and the way out. */
  note: string;
}

export interface PlayerSnapshot {
  /** The track key that owns the audio element right now. */
  key: string | null;
  playing: boolean;
  /** Between the click and the first frame of audio. */
  loading: boolean;
  position: number;
  duration: number;
  /** Which source the current URL came from, for the card's stamp. */
  source: string | null;
  /** Tracks that fell out of the audio path, and why. */
  fallback: Record<string, PlayerFallback>;
}

const EMPTY: PlayerSnapshot = {
  key: null,
  playing: false,
  loading: false,
  position: 0,
  duration: PREVIEW_SECONDS,
  source: null,
  fallback: {},
};

/** Deezer signatures die at `expiresAt`; refuse anything inside two seconds of it. */
const EXPIRY_MARGIN_MS = 2_000;

export class PlayerStore {
  private listeners = new Set<() => void>();
  private snap: PlayerSnapshot = EMPTY;
  private audio: HTMLAudioElement | null = null;
  private current: TrackRecord | null = null;
  /** One re-mint per track per page load: a second failure is a real failure. */
  private retried = new Set<string>();
  /**
   * Recovery in flight, per track. A failed load raises BOTH the element's `error` event
   * and a rejection of `audio.play()`, so `recover()` is entered twice for one failure.
   * Without this, the second entry finds `retried` already set and marks the track dead
   * while the first is busy playing the re-minted clip — audible audio behind a card that
   * says "no preview" and a disabled button.
   */
  private recovering = new Map<string, Promise<void>>();
  private loadToken = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PlayerSnapshot => this.snap;

  /** The server renders the paused, empty player; hydration then matches. */
  getServerSnapshot = (): PlayerSnapshot => EMPTY;

  private set(patch: Partial<PlayerSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of this.listeners) listener();
  }

  attach(audio: HTMLAudioElement | null): void {
    if (this.audio === audio) return;
    this.audio = audio;
    if (!audio) return;
    audio.addEventListener('timeupdate', this.onTime);
    audio.addEventListener('play', this.onPlay);
    audio.addEventListener('pause', this.onPause);
    audio.addEventListener('ended', this.onEnded);
    audio.addEventListener('error', this.onError);
  }

  detach(): void {
    const audio = this.audio;
    if (!audio) return;
    audio.removeEventListener('timeupdate', this.onTime);
    audio.removeEventListener('play', this.onPlay);
    audio.removeEventListener('pause', this.onPause);
    audio.removeEventListener('ended', this.onEnded);
    audio.removeEventListener('error', this.onError);
    this.audio = null;
  }

  private onTime = (): void => {
    const audio = this.audio;
    if (!audio) return;
    // Ends at 30 s or at the clip's end, whichever comes first, then resets.
    if (audio.currentTime >= PREVIEW_SECONDS) {
      audio.pause();
      audio.currentTime = 0;
      this.set({ position: 0, playing: false });
      return;
    }
    const raw = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : PREVIEW_SECONDS;
    this.set({ position: audio.currentTime, duration: Math.min(raw, PREVIEW_SECONDS) });
  };

  private onPlay = (): void => this.set({ playing: true, loading: false });
  private onPause = (): void => this.set({ playing: false });

  private onEnded = (): void => {
    if (this.audio) this.audio.currentTime = 0;
    this.set({ playing: false, position: 0 });
  };

  private onError = (): void => {
    const track = this.current;
    if (!track) return;
    void this.recover(track);
  };

  /** A URL we are allowed to hand the element right now, or null. */
  private usable(track: TrackRecord): string | null {
    const p = track.preview;
    if (!p) return null;
    if (p.expiresAt !== null && p.expiresAt - EXPIRY_MARGIN_MS <= Date.now()) return null;
    return p.url;
  }

  private async mint(track: TrackRecord): Promise<{ url: string; source: string } | null> {
    try {
      const res = await mintPreview(track.key);
      if (res.url) return { url: res.url, source: res.source?.source ?? 'deezer' };
    } catch {
      // The route answers JSON for every failure; a thrown error here means the app's own
      // server is unreachable, which the fallback note below states plainly.
    }
    return null;
  }

  /**
   * Why there is nothing to play. The two cases are different claims and the note may not
   * confuse them: `no-source` means the sources were asked and had no preview;
   * `load-failed` means one of them handed over a URL that would not load. Saying the
   * first when the second happened is a claim about Deezer and iTunes that was never
   * checked — on a page whose whole thesis is that every claim names its source.
   */
  private fallbackFor(track: TrackRecord, reason: 'no-source' | 'load-failed'): PlayerFallback {
    const failed =
      'deezer returned a preview URL but it would not load (an expired signature, or the ' +
      'network) — re-minted once and it still failed.';
    if (track.ids.spotify) {
      return {
        mode: 'embed',
        note:
          reason === 'load-failed'
            ? `${failed} Playing the spotify embed instead.`
            : 'deezer: no preview · itunes: no previewUrl — playing the spotify embed instead.',
      };
    }
    return {
      mode: 'none',
      note:
        reason === 'load-failed'
          ? `${failed} There is no spotify id on this record to embed.`
          : 'deezer: no preview · itunes: no previewUrl · no spotify id to embed.',
    };
  }

  private markFallback(track: TrackRecord, reason: 'no-source' | 'load-failed'): void {
    // A track that is audibly playing is not a track without a preview. Only one of the
    // two recoveries a single failure raises can win, and it is the one that got audio.
    const audio = this.audio;
    if (audio && !audio.paused && this.current?.key === track.key) return;
    this.set({
      key: null,
      playing: false,
      loading: false,
      position: 0,
      source: null,
      fallback: { ...this.snap.fallback, [track.key]: this.fallbackFor(track, reason) },
    });
  }

  /**
   * The element errored (an expired signature looks exactly like a tampered URL).
   *
   * Re-entrant by design: both callers await the SAME recovery rather than racing each
   * other, so a single dead URL produces a single outcome.
   */
  private recover(track: TrackRecord): Promise<void> {
    const live = this.recovering.get(track.key);
    if (live) return live;
    const attempt = this.attemptRecover(track).finally(() => {
      this.recovering.delete(track.key);
    });
    this.recovering.set(track.key, attempt);
    return attempt;
  }

  private async attemptRecover(track: TrackRecord): Promise<void> {
    if (this.retried.has(track.key)) {
      this.markFallback(track, 'load-failed');
      return;
    }
    this.retried.add(track.key);
    const minted = await this.mint(track);
    if (!minted || !this.audio || this.current?.key !== track.key) {
      this.markFallback(track, minted ? 'load-failed' : 'no-source');
      return;
    }
    this.audio.src = minted.url;
    this.set({ key: track.key, source: minted.source, loading: true });
    try {
      await this.audio.play();
    } catch {
      this.markFallback(track, 'load-failed');
    }
  }

  /** Play this track, or pause it if it is already the one playing. */
  async toggle(track: TrackRecord): Promise<void> {
    const audio = this.audio;
    if (!audio) return;

    if (this.snap.key === track.key) {
      // Ask the ELEMENT, not the snapshot: between `play()` resolving and the `play` event
      // reaching React, `snap.playing` is still false, and a second press in that window
      // must stop the clip rather than start it a second time.
      if (!audio.paused) {
        audio.pause();
      } else {
        try {
          await audio.play();
        } catch {
          await this.recover(track);
        }
      }
      return;
    }

    // Starting another stops the current one. Always.
    audio.pause();
    audio.currentTime = 0;
    this.current = track;
    const token = ++this.loadToken;

    let url = this.usable(track);
    // Widened to `string`: `/api/preview` answers with its own source name, which is a
    // plain string on the wire, not the record's narrowed `SourceName`.
    let source: string | null = track.preview?.source.source ?? null;
    if (!url) {
      this.set({ key: track.key, playing: false, loading: true, position: 0, source: null });
      const minted = await this.mint(track);
      if (token !== this.loadToken) return;
      if (!minted) {
        this.markFallback(track, 'no-source');
        return;
      }
      url = minted.url;
      source = minted.source;
    }

    audio.src = url;
    this.set({
      key: track.key,
      playing: false,
      loading: true,
      position: 0,
      duration: PREVIEW_SECONDS,
      source,
    });
    try {
      await audio.play();
    } catch {
      // Autoplay policy or a dead URL: recover() re-mints once, then falls back.
      await this.recover(track);
    }
  }

  stop(): void {
    this.audio?.pause();
    this.set({ playing: false });
  }
}

export const PlayerContext = createContext<PlayerStore | null>(null);

export function usePlayerStore(): PlayerStore {
  const store = useContext(PlayerContext);
  if (!store) throw new Error('usePlayerStore must be used inside <PlayerProvider>');
  return store;
}

/** The whole player state. One store, one subscription, every card re-reads it. */
export function usePlayerSnapshot(): PlayerSnapshot {
  const store = usePlayerStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
