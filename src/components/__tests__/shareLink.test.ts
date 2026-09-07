/**
 * The link the "copy link" control puts on the clipboard.
 *
 * Deliberately the bare seed: not the address bar, which may carry this listener's
 * same-artist toggle and their fingerprint corrections. The bare seed is also the URL that
 * is already in the `runs` cache, so the recipient's run replays instantly and is charged
 * against neither cost cap.
 */

import { describe, expect, it } from 'vitest';

import { shareUrl } from '@/components/ShareLink';

describe('shareUrl', () => {
  it('is <origin>/?seed=<key>, with the key encoded', () => {
    expect(shareUrl('https://itstings.fly.dev', 'isrc:GBAAM8300010')).toBe(
      'https://itstings.fly.dev/?seed=isrc%3AGBAAM8300010',
    );
    expect(shareUrl('http://localhost:3000', 'deezer:3135556')).toBe(
      'http://localhost:3000/?seed=deezer%3A3135556',
    );
  });

  it('carries no other run options — the recipient gets the track, not my reading of it', () => {
    const url = shareUrl('https://itstings.fly.dev', 'isrc:GBAAM8300010');
    expect(url).not.toContain('corrections');
    expect(url).not.toContain('sameArtist');
    // And never the invite token, which lives in a cookie by then.
    expect(url).not.toContain('key=');
  });

  it('does not double the slash when the origin has a trailing one', () => {
    expect(shareUrl('https://itstings.fly.dev/', 'x')).toBe('https://itstings.fly.dev/?seed=x');
  });
});
