/**
 * An artwork tile: a `--raised` square, the real thumbnail when we have one, a halftone
 * screen over it, and a drawn tile edge. The edge is the ONE sanctioned `<use>`-stretched
 * frame in the system, legal because the box is fixed-aspect and cannot amplify a wobble.
 *
 * With no thumbnail the tile falls back to a hand-drawn ink motif — the same five the
 * mockups use — chosen by a stable hash of the track key, so a card keeps its motif across
 * re-renders and the one-step re-sort when `final` lands.
 *
 * `#xerox` is only ever put on a motif, never on the photograph, and only while the page's
 * filter budget allows it (docs/design.md §4.2: ≤ 8 filtered surfaces, results.html uses 6).
 */

const MOTIFS = [
  // a fish hook
  <g key="hook">
    <path
      d="M62 12 L62 44 C62 62 48 74 34 70 C22 66 18 52 26 44 C32 38 42 39 44 47"
      fill="none"
      stroke="#EDE9DD"
      strokeWidth="6.5"
      strokeLinecap="round"
    />
    <path d="M54 10 L70 10" fill="none" stroke="#EDE9DD" strokeWidth="6.5" strokeLinecap="round" />
    <path d="M44 47 L52 40" fill="none" stroke="#E33127" strokeWidth="5" strokeLinecap="round" />
  </g>,
  // a flame
  <g key="flame">
    <path
      d="M50 12 C62 30 74 40 72 58 C70 76 60 86 48 86 C34 86 26 74 28 60 C30 48 40 44 44 34 C46 28 46 20 50 12 Z"
      fill="#E33127"
    />
    <path
      d="M50 40 C56 50 60 56 58 66 C56 76 50 80 44 78 C38 76 36 68 40 60 C43 54 48 50 50 40 Z"
      fill="#D9F227"
    />
  </g>,
  // a trumpet bell
  <g key="bell">
    <path d="M20 50 L54 50 L84 22 C90 34 90 66 84 78 L54 52 L20 52 Z" fill="#EDE9DD" />
    <circle cx="24" cy="51" r="9" fill="#D9F227" />
    <path
      d="M62 34 L70 30 M64 68 L72 72"
      stroke="#E33127"
      strokeWidth="4"
      strokeLinecap="round"
      fill="none"
    />
  </g>,
  // three scratch marks
  <g key="scratch">
    <path d="M22 18 C34 38 44 60 48 84" fill="none" stroke="#EDE9DD" strokeWidth="7" strokeLinecap="round" />
    <path d="M42 14 C54 34 64 56 68 80" fill="none" stroke="#D9F227" strokeWidth="7" strokeLinecap="round" />
    <path d="M62 20 C72 38 80 56 84 76" fill="none" stroke="#EDE9DD" strokeWidth="6" strokeLinecap="round" />
  </g>,
  // a crescent
  <g key="crescent">
    <path
      d="M64 14 C40 20 26 38 28 58 C30 78 48 90 68 86 C50 76 42 60 46 44 C49 32 55 22 64 14 Z"
      fill="#D89B2A"
    />
    <circle cx="74" cy="34" r="6" fill="#EDE9DD" />
  </g>,
  // a curl of smoke
  <g key="smoke">
    <path
      d="M32 88 C32 72 56 70 56 56 C56 44 34 44 34 32 C34 20 54 18 62 24"
      fill="none"
      stroke="#EDE9DD"
      strokeWidth="7"
      strokeLinecap="round"
    />
    <circle cx="66" cy="20" r="6" fill="#E33127" />
  </g>,
];

const MOTIF_NAMES = [
  'a drawn fish hook',
  'a drawn flame',
  'a drawn trumpet bell',
  'three drawn scratch marks',
  'a drawn crescent',
  'a drawn curl of smoke',
];

/** Stable per-key choice: the same track always draws the same motif. */
export function hashIndex(key: string, buckets: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % buckets;
}

export interface ArtTileProps {
  src: string | null;
  title: string;
  artist: string;
  trackKey: string;
  /** false past the page's filter budget — the motif is drawn without `#xerox`. */
  allowFilter?: boolean;
  className?: string;
}

export function ArtTile({ src, title, artist, trackKey, allowFilter = false, className }: ArtTileProps) {
  const motif = hashIndex(trackKey, MOTIFS.length);
  const screen = motif % 2 === 0 ? 'url(#ht-acid)' : 'url(#ht-bone)';
  const label = src
    ? `Artwork for ${title} by ${artist}`
    : `No artwork — ${MOTIF_NAMES[motif]} stands in for ${title} by ${artist}`;

  return (
    <svg
      className={className ? `art ${className}` : 'art'}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
    >
      <path d="M2.6 2.4 L97.4 1.6 L98.4 97.8 L1.8 98.6 Z" fill="#241F1A" />
      {src ? (
        <image
          href={src}
          x="2"
          y="2"
          width="96"
          height="96"
          preserveAspectRatio="xMidYMid slice"
        />
      ) : null}
      <rect x="2" y="2" width="96" height="96" fill={screen} opacity={src ? 0.16 : 0.2} />
      {src ? null : allowFilter ? (
        <g filter="url(#xerox)">{MOTIFS[motif]}</g>
      ) : (
        <g>{MOTIFS[motif]}</g>
      )}
      <use href="#tile-edge" stroke="#EDE9DD" strokeWidth="1.6" fill="none" />
    </svg>
  );
}
