# Direction: SCREEN-PRINT MISREGISTRATION

Proposal for **It Stings**. Judged against `docs/spec.md` § Art direction, § Interface, § Anti-brief.

---

## 1. Thesis

**We are printing on black stock.** Every screen is a two-to-four-pass riso print: an opaque bone
key-line pass, then the spot colour passes, run through a press whose registration pins are worn.
The colour plates land 3–6px down and to the right of the lines they are supposed to fill, the
overlaps multiply into dirty third colours, and the whole sheet is dusted with paper tooth. That
mechanical wrongness is the entire personality — there is no decorative gloss anywhere, no
gradient, no shadow, no blur. It is the cheapest possible printing method rendered with total
conviction.

Why this fits the product: the engine's answer to "what else sounds like *this*" is never the
obvious neighbour. It is the thing one register off — a 1956 jump-blues record answering a 1983
post-punk single. Misregistration is that idea made visual: two plates that describe the same
shape and refuse to sit on top of each other. It also solves a real problem. The app is slow, and
it streams results in as channels finish. A print that is visibly assembled from separate passes
makes an interface that arrives in passes feel intentional rather than broken.

---

## 2. Palette

Ground is heavy off-black — the stock. Bone is the opaque white ink and the only body-text colour.
Three spots overprint. Ratios below computed with the WCAG 2.x relative-luminance formula
(sRGB, `(L1+0.05)/(L2+0.05)`); every value is measured, not estimated.

| Name | Hex | Role | Contrast vs ground `#100C0A` | Verdict |
|---|---|---|---|---|
| **Press Black** | `#100C0A` | The stock. Page ground; also the knockout colour — any shape in this colour reads as a hole punched through the plates. | — | ground |
| **Plate Black** | `#1B1512` | Second black pass. Card interiors, panel fills. Sits 1 value step off the ground so a card is felt, not outlined twice. | 1.08:1 (deliberately near-invisible) | surface only |
| **Newsprint Bone** | `#EFE6D4` | The key line and **all body text**. Slightly yellowed — it is white ink on black card, not #FFF. | **15.70:1** | AAA body |
| **Bone Dim** | `#B9AF9C` | Metadata, mono numerals, source attributions, field keys. | **8.97:1** (8.32:1 on Plate Black) | AAA body |
| **Fluoro Sting** | `#FF3D6E` | Spot 1, the fluorescent pink-red. The wound. Seed accents, "playing" state, warnings, the wordmark plate. | **5.69:1** (5.29:1 on Plate Black) | AA body, AA-large |
| **Acid** | `#B7EF3F` | Spot 2, acid green. Completed stages, match bars, the primary Save affordance. | **14.30:1** (13.27:1 on Plate Black) | AAA body |
| **Dirty Federal** | `#3D6FE0` | Spot 3, dirty blue. **Plate colour only — never carries text and never sits under text.** | **4.22:1 — FAILS** (bone on it: 3.72:1 — also fails) | fills, rules, halftone |
| **Federal Tint** | `#7AA2F5` | The only text-safe blue. Used *only* where blue must be a word: evidence links, channel-C tags. | **7.71:1** (7.15:1 on Plate Black) | AAA body |
| **Hairline** | `#3A322C` | The one utility neutral: section rules, the unelapsed part of the preview ring. Stock lifted just enough to draw a line. Never carries text, never sits under text. | 1.63:1 | rules only |

**The blue rule is the important one.** Dirty Federal is the best colour in the set and it fails
contrast in both directions. It is therefore restricted by policy to shapes ≥ 24px thick with no
text on or under them. Any time the design wanted blue text it gets Federal Tint instead. This is
written into the CSS as two separate custom properties (`--blue-plate`, `--blue-ink`) so the
failing colour is never reachable from a text rule by accident.

**Overprints** (true `multiply` products, computed channel-wise — these are not hand-picked, they
are what the inks actually make):

| Overlap | Result | Notes |
|---|---|---|
| Fluoro × Acid | `#B7391B` rust | bone on it = 4.69:1, AA body. Safe. |
| Fluoro × Federal | `#3D1B61` plum | bone on it = 11.09:1. Safe. |
| Acid × Federal | `#2C6837` bottle | bone on it = 5.39:1, AA body. Safe. |
| all three | `#2C1918` | reads as near-stock. Used as a shadow-free "dense area". |

Six colours, all saturated, all slightly dirty, on a heavy off-black. No cream. No terracotta.
No gradient anywhere in the stylesheet — `linear-gradient` appears zero times in both HTML files.

