/**
 * The shared `<defs>` block: two filters, three halftone screens, the square tile edge and
 * the hand-inked progress ring. Authored once in the layout and instanced with `<use>` /
 * `url(#…)` everywhere else, exactly as the mockups do it.
 *
 * Filter budget (docs/design.md §4.2): `#xerox` is allowed on the wasp, the sting frames
 * and the ink motif inside an artwork tile, never on anything holding text, and never more
 * than eight filtered surfaces on a rendered page.
 */
export function SvgDefs() {
  return (
    <svg className="defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {/* photocopy wobble: no edge of the drawing is mathematically straight */}
        <filter
          id="xerox"
          x="-6%"
          y="-6%"
          width="112%"
          height="112%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.026 0.033"
            numOctaves="3"
            seed="17"
            result="wob"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="wob"
            scale="4"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* toner speckle: alpha = 1.6R − 0.62, so only the top ~38% of the noise field
            survives — hard specks, not a grey haze */}
        <filter id="toner" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.74" numOctaves="4" seed="5" result="n" />
          <feColorMatrix
            in="n"
            type="matrix"
            values="0 0 0 0 0.929  0 0 0 0 0.914  0 0 0 0 0.866  1.6 0 0 0 -0.62"
          />
        </filter>

        {/* halftone screens, rotated off-axis so they read as a misregistered separation
            and not as a CSS pattern */}
        <pattern
          id="ht-acid"
          width="9"
          height="9"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(18)"
        >
          <circle cx="4.5" cy="4.5" r="2.05" fill="#D9F227" />
        </pattern>
        <pattern
          id="ht-bone"
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-24)"
        >
          <circle cx="3.5" cy="3.5" r="1.35" fill="#EDE9DD" />
        </pattern>
        {/* the unscored remainder of a match bar. Texture doing data work.
            Nothing is ever set on top of it. */}
        <pattern
          id="ht-rem"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-24)"
        >
          <circle cx="3" cy="3" r="1.5" fill="#A8A296" fillOpacity="0.40" />
        </pattern>

        {/* square artwork-tile edge. A <use>-stretched edge is legal ONLY on a fixed-aspect
            box like this one; everywhere else the frame is the nine-slice border-image. */}
        <path
          id="tile-edge"
          vectorEffect="non-scaling-stroke"
          d="M1.6 2.2 C20 1.0 44 2.4 66 1.4 C80 0.8 92 1.9 98.5 1.8 C99.1 20 98.3 46 98.8 68 C99.1 82 98.0 94 98.3 98.0 C78 99.2 52 97.8 30 98.8 C16 99.4 6 98.2 1.5 98.4 C0.9 80 1.8 54 1.2 32 C0.9 18 2.0 6 1.6 2.2 Z"
        />

        {/* the hand-inked ring. pathLength="100" means elapsed is literally
            stroke-dasharray:"{pct} {100-pct}" — no circumference maths, and the ring is
            allowed to be wonky. Authored at 12 o'clock, clockwise: no rotate(-90). */}
        <path
          id="ring"
          pathLength="100"
          d="M24 5.4 C32.2 5.1 42.1 12.6 42.6 23.2 C43.1 34.4 33.6 43.2 23.4 42.6 C13.2 42 5.1 33.8 5.5 23.4 C5.9 13.4 15.4 5.8 24 5.4 Z"
        />
      </defs>
    </svg>
  );
}
