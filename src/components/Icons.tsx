/**
 * Every mark on the page is drawn. No icon font, no icon set, no glyph standing alone as
 * the only meaning — each of these sits next to a word. Paths are ported from the mockups.
 */

/** A wobbly bone tick: a finished stage. */
export function Tick() {
  return (
    <svg className="tick" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 8.4 C4 10 5.4 12 6.6 14 C8.8 9 11 5 14.6 1.8"
        fill="none"
        stroke="#EDE9DD"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A dust hollow circle: a stage that has not run. */
export function Hollow() {
  return (
    <svg className="tick" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="#A8A296" strokeWidth="1.6" />
    </svg>
  );
}

/** A blood cross: a stage that errored. */
export function Cross() {
  return (
    <svg className="tick" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.2 3 C6 6 9.4 9.6 12.8 13.2 M12.6 3.2 C9.6 6.2 6.2 9.8 3.4 12.8"
        fill="none"
        stroke="#F04438"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The results page's one stepped-motion moment: an ink blot spreading through three drawn
 * frames, 1.2 s, three equal thirds, cut not faded. Reduced motion pins frame 2.
 */
export function Blot() {
  return (
    <svg className="blot" viewBox="0 0 18 18" aria-hidden="true">
      <g className="fr f1">
        <path
          d="M9 5.2 C11.1 5 12.6 6.5 12.4 8.4 C12.2 10.4 10.6 11.6 8.8 11.3 C7 11 5.8 9.6 6.1 7.9 C6.3 6.4 7.4 5.3 9 5.2 Z"
          fill="#D9F227"
        />
      </g>
      <g className="fr f2">
        <path
          d="M9 3.2 C12 2.8 14.6 5.2 14.3 8.3 C14 11.6 11.4 13.6 8.4 13.2 C5.5 12.8 3.6 10.4 4 7.6 C4.4 5 6.4 3.4 9 3.2 Z"
          fill="#D9F227"
        />
        <circle cx="15.2" cy="4.4" r="1.1" fill="#D9F227" />
      </g>
      <g className="fr f3">
        <path
          d="M8.7 1.6 C12.6 1.1 16.4 4 16 8.2 C15.6 12.6 12.2 15.6 8.2 15.1 C4.2 14.6 1.4 11.3 1.9 7.4 C2.4 3.8 5 1.9 8.7 1.6 Z"
          fill="#D9F227"
        />
        <circle cx="2.3" cy="15.2" r="1.3" fill="#D9F227" />
        <circle cx="16.4" cy="14.2" r="0.9" fill="#D9F227" />
      </g>
    </svg>
  );
}

/** The disclosure caret: a drawn ink stroke that rotates 90°, never a chevron glyph. */
export function Caret() {
  return (
    <svg className="caret" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M3.4 1.2 C5.6 3 7.8 4.8 9.6 6.2 C7.6 7.6 5.4 9.2 3.2 10.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The toggle's hand-drawn box: a wobbly dust square and a two-stroke marker tick. */
export function CheckBox() {
  return (
    <svg className="box" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2.5 2.5 H21.5 V21.5 H2.5 Z"
        fill="none"
        stroke="#A8A296"
        strokeWidth="1.8"
      />
      <path
        className="on"
        d="M5 12 C7 13.6 8.6 16 9.6 18.4 C13 11.6 16.4 7 20 4.2"
        fill="none"
        stroke="#D9F227"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The registration mark in the empty state's top-right corner. */
export function RegMark() {
  return (
    <svg className="regmark" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="12.4" fill="none" stroke="#A8A296" strokeWidth="1.4" />
      <path d="M20 1 L20 15 M20 25 L20 39 M1 20 L15 20 M25 20 L39 20" stroke="#A8A296" strokeWidth="1.4" />
      <path d="M20 3 L20 14" stroke="#E33127" strokeWidth="1.4" transform="translate(2,1)" />
    </svg>
  );
}

/** The torn left margin of the empty state. */
export function TornEdge() {
  return (
    <svg className="tornedge" viewBox="0 0 14 800" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 0 H14 V800 H0 Z"
        fill="#1D1A16"
      />
    </svg>
  );
}

/** The torn rule under a section heading. Legal `preserveAspectRatio="none"`: fixed height. */
export function Tear() {
  return (
    <svg className="tear" viewBox="0 0 1200 9" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 2 H1200 V7 H0 Z"
        fill="#EDE9DD"
        opacity="0.28"
      />
    </svg>
  );
}

/** The drawn stinger glyph at the right end of the hero strip. */
export function StingerMark() {
  return (
    <svg className="slot-mark" viewBox="0 0 60 60" aria-hidden="true">
      <path d="M8 10 C24 14 40 26 52 46 L44 52 C34 34 20 22 6 18 Z" fill="#17140F" />
      <circle cx="52" cy="49" r="5" fill="#E33127" />
    </svg>
  );
}

/**
 * The strip of photocopy paper: two torn paths in one svg, the lower in blood offset 8px,
 * the upper in bone. Misregistration, with a red cut-line peeking out underneath.
 * `preserveAspectRatio="none"` is legal here and only here because the strip's height is
 * fixed by CSS, so a content-sized box can never amplify the wobble.
 */
export function PaperStrip({ variant }: { variant: 'hero' | 'bar' }) {
  if (variant === 'hero') {
    return (
      <svg className="slot-bg" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M0 12 H1200 V160 H0 Z"
          fill="#E33127"
        />
        <path
          d="M0 4 H1200 V152 H0 Z"
          fill="#EDE9DD"
        />
      </svg>
    );
  }
  return (
    <svg className="bar-bg" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 12 H1200 V120 H0 Z"
        fill="#E33127"
      />
      <path
        d="M0 4 H1200 V112 H0 Z"
        fill="#EDE9DD"
      />
    </svg>
  );
}