---

## 3. Type

Both from Google Fonts.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Display — Bricolage Grotesque, 800 weight, width axis 75–86, optical size 96.**
Wordmark, headings, card titles, stage names. It is drawn slightly wrong on purpose and that is
documented in the typeface itself: the joins are inconsistent, the bowls have flat sides that
don't agree with each other, the `g` and the `a` come from different decades, terminals get cut
at angles the rest of the face doesn't justify. Set at `wdth 78` it condenses into something that
looks stencilled rather than drafted. Crucially it is *variable*, so the wordmark can run at
`opsz 96, wdth 75, wght 800` and a card title at `opsz 24, wdth 86, wght 700` and they read as
the same hand at two sizes rather than the same file scaled.

```css
--display: "Bricolage Grotesque", "Archivo Black", "Helvetica Neue", Impact, sans-serif;
.wordmark { font-family: var(--display);
            font-variation-settings: "opsz" 96, "wdth" 75, "wght" 800; }
```

**Body — IBM Plex Sans, 400/500/600/700.**
Every functional word: the `why` line, fingerprint interpretations, buttons, notices, labels.
It is boring in exactly the right way — open apertures, unambiguous `I`/`l`/`1`, a large x-height,
and it holds up at 13px on a dark ground where a geometric sans smears. It has a faint engineering
stiffness that suits a page full of provenance, and it is emphatically *not* the default
product-sans that would make this look like a dashboard.

**Numerals and provenance — IBM Plex Mono 400/500.**
Restricted, by rule, to three things: numbers that must be traceable (BPM, year, elapsed time,
match scores, candidate counts), source URLs, and fingerprint field keys (`tempo_bpm`,
`signature_hook`). Anything in mono is a claim about data. Anything in Plex Sans is prose.
Anything in Bricolage is a name. That is the whole type system and it never varies.

**Never** body copy in the display face. The display face appears in exactly five places:
wordmark, seed title, card titles, stage names, and the three section headings.

---

## 4. Linework

Two techniques, used for different jobs, because one filter applied to everything is both slow
and — worse — ends up displacing text.

### 4a. The rough-edge filter — big art only

Used on the empty-state illustration and the search-bar frame. Two filters, deliberately
mismatched, so the line pass and the colour pass wobble on different wavelengths and never track
each other. That mismatch is what makes it read as two trips through a press rather than one
shaky outline.

```svg
<!-- LINE pass: high frequency, small amplitude — a nib chattering on rough card -->
<filter id="rough-key" x="-12%" y="-12%" width="124%" height="124%"
        color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.018 0.026"
                numOctaves="3" seed="17" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="4.5"
                     xChannelSelector="R" yChannelSelector="G"/>
</filter>

<!-- COLOUR pass: low frequency, large amplitude — the sheet itself stretching -->
<filter id="rough-plate" x="-14%" y="-14%" width="128%" height="128%"
        color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.009 0.013"
                numOctaves="2" seed="41" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="9"
                     xChannelSelector="R" yChannelSelector="G"/>
</filter>
```

`color-interpolation-filters="sRGB"` is not optional — the default `linearRGB` shifts the spot
colours perceptibly toward muddy and would quietly break the contrast ratios above.

**Hard rule: no element containing text ever carries a displacement filter.** In practice the
filters are applied to `<g>` groups inside the decorative SVG layer only, which sits at a lower
stacking index than every text node on the page.

### 4b. Wobble points + non-scaling stroke — everything in the UI

Card frames, panel borders, the toggle track, chips. These are hand-authored irregular paths
drawn in an abstract 200×100 box, stretched to the real element with
`preserveAspectRatio="none"`, with `vector-effect="non-scaling-stroke"` so the stroke stays a
constant 2px no matter how the box is stretched. Corners overshoot and undershoot by 1–3 units,
edges bow, and one corner per frame is left visibly open.

```svg
<defs>
  <path id="frame-a" vector-effect="non-scaling-stroke" fill="none"
        d="M3.2 5.4 L104 2.6 L197 6.1 L196.4 52 L197.8 95.2
           L98 97.6 L4.4 94.1 L2.6 49 Z"/>
</defs>
...
<svg class="frame" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
  <use href="#frame-a"/>
</svg>
```

Three variants (`frame-a`, `frame-b`, `frame-c`) cycle down the results list so no two adjacent
cards have the same wonk. Weight variation within a single line comes from drawing the heavy
segments as separate paths at `stroke-width` 2 / 3.5 / 6 rather than from a filter — cheaper and
it actually looks like pressure changes in a nib.

