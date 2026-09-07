'use client';

/**
 * "copy link" — the one control on the results header that is about somebody else.
 *
 * The link it copies is deliberately the bare seed: `<origin>/?seed=<key>`. Not the URL in
 * the address bar, which may carry this listener's same-artist toggle and their
 * corrections — those are their reading of the track, not a fact about it. The bare seed
 * is also the URL the recipient's run is cheapest on: the same seed with default options
 * is the run that is already in the `runs` cache, so it replays instantly and costs the
 * instance nothing.
 *
 * The confirmation is a mono word next to the button, in a live region so it is announced
 * rather than only seen. If the clipboard refuses (Safari without a user gesture, an
 * insecure origin, a permission policy), the page says so and prints the link to copy by
 * hand — it never claims a copy that did not happen.
 */

import { useState } from 'react';

export interface ShareLinkProps {
  seedKey: string;
  /** Test seam: the browser's clipboard by default. */
  copy?: (text: string) => Promise<void>;
  /** Test seam: `location.origin` by default. */
  origin?: string;
}

/** `https://itstings.fly.dev/?seed=isrc%3AGBAAM8300010`. */
export function shareUrl(origin: string, seedKey: string): string {
  return `${origin.replace(/\/+$/, '')}/?seed=${encodeURIComponent(seedKey)}`;
}

async function toClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
  await navigator.clipboard.writeText(text);
}

export function ShareLink({ seedKey, copy = toClipboard, origin }: ShareLinkProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [link, setLink] = useState('');

  async function onClick() {
    // Read the origin at click time: this component renders on the server too, where
    // there is no `location`, and the link must be the one the reader is actually on.
    const base = origin ?? (typeof location === 'undefined' ? '' : location.origin);
    const url = shareUrl(base, seedKey);
    setLink(url);
    try {
      await copy(url);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <span className="share">
      <button className="btn bare" type="button" onClick={() => void onClick()}>
        copy link
      </button>
      <span className="share-note" role="status">
        {state === 'copied' ? 'copied' : null}
        {state === 'failed' ? (
          <>
            could not reach the clipboard — <code>{link}</code>
          </>
        ) : null}
      </span>
    </span>
  );
}
