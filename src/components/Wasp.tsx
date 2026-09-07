/**
 * The wasp — the empty state's one big drawing, ported verbatim from
 * `docs/design/final/empty.html`.
 *
 * Filled bone masses with detail knocked back out in ground colour; a fat brush pen leaves
 * masses, not hairlines. Where a stroke really is a stroke it tapers by splitting one
 * gesture into sub-paths at different `strokeWidth`. No circles, no symmetry about any
 * axis, three near legs plus one long trailing hind leg, and nothing knocked out of the
 * inside of the thorax — the creature is allowed exactly one face.
 *
 * Authored ONCE as `#wasp-body` and instanced twice with `<use>`: a landscape crop
 * (`0 0 1600 1000`, ≥681px) and a portrait crop (`900 -30 560 1120`, ≤680px), both
 * `preserveAspectRatio="xMidYMid slice"`. The sting frames are written inline per instance
 * because CSS selectors do not reach into `<use>` shadow content and the frames animate.
 *
 * The speckle is masked to the drawing's own geometry (`#m-wasp`): a full-viewBox toner
 * rect painted a visible grey card. The mask instance is deliberately unfiltered while the
 * visible one carries `#xerox` — the few-pixel disagreement is a misregistered speckle
 * plate, and it costs one filter region instead of two.
 */

/** The three-frame sting. Frame 1 rests at y 668, frames 2–3 drive to y 860 — both well
 *  below the strip's lower edge, so the one moving thing on the page is never buried by
 *  the search bar, and frame 3's bead at y 901 stays inside the 1000-unit viewBox. */
function Sting() {
  return (
    <g className="sting" filter="url(#xerox)">
      <g className="fr f1">
        <path d="M1368 448 L1332 668 L1276 470 Z" fill="#EDE9DD" />
      </g>
      <g className="fr f2">
        <path d="M1368 448 L1250 860 L1276 470 Z" fill="#EDE9DD" />
        <path d="M1320 692 L1360 710 L1310 720 Z" fill="#EDE9DD" />
        <path d="M1294 772 L1332 790 L1284 798 Z" fill="#EDE9DD" />
        <path
          d="M1300 792 L1258 828"
          stroke="#E33127"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
        />
      </g>
      <g className="fr f3">
        <path d="M1368 448 L1250 860 L1276 470 Z" fill="#EDE9DD" />
        <path d="M1320 692 L1360 710 L1310 720 Z" fill="#EDE9DD" />
        <path d="M1294 772 L1332 790 L1284 798 Z" fill="#EDE9DD" />
        <circle cx="1242" cy="886" r="15" fill="#E33127" />
        <circle cx="1208" cy="862" r="6" fill="#E33127" />
        <circle cx="1286" cy="876" r="5" fill="#E33127" />
        <g stroke="#EDE9DD" strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.9">
          <path d="M1292 800 L1358 780" />
          <path d="M1286 856 L1350 874" />
          <path d="M1196 812 L1136 842" />
        </g>
      </g>
    </g>
  );
}