---

## 5. Texture

### Halftone

Three screens, one per spot, all the same cell size, angles **15° / 45° / 75°**.

```svg
<pattern id="ht-pink" width="7" height="7" patternUnits="userSpaceOnUse"
         patternTransform="rotate(15)">
  <circle cx="3.5" cy="3.5" r="1.65" fill="#FF3D6E"/>
</pattern>
<pattern id="ht-acid" width="7" height="7" patternUnits="userSpaceOnUse"
         patternTransform="rotate(75)">
  <circle cx="3.5" cy="3.5" r="1.5" fill="#B7EF3F"/>
</pattern>
<pattern id="ht-blue" width="7" height="7" patternUnits="userSpaceOnUse"
         patternTransform="rotate(45)">
  <circle cx="3.5" cy="3.5" r="1.9" fill="#3D6FE0"/>
</pattern>
```

**Moiré discipline** (the reason this looks like print and not like a bug):
1. Screens are 30° apart. Never two screens within 30° of each other in the same stack.
2. Never more than two screens overlapping. Three is where it beats.
3. `patternUnits="userSpaceOnUse"` and no transform on the filled shape — the dots must not
   scale or rotate with the element, or the cell drifts against the pixel grid and shimmers.
4. Cell size fixed at 7 units everywhere. One screen ruling per print.

### Grain

One full-bleed `feTurbulence` sheet, desaturated, alpha-shaped, at 0.09 opacity:

```svg
<filter id="grain" x="0" y="0" width="100%" height="100%"
        color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4"
                stitchTiles="stitch" result="t"/>
  <feColorMatrix in="t" type="saturate" values="0" result="g"/>
  <feComponentTransfer in="g">
    <feFuncA type="linear" slope="0.55" intercept="-0.14"/>
  </feComponentTransfer>
</filter>
```

```css
.grain { position: fixed; inset: 0; z-index: 0; opacity: .09;
         mix-blend-mode: screen; pointer-events: none; }
.content { position: relative; z-index: 2; }   /* text always above the grain */
```

**Where texture is allowed:** the page ground, the empty-state illustration, the sash and burst,
inside artwork sleeves, and as a fill for the "unscored remainder" of a match bar.

**Where texture is forbidden, without exception:** over any text; inside a card's content box;
under the search input; under the `why` line; under fingerprint values; under a URL. Enforced
structurally rather than by care — the grain sheet is at `z-index: 0` and every text-bearing
element is at `z-index: 2` on an opaque `Plate Black` fill. Grain physically cannot land on top
of a word.

### Overprint / trap

Real multiply, isolated so it behaves like ink rather than like a dark-mode bug:

```svg
<g style="isolation:isolate">
  <path fill="#FF3D6E" style="mix-blend-mode:multiply" d="..."/>
  <path fill="#B7EF3F" style="mix-blend-mode:multiply" d="..."/>
</g>
```

`isolation:isolate` makes the group its own blending context, so the plates multiply against
*each other* and against a transparent backdrop — not against the black stock, which would
annihilate them. The bone key pass sits **above** that group with normal blending, because
legibility beats authenticity: real opaque white ink would get tinted by every colour laid over
it, and a tinted key line at 13px is a worse line.

---

## 6. Composition

- **Rotation range: −2.0° to +2.0°, quantised to 0.5°.** Nothing sits at 0.25°; that reads as a
  CSS mistake. Adjacent elements never share a rotation value or sign.
- **Rotate the frame, never the content.** This is the single rule that keeps the mess out of the
  reading. A card's ink frame and colour plate rotate; the `<div>` holding the title, the `why`
  and the metadata sits at exactly 0°. Same for panels and chips.
- **Registration offset: 3–6px, always down-and-right,** because a press slips one way. A plate
  that is offset up-and-left in one place and down-and-right in another looks like decoration
  instead of a machine fault. One direction, whole document.
- **Overlap is required, not optional.** At least three elements per screen must break their
  container: the illustration bleeds off two edges, the seed card's plate pokes out from under
  the stage strip, the "playing" card's pink plate overhangs the card above it by 8px.
- **Perfectly straight, 0°, no exceptions:** the search input and its text; every card's content
  column; the fingerprint value table; the `why` line; all URLs; the progress ring; the match
  bars. If it is data or it is typed into, it is level.
