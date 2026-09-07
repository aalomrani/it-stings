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
        d="M2.4 3.1 C8 2.2 16 3.4 21.4 2.4 C22.3 8 21.2 16 22 21.5 C16 22.4 8 21.1 2.6 22 C1.7 16 2.9 8 2.4 3.1 Z"
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
        d="M0 0 L9 0 L5 42 L11 96 L4 150 L10 206 L3 258 L9 312 L4 366 L11 420 L5 474 L10 528 L3 582 L9 636 L4 690 L10 744 L5 800 L0 800 Z"
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
        d="M0 4 L60 1 L120 7 L180 2 L240 8 L300 3 L360 7 L420 1 L480 6 L540 2 L600 8 L660 3 L720 7 L780 1 L840 6 L900 2 L960 8 L1020 3 L1080 7 L1140 2 L1200 5 L1200 9 L0 9 Z"
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
          d="M0 18 L48 12 L96 20 L150 11 L206 21 L262 13 L318 22 L372 12 L430 19 L486 10 L540 21 L598 13 L654 20 L710 11 L766 22 L822 14 L878 19 L934 10 L990 20 L1046 13 L1102 21 L1156 12 L1200 18 L1200 154 L1150 160 L1096 151 L1042 161 L986 152 L932 162 L878 153 L822 159 L768 150 L714 161 L658 152 L604 162 L548 153 L494 160 L438 151 L384 161 L328 152 L274 159 L218 150 L164 161 L108 152 L54 160 L0 152 Z"
          fill="#E33127"
        />
        <path
          d="M0 10 L48 4 L96 12 L150 3 L206 13 L262 5 L318 14 L372 4 L430 11 L486 2 L540 13 L598 5 L654 12 L710 3 L766 14 L822 6 L878 11 L934 2 L990 12 L1046 5 L1102 13 L1156 4 L1200 10 L1200 146 L1150 152 L1096 143 L1042 153 L986 144 L932 154 L878 145 L822 151 L768 142 L714 153 L658 144 L604 154 L548 145 L494 152 L438 143 L384 153 L328 144 L274 151 L218 142 L164 153 L108 144 L54 152 L0 144 Z"
          fill="#EDE9DD"
        />
      </svg>
    );
  }
  return (
    <svg className="bar-bg" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 16 L52 10 L104 18 L158 9 L214 19 L270 11 L326 20 L382 10 L440 17 L496 8 L552 19 L608 11 L664 18 L720 9 L776 20 L832 12 L888 17 L944 8 L1000 18 L1056 11 L1112 19 L1160 10 L1200 16 L1200 114 L1150 120 L1096 111 L1042 121 L986 112 L932 122 L878 113 L822 119 L768 110 L714 121 L658 112 L604 122 L548 113 L494 120 L438 111 L384 121 L328 112 L274 119 L218 110 L164 121 L108 112 L54 120 L0 112 Z"
        fill="#E33127"
      />
      <path
        d="M0 8 L52 2 L104 10 L158 1 L214 11 L270 3 L326 12 L382 2 L440 9 L496 0 L552 11 L608 3 L664 10 L720 1 L776 12 L832 4 L888 9 L944 0 L1000 10 L1056 3 L1112 11 L1160 2 L1200 8 L1200 106 L1150 112 L1096 103 L1042 113 L986 104 L932 114 L878 105 L822 111 L768 102 L714 113 L658 104 L604 114 L548 105 L494 112 L438 103 L384 113 L328 104 L274 111 L218 102 L164 113 L108 104 L54 112 L0 104 Z"
        fill="#EDE9DD"
      />
    </svg>
  );
}