function WaspDefs() {
  return (
    <svg className="defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="gaster-clip">
          <path
            d="M878 352 C950 250 1070 210 1180 236 C1290 262 1372 356 1358 466
               C1352 486 1330 492 1312 476 C1250 424 1180 420 1092 412
               C1000 404 916 400 878 352 Z"
          />
        </clipPath>

        <g id="wasp-body">
          {/* far forewing — sweeps up-left over the head and off the left edge */}
          <path
            d="M604 334 C486 258 322 176 140 118 C60 92 6 62 -70 18
               L-110 74 C-30 128 44 176 128 216 C300 298 470 356 574 380
               C610 388 626 358 604 334 Z"
            fill="url(#ht-bone)"
            opacity="0.38"
            stroke="#EDE9DD"
            strokeWidth="4"
            strokeOpacity="0.5"
          />

          {/* legs: three, near side only. No ghosted far legs. */}
          <g stroke="#EDE9DD" fill="none" strokeLinecap="round">
            <path d="M520 556 C470 640 420 692 348 716" strokeWidth="12" />
            <path d="M626 588 C606 668 570 730 508 772" strokeWidth="12" />
            <path d="M740 566 C756 660 736 744 682 806" strokeWidth="11" />
          </g>
          <g stroke="#EDE9DD" fill="none" strokeLinecap="round">
            <path d="M348 716 L300 742" strokeWidth="8" />
            <path d="M508 772 L462 800" strokeWidth="8" />
            <path d="M682 806 L646 838" strokeWidth="7" />
          </g>
          {/* the trailing hind leg: dangles back under the raised gaster, and it is the
              only part of the body other than the sting that survives the 390×844 crop
              below the cut */}
          <g stroke="#EDE9DD" fill="none" strokeLinecap="round">
            <path d="M782 520 C900 620 1010 720 1096 806" strokeWidth="11" />
            <path d="M1096 806 L1152 848" strokeWidth="7" />
          </g>

          {/* gaster: raised, arched up and to the right, tapering to the sting */}
          <path
            d="M878 352 C950 250 1070 210 1180 236 C1290 262 1372 356 1358 466
               C1352 486 1330 492 1312 476 C1250 424 1180 420 1092 412
               C1000 404 916 400 878 352 Z"
            fill="#EDE9DD"
          />
          <g clipPath="url(#gaster-clip)">
            <g fill="none" strokeLinecap="butt">
              <path d="M1043 188 L944 576" stroke="#D9F227" strokeWidth="62" />
              <path d="M1135 211 L1036 599" stroke="#D9F227" strokeWidth="56" />
              <path d="M1228 235 L1129 623" stroke="#D9F227" strokeWidth="46" />
              <path d="M1320 258 L1222 646" stroke="#E33127" strokeWidth="26" />
              <path d="M1071 195 L972 583" stroke="#141210" strokeWidth="5" />
              <path d="M1163 218 L1064 606" stroke="#141210" strokeWidth="5" />
              <path d="M1256 242 L1157 630" stroke="#141210" strokeWidth="5" />
            </g>
          </g>

          {/* petiole / waist */}
          <path
            d="M780 396 C812 380 848 364 884 352 L900 400 C866 410 830 424 800 442 Z"
            fill="#EDE9DD"
          />

          {/* thorax — a single mass. Hairs on the outside, nothing knocked out of the
              inside, so it cannot read as a second face. */}
          <path
            d="M508 348 C566 288 668 280 736 330 C806 382 818 470 772 528
               C726 586 620 592 552 548 C486 504 466 396 508 348 Z"
            fill="#EDE9DD"
          />
          <g stroke="#EDE9DD" strokeWidth="7" fill="none" strokeLinecap="round">
            <path d="M528 336 L494 302" />
            <path d="M566 306 L546 266" />
            <path d="M614 290 L604 246" />
            <path d="M666 288 L672 244" />
            <path d="M716 306 L738 268" />
          </g>

          {/* near hindwing */}
          <path
            d="M690 424 C830 396 1000 372 1180 366 C1260 364 1310 350 1352 332
               L1338 386 C1290 412 1220 432 1140 446 C990 472 820 480 716 468
               C676 462 664 434 690 424 Z"
            fill="url(#ht-acid)"
            opacity="0.55"
            stroke="#EDE9DD"
            strokeWidth="5"
          />

          {/* near forewing — runs off the right edge and toward the top */}
          <path
            d="M682 356 C850 274 1080 190 1330 128 C1440 100 1520 68 1620 20
               L1660 96 C1560 152 1470 190 1370 222 C1120 302 880 372 742 396
               C692 404 666 380 682 356 Z"
            fill="url(#ht-acid)"
            opacity="0.68"
            stroke="#EDE9DD"
            strokeWidth="6"
          />
          <g fill="none" stroke="#EDE9DD" strokeWidth="3" opacity="0.85">
            <path d="M718 366 C900 296 1120 226 1380 160" />
            <path d="M746 392 C920 330 1130 268 1370 208" />
            <path d="M1006 250 L1024 300" />
            <path d="M1214 186 L1230 236" />
          </g>

          {/* head */}
          <path
            d="M262 402 C268 330 330 292 404 300 C480 308 528 366 522 442
               C516 522 460 574 386 570 C310 566 254 486 262 402 Z"
            fill="#EDE9DD"
          />
          <path
            d="M292 356 C336 322 400 336 414 388 C428 442 386 486 336 476
               C288 466 264 392 292 356 Z"
            fill="#E33127"
          />
          <path d="M312 366 C336 348 368 352 380 372 L340 396 Z" fill="#EDE9DD" opacity="0.92" />
          <path
            d="M460 348 C484 362 494 388 490 412"
            fill="none"
            stroke="#141210"
            strokeWidth="6"
            strokeLinecap="round"
          />

          {/* mandibles */}
          <path
            d="M292 528 C274 558 268 588 280 610 L306 596 C294 576 296 556 314 538 Z"
            fill="#EDE9DD"
          />
          <path
            d="M342 560 C330 592 332 616 348 632 L374 618 C360 604 358 584 366 566 Z"
            fill="#EDE9DD"
          />

          {/* antennae: one gesture, split into sub-paths so the pen tapers */}
          <g fill="none" stroke="#EDE9DD" strokeLinecap="round">
            <path d="M348 330 C300 272 246 232 184 194" strokeWidth="15" />
            <path d="M184 194 C140 178 80 164 -10 152" strokeWidth="9" />
            <path d="M424 300 C400 244 386 196 380 140" strokeWidth="13" />
            <path d="M380 140 C376 116 372 96 366 74" strokeWidth="7" />
          </g>
          <ellipse cx="-32" cy="150" rx="19" ry="12" fill="#EDE9DD" transform="rotate(-14 -32 150)" />
          <ellipse cx="360" cy="56" rx="16" ry="11" fill="#EDE9DD" transform="rotate(-76 360 56)" />
        </g>

        {/* the speckle is masked to the wasp's own geometry. There is no full-viewBox
            toner rect: it painted a visible grey card. */}
        <mask id="m-wasp" maskUnits="userSpaceOnUse" x="-300" y="-300" width="2200" height="1600">
          <use href="#wasp-body" />
        </mask>
      </defs>
    </svg>
  );
}

