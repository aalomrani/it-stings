'use client';

/**
 * The same-artist toggle. A real `<input type="checkbox">`, visually hidden, with a
 * hand-drawn 22px box beside it: a wobbly dust square and an acid tick that is a two-stroke
 * marker gesture, not a geometric check. The focus ring is drawn on the adjacent `.box`
 * (`input:focus-visible + .box`), so the control is never invisible to the keyboard.
 *
 * State is spelled out in words (`off` / `on`) beside the label — colour never carries
 * meaning alone — and the rule the toggle changes is printed next to it, because the bar a
 * same-artist track has to clear is the whole reason the default is off.
 */

import { CheckBox } from '@/components/Icons';
import { SAME_ARTIST_MIN_SCORE } from '@/lib/engine/rank';

export function SameArtistToggle({
  artist,
  on,
  onChange,
}: {
  artist: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="controls">
      <label className="toggle">
        <input
          type="checkbox"
          name="sameArtist"
          checked={on}
          onChange={(event) => onChange(event.target.checked)}
        />
        <CheckBox />
        <span className="lab">include tracks by {artist}</span>
        <span className="st">{on ? 'on' : 'off'}</span>
      </label>
      <p className="rule-note">
        off is the default. Switched on, a same-artist track has to clear{' '}
        {SAME_ARTIST_MIN_SCORE.toFixed(2)} on its own and justify itself on musical grounds —
        decade and band name do not count.
      </p>
    </div>
  );
}