- **The bar is HTML, the puncture is SVG.** The search field has to be a real focusable
  `<input>`, so the drawn wound and the bar cannot be registered by geometry — they drift as
  the viewport changes. They are registered by composition instead: at 1280×800 a
  `translateY(86px)` on the whole print (a landscape-only `min-aspect-ratio: 1/1` rule) drops
  the burst onto the bar's top edge, and at 390×844 the untranslated slice already lands it
  there. Three bone drips run down *through* the bar's position at every size, so even where
  the registration is loose the ink still reads as running out of the wound and past the slab.
- **Bleed safety.** The empty-state art uses a 1000×900 viewBox with
  `preserveAspectRatio="xMidYMid slice"`. At 1280×800 that shows viewBox `y 137–763`; at 390×844
  it shows `x 292–708`. Everything load-bearing (the stinger tip, the burst, the disc's near
  edge) lives inside the intersection `x 292–708, y 137–763`. Everything outside it is designed
  to be cropped.

---

## 7. The one stepped-motion moment

**Empty state: the puncture.** The stinger's tip meets the top edge of the search bar. At that
contact point, a burst of ink spikes cycles through **three drawn frames**:

| Frame | Content |
|---|---|
| 0 | Six short spikes, 26–46 units, and one halftone chip. The needle has just broken the surface. |
| 1 | Ten spikes, 44–88 units, a broken ring at r 62, two detached chips. |
| 2 | Twelve spikes, 66–126 units, a wider broken ring at r 96, four chips flung outward, three drips lengthened. |

Implemented as a **filmstrip**, not as three cross-fading layers — a fade would be eased motion
smuggled in, and the whole point is that there is no in-between state. The three frames are drawn
side by side 1200 user units apart inside the 1000-unit viewBox; only one can be inside the
viewport at a time, and the SVG viewport does the clipping.

```css
@keyframes strip { from { transform: translateX(0); }
                   to   { transform: translateX(-3600px); } }
.burst-strip { animation: strip .72s steps(3) infinite; }
```

`steps(3)` (jump-end) emits exactly `0 / -1200 / -2400` across the cycle — frames 0, 1, 2, each
held for 240ms, then a hard cut back. No easing function is reachable.

```css
@media (prefers-reduced-motion: reduce) {
  .burst-strip { animation: none; transform: translateX(-1200px); }
}
```

Reduced motion parks on **frame 1**, not frame 0 — the middle frame is the most legible drawing of
the three, so the still image is the best still image, not an arbitrary first cel.

**Results state: the grinder.** One moment per screen, and on the results page it is spent on the
running stage, because that is the only thing on the page that is genuinely still happening. Three
ink bars beside the `scoring` chip cycle 0→1→2 on the same `steps(3)` filmstrip technique at
.66s. Reduced motion parks on frame 2 (all three bars solid) and the chip keeps its text label,
so the state is never carried by motion alone.

**Exempt, because it is a readout and not decoration:** the 30-second preview ring. It advances in
**60 discrete jumps of 0.5s** (`transition: stroke-dashoffset .12s steps(1)` driven by
`timeupdate`), which keeps it inside the frame-based grammar rather than sweeping smoothly. In the
static mockup it is drawn at a fixed 11 s.

---

## 8. Component inventory

**Search bar (hero).** A Newsprint Bone slab, 64px tall on desktop / 56px on mobile, sitting dead
level at 0°, punched through the illustration. Under it and 5px down-and-right, a Fluoro Sting
plate pokes out from the left and bottom edges — the colour pass that missed. Around it, a bone
key outline drawn as a hand-wobbled path through `#rough-key`. Typed text is Press Black at 20px
IBM Plex Sans 500 (15.70:1). Placeholder is `#4E463C` (7.48:1) reading
*"name a song that got you — title, artist"*. No magnifying glass icon; instead, at the left edge,
a small drawn puncture mark in Fluoro Sting, 14px, which is where the stinger lands. Focus ring is
a 3px Acid offset outline, hard-edged, no glow. `autofocus`, and nothing interactive precedes it
in the DOM.

**Typeahead dropdown row.** The list is a Plate Black slab hung directly off the bottom edge of
the bar, at 0°, with a bone key line down its left side only (the "spine" of the print). Each row:
36×36 sleeve mark on the left, then title in Bricolage 18/`wdth 86`, artist in Plex Sans 14 Bone
Dim, year in Plex Mono 13 Bone Dim right-aligned. Hover/`aria-selected` state does not tint the
background — it snaps a 3px Fluoro Sting bar onto the left edge of the row and shifts the row
6px right, as if that one line had been printed on a slipped pass. Rows are separated by a
2px bone rule with a 12px gap at a random position along it. Debounce 200ms; while the request is
in flight the spine goes Bone Dim rather than showing a spinner.