export function Wasp() {
  return (
    <>
      <WaspDefs />

      {/* ---- LANDSCAPE CROP: viewBox 1600×1000 (1.60), slice. Everything outside the
              safe region x 150–1450 / y 140–905 is drawn to be cropped. ---- */}
      <svg
        className="plate-art plate-art--wide"
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="A hand-inked wasp the size of the page, gaster raised and stinger driving down through a torn strip of photocopy paper."
      >
        <g className="collage">
          <rect
            x="-40"
            y="60"
            width="330"
            height="240"
            fill="url(#ht-acid)"
            opacity="0.20"
            transform="rotate(-2.2 125 180)"
          />
          <rect
            x="1380"
            y="612"
            width="300"
            height="150"
            fill="url(#ht-bone)"
            opacity="0.16"
            transform="rotate(1.8 1530 687)"
          />
          <path d="M0 812 L128 804 L262 816 L246 856 L120 848 L0 858 Z" fill="#1D1A16" />
        </g>

        <use href="#wasp-body" filter="url(#xerox)" />

        <g mask="url(#m-wasp)" pointerEvents="none">
          <rect x="-300" y="-300" width="2200" height="1600" filter="url(#toner)" opacity="0.55" />
        </g>

        <Sting />
      </svg>

      {/* ---- PORTRAIT CROP: viewBox 900 −30 560 1120 (0.50), same slice rule. At 390×844
              the visible window is x 921–1439: the gaster, all four bands, the stinger and
              the whole sting land inside it, and the drawing bleeds off BOTH side edges. ---- */}
      <svg
        className="plate-art plate-art--tall"
        viewBox="900 -30 560 1120"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="A hand-inked wasp, cropped to the raised gaster and the stinger driving down through a torn strip of photocopy paper."
      >
        <g className="collage">
          <rect
            x="1380"
            y="612"
            width="300"
            height="150"
            fill="url(#ht-bone)"
            opacity="0.16"
            transform="rotate(1.8 1530 687)"
          />
        </g>

        <use href="#wasp-body" filter="url(#xerox)" />

        <g mask="url(#m-wasp)" pointerEvents="none">
          <rect x="-300" y="-300" width="2200" height="1600" filter="url(#toner)" opacity="0.55" />
        </g>

        <Sting />
      </svg>
    </>
  );
}