**Stage / progress indicator.** A horizontal strip of six stage names in Bricolage `wdth 80` at
15px — `resolve · fingerprint · candidates · verify · scoring · rank` — connected by a hand-drawn
bone rule that sags between them. Done stages: name in Bone, an Acid tick struck through the rule
beneath. Running stage: name in Bone at weight 800 with a Fluoro Sting underline plate offset
4px, plus the three-bar grinder. Pending: Bone Dim, no mark. Below the strip, a single mono line
carrying the traceable counts, e.g.
`A 34 · B skipped · C 31 → 58 unique → 48 verified → 22 scored`. Every number in that line is a
count of things, never a percentage without its fraction beside it.

**Result card.** A collage, not a rounded box. Structure, bottom to top:
1. Colour plate — a flat spot-colour quad, rotated ±1.5°, offset 5px down-right, extending 8–14px
   past the card on two sides. Fluoro for the playing card, Dirty Federal for ordinary cards,
   Acid for saved ones.
2. Plate Black content slab at 0°, opaque, no radius above 2px, no shadow.
3. Bone key frame — one of the three wobble paths, one corner left open.
4. Content column at 0°.

Inside, reading order: **sleeve mark** 88×88 (in the app, the iTunes artwork; the drawn mark is
the fallback when it fails to load, so both states are designed) with a 4px offset colour plate
behind it and a bone key box in front. **Title** Bricolage 24 `wdth 86` Bone. **Artist** Plex Sans
16 Bone. **Year** Plex Mono 14 Bone Dim, with a hairline rule to its left — set as a fact, not a
badge. **Play button**: a 44px bone-outlined circle-ish blob with a hand-drawn triangle; when
playing it becomes a two-bar pause glyph and a 30s ring in Fluoro Sting draws around it with
`0:11 / 0:30` in mono beneath. **Save button**: a drawn hook/barb glyph plus the word "Save" —
no arrow, no plus-in-circle. Saved state fills the glyph Acid and the word becomes "Saved". The
**`why` line** gets the most room on the card: Plex Sans 17/1.55, Bone, max 62ch, with 20px of air
above and below and a 3px Acid bar at its left edge. It is never truncated and never sits over
texture. Below it, a mono row of channel tags (`A` `C`) and a caret reading "match detail".

**Expandable panel.** Opens *downward inside the same frame* — the frame path grows; no second
card appears. Contains a per-dimension list: field key in mono Bone Dim, a 2px bone track with a
flat Acid fill and the score in mono at the end (`rhythmic_character ▮▮▮▮▮▮▮▮▯ 94`), the unfilled
remainder shown as blue halftone rather than empty. Beneath, "evidence" with each source as a
full URL in Plex Mono 13 Federal Tint (7.15:1), underlined 2px, prefixed by its channel letter.
No favicons, no link cards.

**Evidence when a channel is down.** A skipped channel and a visible evidence trail are not
a contradiction, and the UI must say which it is looking at. Every evidence row is stamped
`live` or `cached <date>` in mono before the URL, and the skipped-channel notice names how many
cached items are still attached. In the mocked run Channel B is off, so its one reddit quote
carries `cached 2026-08-14 · not refreshed this run` while the Last.fm row carries `live`. The
alternative — hiding cached evidence whenever its channel is down — would quietly make the
ranking unexplainable, and the spec's whole position is that a recommendation the engine cannot
justify is not a recommendation.

**Fingerprint panel.** A two-column table under the seed card, at 0°, on Plate Black. Left column:
the schema key in Plex Mono 13 Bone Dim, verbatim from the spec (`tempo_feel`, `signature_hook`) —
lowercase snake_case, which is honest about being a data structure and is not an all-caps eyebrow.
Right column: the value in Plex Sans 16 Bone, prose, with a confidence chip after it — a small
hand-drawn tag, Acid outline for `high`, Bone Dim for `medium`, Fluoro Sting outline for `low`,
each with the word spelled out. `tempo_bpm` is a first-class row and when the sources disagree or
return nothing it reads **`unknown`** in mono Bone Dim followed by the reason in 13px
("Deezer returned 0; no GetSongBPM match") — the absence is designed, because inventing the number
is the one unforgivable act in this product. A "this is wrong" link sits at the bottom right of
the panel, because the spec says the user should be able to disagree with the engine.

**Playlist row.** 56px tall, no card frame at all — just a bone rule beneath each row, broken at
one random point. Drag handle is three hand-drawn bone dashes of unequal length. Sleeve mark 40px,
title/artist on one line, duration in mono, a play blob, and a remove glyph that is a drawn
scratch-out (an X made of two crossing nib strokes of different weight), never a trash can. The
active row gets a Fluoro Sting plate slid 6px right behind it.

**"No preview" state.** The card does not shrink, grey out, or disappear. The play blob is
replaced by a bone-outlined blob with a **drawn scratch through it** at 1.5°, and beside it, in
Plex Sans 15 Bone: *"No 30-second preview — Deezer and iTunes both came back empty."* Then the
deep link, full-width, as a bone-outlined button reading "Open on Spotify" (no arrow). The `why`
line, the match detail and the Save button all remain fully active, because the recommendation is
still a recommendation.

**"Channel skipped" notice.** Not a toast, not a yellow alert bar. A strip of Fluoro Sting
halftone at 15° with a bone key line on its left edge only, rotated −1°, overlapping the stage
strip above it by 10px. Text at 0° in Plex Sans 15 Bone: *"Channel B skipped: no search key."*
Then a second line in Bone Dim 13: *"Forum evidence is missing from this run. Scores lean on
Channel A and Channel C."* — it says what the user lost, not just what failed. A mono
`WEB_SEARCH_API_KEY` names the fix. Dismissible; the strip stays until dismissed and does not
animate in.

**Same-artist toggle.** A drawn switch, not a pill. A bone-outlined slot 56×28 with a wobbled
edge, and a solid knob that is a slightly irregular square, not a circle. Off: knob left, slot
empty Press Black, label in Bone Dim. On: knob right, slot filled Acid halftone, label in Bone.
Label reads **"include The Cure"** — the artist's actual name, not "include same artist", so the
consequence is legible. Beneath, 13px Bone Dim: *"Off by default. Same-artist tracks have to clear
a higher bar."* The knob moves in one 120ms `steps(1)` jump — it snaps between two drawn positions
and never slides.

---

## 9. Anti-brief compliance

| Prohibition | How this direction stands |
|---|---|
| Rounded-card grid, identical soft shadows | Single column. `border-radius` never exceeds 2px. `box-shadow` appears zero times in both files; depth comes only from offset flat plates. |
| All-caps eyebrow labels | No `text-transform: uppercase` anywhere. Field keys are lowercase `snake_case` because they *are* the schema. |
| Warm cream + terracotta | Ground is `#100C0A`. The palette is fluoro pink-red, acid green and dirty blue on black. |
| Arrow appended to a button label | Zero `→` characters. Buttons are verbs: "Save", "Open on Spotify", "match detail". |
| Purple-to-blue gradient | Zero gradients of any kind. `#3D1B61` plum exists only as the arithmetic product of two multiplied inks. |
| Looks at home in a SaaS dashboard | Every container is rotated, every plate is misregistered, and the primary illustration is a hornet's stinger going into a search field. |

---

## 10. Copy

The name appears only as the wordmark, and never with an explanation. The line under the
empty-state bar carries the idea without ever naming it:
*"Somewhere there's another one that does the same thing to you."*

The word "sting" is not used as a verb in any label, no bee puns appear in microcopy, and the
results heading is the flat, unromantic *"What else does this"*. The joke stays unexplained.

---

## 11. Files

- `empty.html` — empty state, full viewport, autofocused hero bar, the puncture motion.
- `results.html` — post-search state for **"The Lovecats" — The Cure (1983)**: seed card,
  fingerprint panel with `tempo_bpm: unknown`, stage strip mid-`scoring`, Channel B skipped
  notice, same-artist toggle, five result cards (one playing, one expanded, one with no preview).

Both self-contained: one Google Fonts `<link>` (plus two `preconnect`s), all CSS in a single
`<style>`, all illustration inline SVG authored here, `prefers-reduced-motion` honoured, no
external assets, and **no `<script>` at all** — there is no runtime that can throw. Both files
were walked with a tag-stack parser and checked for: balanced nesting, every `url(#id)` and
`href="#id"` resolving, unique ids, quote balance, entity-escaped ampersands, no `<img>`, no
non-font `<link>`, zero gradients / shadows / blurs / `backdrop-filter` / uppercase transforms /
radius above 2px, no easing function reachable anywhere, exactly one looping `steps()` animation
per page, `--blue-plate` unreachable from any `color:` declaration, no skipped heading levels,
`aria-hidden` on every decorative SVG, and an accessible name on every search field.
