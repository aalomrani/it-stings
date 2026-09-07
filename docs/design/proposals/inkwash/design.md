# Direction: **Ink & Lounge**

*Proposal for It Stings. Files in this folder: `design.md`, `empty.html`, `results.html`.*

---

## 1. Thesis

The acceptance-test song is a post-punk band playing lounge jazz on purpose. So the
interface is a lounge drawn by someone who plays in a punk band: brush-and-ink linework
with dramatic thick/thin, flat screen-printed colour on a heavy off-black, halftone
instead of shading, and one snapped string.

The empty state is a large drawn double bass with a **gash cut clean across it** — the
search bar is the cut. Three strings run down the page and are severed by it; a fourth has
already snapped and is whipping away with a bead of ink on the end. That is where the name
lives: the sting is a broken string, and nobody has to explain it. After you search, all of
that noise moves into the *frames* — crooked ink borders, misregistered second plates,
halftone in the corners — and the content inside the frames sits perfectly straight and
dead legible, because the `why` line is the product.

Elegance is the differentiator here. This is the tighter, more controlled end of the ink
family: fewer marks, heavier weight contrast, a palette of four dirty colours and a bone.
Nothing is scribbled. Everything is *cut*.

### Anti-brief compliance

| Banned | What we did instead |
|---|---|
| Rounded-card grid, identical soft shadows | Single column. Square-cornered flat plates with hand-roughened ink borders, each tilted a different fraction of a degree. Zero `box-shadow` with blur > 0 anywhere. |
| All-caps eyebrow labels | Every label is lowercase, in mono, and is a *source stamp* that names where a number came from. |
| Warm cream + terracotta | Off-black ground; teal, mustard, ox-blood, bone. |
| Arrow appended to a button label | Button labels: `go looking`, `save`, `saved`, `match & evidence`, `hide the working`, `this isn't right`, `open on Spotify`. No arrows, no chevrons. |
| Purple-to-blue gradient | No gradient of any kind exists in either file. Tone is made with three discrete halftone densities. |
| SaaS-dashboard energy | The largest object on the empty state is a hand-inked instrument with a hole in it. |

---

## 2. Palette

Ink on cheap paper. Four dirty colours, one bone, one cold hairline, on a heavy off-black.
Ratios computed against the WCAG 2.x relative-luminance formula; every ratio below is a
measured number, not an estimate.

| Token | Name | Hex | Role | Contrast on `--ground` #0E1110 |
|---|---|---|---|---|
| `--void` | Cut Black | `#080A09` | inside the gash and inside the search field only — the colour of "there is nothing behind this" | ground sits on it at 1.07:1 (mass, not text) |
| `--ground` | Pressroom Black | `#0E1110` | page ground | — |
| `--ground-2` | Second Pull | `#161A18` | result-card interior, instrument body mass | 1.08:1 vs ground (mass, not text) |
| `--ground-3` | Third Pull | `#1E2422` | seed-card interior, artwork plate ground | 1.26:1 vs ground (mass, not text) |
| `--bone` | Bone | `#EFE7D6` | **body text**, headings, primary ink line | **15.43:1** (g2 14.29, g3 12.83, void 16.14) |
| `--bone-2` | Foxed Bone | `#B6AE9E` | secondary text: artist, dimension notes, placeholder | **8.62:1** (g2 7.98, g3 7.17) |
| `--stamp` | Ash | `#9A9385` | mono source stamps — the small print that makes numbers traceable | **6.22:1** (g2 5.76, g3 5.18) |
| `--teal` | Bar Teal | `#3FB0A0` | links, evidence URLs, channel A, disclosure controls | **7.17:1** (g2 6.63, g3 5.96) |
| `--teal-deep` | Deep Teal | `#1E6E64` | **fill only, never text** — misregistered second plate, the drink in the glass, the rule beside the `why` | 3.14:1 — fails as text by design; used only as a shape |
| `--mustard` | Brass | `#F0B23A` | the live thing: current stage, elapsed preview, score, caret, focus rule, channel C | **10.06:1** (g2 9.32, g3 8.37). Ground-on-mustard = 10.06:1 for the `go looking` button. |
| `--ox` | Ox-blood | `#9E2A3C` | **fill only, never text** — the ink bead, the spill, the "skipped" band, misregistered wordmark ghost | 2.58:1 as text (forbidden). Bone **on** ox-blood = **5.99:1**, which is how the skipped-channel notice is legible. |
| `--flare` | Ox-blood Flare | `#D8697A` | the *only* red-family tint allowed as text: `unknown`, `no preview`, `skipped` | **5.62:1** (g2 5.21, g3 4.68) |
| `--hair` | Cold Hairline | `#6E8082` | **non-text only**: rules, empty progress track, unfilled match ticks, ghosted stage borders | 4.59:1 on ground but 4.24 on g2 / 3.81 on g3, so it is never allowed to carry a word |
| `--hair-2` | Cold Hairline, up | `#7A8C8E` | the dimmest thing permitted to be *text*, and only on `--ground`/`--void`: the pending stage, footer source links | **5.40:1** on ground (void 5.64, g2 5.00). Not permitted on `--ground-3` (4.49). |

**The rule that falls out of this table:** ox-blood and deep teal are *plates*, not voices.
Anything that has to be read is bone, foxed bone, ash, teal, mustard or flare. Body text
never drops below 5.18:1 anywhere in either file, against a 4.5:1 floor.

---

## 3. Type

Loaded in one request:

```html
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,200..800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
```

### Display — **Bricolage Grotesque**, weight 700–800, width axis pinned to 76–84

Wordmark, track titles, the score, panel headings. Used at `font-variation-settings:
"wdth" 76, "opsz" 96` for the wordmark and `"wdth" 80, "opsz" 24` for card titles.

*Why it is the "drawn / slightly wrong" face:* Bricolage Grotesque is built out of
deliberately mismatched parts — the terminals, the joins and the counters do not agree with
each other the way a well-mannered grotesque's do, and it carries `wdth` and `opsz` axes so
the same family can be squeezed to a poster condensation without going to a separate,
better-behaved condensed face. Compressed to `wdth 76` at 124px it reads as **cut** rather
than typed: hand-narrowed, slightly lumpy, out of step with itself. The wordmark then goes
through the `#rough-hard` displacement filter and gets a second ox-blood impression printed
5px off-register underneath, so the final artefact is a screen-print of a slightly wrong
letterform — which is exactly the Deadline-magazine grammar, without borrowing anyone's
letterforms.

Fallback stack: `"Archivo Black", "Haettenschweiler", "Arial Narrow", system-ui` — all
heavy or condensed, so a font failure degrades to "wrong weight" rather than "wrong idea".

### Body — **IBM Plex Sans**, 400 / 500 / 600

Everything functional: the `why`, fingerprint values, buttons, notices, the search field.

*Why it is the "boring and legible" face:* Plex Sans was drawn for technical documentation.
Open apertures, unambiguous `1 l I`, a genuinely neutral lowercase, no personality tax at
14–17px. It is deliberately **not Inter** — Inter is the SaaS-dashboard default and the
anti-brief is explicit that looking at home in a SaaS dashboard is a failure. Plex reads as
a manual or a liner note rather than an admin panel. It is never used above 30px and never
carries a filter.

### Utility — **IBM Plex Mono**, 400 / 500

One job only: **source stamps**. Every number on the page is followed by a mono line naming
where it came from (`— MusicBrainz first release 1983-10-21`, `— Deezer bpm 0 · GetSongBPM
no match`). The mono face is what makes "every displayed number must be traceable" *visible*
as a design decision rather than a policy in a doc. It is the same superfamily as the body
face, so it costs nothing in cohesion. It is never used for a sentence the user has to read
as prose.

**Hard rule:** no body copy in the display face, ever. Track titles are the boundary — they
are names, not prose, and they cap at 23px (29px for the seed).

---

## 4. Linework

Three techniques, used for three different jobs.

### 4a. The rough-edge filter (all CSS-drawn borders, all SVG strokes)

Applied to borders via a pseudo-element so the *frame* is distorted and the *text inside it
is never touched by a filter*.

```html
<filter id="rough" x="-18%" y="-18%" width="136%" height="136%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.017 0.024" numOctaves="3" seed="11" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G"/>
</filter>

<filter id="rough-lite" x="-14%" y="-14%" width="128%" height="128%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.031 0.042" numOctaves="2" seed="4" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="1.7" xChannelSelector="R" yChannelSelector="G"/>
</filter>

<filter id="rough-hard" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.009 0.016" numOctaves="4" seed="23" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="4.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>

<filter id="rough-nub" x="-45%" y="-45%" width="190%" height="190%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.09 0.11" numOctaves="2" seed="17" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="1.5" xChannelSelector="R" yChannelSelector="G"/>
</filter>
```

Which to use:

- `#rough` — big illustration strokes, instrument outlines, f-holes, gash lips, artwork
  plate borders (3px+ strokes on shapes ≥ 60px).
- `#rough-lite` — every UI border: card frames, buttons, stage chips, the switch, the play
  triangle. Scale 1.7 is the ceiling before a 2px border starts to break up.
- `#rough-hard` — the wordmark only. Nothing under 70px goes through it.
- `#rough-nub` — the 11×13px match ticks and the switch knob. Small elements need an
  oversized filter region (190%) or the displaced edge clips against the region boundary.

**Never applied to:** anything under 14px of body text, the search field, the `why`, the
fingerprint values, source stamps. A displacement filter on text at reading size is a
legibility bug wearing a costume.

### 4b. The crooked-frame pattern (the workhorse)

This is the single most-reused idea in `results.html`. The border is a rotated,
filtered pseudo-element; the content box is untouched and stays at exactly 0°.

```css
.inked{position:relative}
.inked::before{                     /* the drawn frame */
  content:"";position:absolute;inset:0;
  border:2.5px solid var(--bone);
  filter:url(#rough-lite);
  transform:rotate(var(--tilt, -0.45deg));
  pointer-events:none;
}
.inked::after{                      /* the misregistered second plate */
  content:"";position:absolute;inset:0;
  border:2px solid var(--teal-deep);
  filter:url(#rough-lite);
  transform:rotate(calc(var(--tilt, -0.45deg) * -1.4)) translate(5px,4px);
  opacity:.6;z-index:-1;pointer-events:none;
}
```

`--tilt` is set per card so no two frames agree. The `::after` plate sits at `z-index:-1`,
behind the card's own opaque background, so it is visible only where it escapes the box —
which is exactly how a two-colour screen print misregisters.

### 4c. Tapered brush strokes (thick/thin) — filled outlines, not strokes

SVG `stroke-width` is constant along a path, which is the opposite of a brush pen. So every
stroke that needs weight variation is authored as a **closed filled outline**: draw the
spine, return along the other side at a varying offset, close the path. The snapped string
is the clearest example — 9 units at the break, 2 at the tip:

```html
<path d="M 527,246 C 566,206 618,170 672,152 C 706,141 744,146 770,160
         L 767,167 C 742,155 708,151 676,162 C 624,180 574,214 536,254 Z"
      fill="var(--bone)"/>
```

Uniform-weight strokes are allowed only where the object really is uniform: the four bass
strings (which are under tension and therefore the only perfectly straight objects in the
drawing) and hairline rules.

---

## 5. Texture

### Halftone (three discrete densities — this is how tone is made without a gradient)

```html
<pattern id="dots-bone" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(21)">
  <circle cx="3.5" cy="3.5" r="1.1" fill="var(--bone)"/>
</pattern>
<pattern id="dots-mustard" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-14)">
  <circle cx="4" cy="4" r="1.75" fill="var(--mustard)"/>
</pattern>
<pattern id="dots-teal" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(33)">
  <circle cx="3" cy="3" r="1.25" fill="var(--teal)"/>
</pattern>
```

Each screen is rotated to a different angle (21°, −14°, 33°) so overlapping screens moiré
the way real four-colour separations do. Density is chosen per screen, not interpolated —
there is no such thing as a 50% tone in this system, only "the 7-unit screen" or "the
8-unit screen".

### Grain (paper tooth)

```html
<filter id="grain-f" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.86" numOctaves="4" stitchTiles="stitch" result="t"/>
  <feColorMatrix in="t" type="saturate" values="0"/>
</filter>
```

```html
<svg class="grain" aria-hidden="true" viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice">
  <rect x="0" y="0" width="1200" height="900" filter="url(#grain-f)"/>
</svg>
```
```css
.grain{position:fixed;inset:0;width:100%;height:100%;
       z-index:0;pointer-events:none;opacity:.05;mix-blend-mode:screen}
```

### Where texture is allowed, and where it is forbidden

**Allowed**

- The grain plane, at `z-index: 0`, **behind everything**. Every element that holds text has
  an opaque `--ground-2` / `--ground-3` / `--void` background, so the grain is visible in
  the gutters and margins and physically cannot land on a glyph.
- Inside illustration SVGs: the instrument body (bone screen at 0.11), the spotlight disc
  (mustard screen at 0.9), the ink spill (bone screen at 0.16), the drink.
- Artwork plates on cards: one screen at 0.10–0.14 behind the drawn glyph.
- The seed card's top-right corner: a 104×104 mustard quarter-screen at 0.55 opacity, in a
  region with no text in it at any breakpoint.

**Forbidden**

- Any screen or grain layer stacked *above* a text node. No exceptions, no "it's only 4%".
- Grain over the search field or the `why`.
- Screens inside the expandable panel, the fingerprint list, or the stage strip — those are
  dense with small type and the texture budget for that area is zero.
- More than two texture layers in one place. A screen plus the global grain is the ceiling.

---

## 6. Composition rules

1. **Rotation lives in the chrome.** Frames, tape bands and stage chips rotate between
   **−1.2° and +0.9°**; the wordmark sits at **−1.6°**; the instrument body at **−5°** and
   the tipped glass at **−13°** (illustration, so it gets a longer leash). No two adjacent
   frames share a tilt value.
2. **Content is always 0°.** Card interiors, the `why`, the fingerprint list, every button
   label, the search field. If a viewer has to read it, it is level.
3. **These stay perfectly straight, on purpose:** the four bass strings, the search field's
   text baseline, and the hairline rules between fingerprint rows. The straight things are
   what make the crooked things read as deliberate rather than as a rendering bug.
4. **Overlap is allowed in three places only:** the gash overruns the instrument on both
   sides and cuts out into open page; the wordmark straddles the lower bout edge; the ink
   bead on the search field crosses from the drawing onto the field's top-right corner.
   Overlaps must not cross a text column.
5. **Off-grid, but only in the frame.** The misregistered `::after` plate is offset by a
   flat `translate(5px, 4px)` — the same offset everywhere, like a plate that was mounted
   wrong once, not randomly per element.
6. **Single column throughout.** Max width 47rem for results, 56rem for the empty scene.
   Nothing sits above the search bar on either page — on the empty state the wordmark is
   stencilled *onto the instrument, below the cut*, which is how the page carries a
   wordmark without putting anything above the hero.
7. **Corners are square.** `border-radius` is 0 everywhere including the search input
   (`border-radius:0` is set explicitly to defeat the UA stylesheet).

---

## 7. The one stepped-motion moment

One moment per page. Both are true filmstrips: the frames are drawn side by side inside a
`clipPath` window and a single `transform: translateX()` advances the strip with `steps()`.
Nothing eases, nothing tweens, nothing has a duration under 0.2s per frame.

### `empty.html` — the string twangs (3 frames, one shot)

The fourth bass string has snapped above the gash. Three drawn poses:

1. **just snapped** — whipping high and right, ink bead thrown clear at the top
2. **overshoot** — whipping low and right, bead trailing below
3. **settled** — a gentle S with the bead hanging off the end (the resting state)

```html
<clipPath id="whip-win"><rect x="496" y="96" width="330" height="252"/></clipPath>
```
```html
<g clip-path="url(#whip-win)">
  <g class="whip-strip">
    <g>…frame 1 drawn at dx 0…</g>
    <g transform="translate(330,0)">…frame 2…</g>
    <g transform="translate(660,0)">…frame 3…</g>
  </g>
</g>
```
```css
.whip-strip{
  transform-box:view-box; transform-origin:0 0;
  transform:translateX(-660px);                 /* resting state = frame 3 */
  animation:twang .66s steps(3, jump-none) .45s 1 both;
}
@keyframes twang{
  from{transform:translateX(0px)}
  to  {transform:translateX(-660px)}
}
```

`steps(3, jump-none)` gives exactly three held positions — 0, −330, −660 — including both
endpoints, at 220ms each. `1 both` runs it once after a 450ms delay (long enough for the
webfont and first paint) and then holds frame 3 forever. It is a flinch on arrival, not a
loop; nothing on this page is still moving while you type. The portrait composition uses
the same mechanism with a 260-unit window (`translateX(0 → -520px)`).

**Reduced motion:**

```css
@media (prefers-reduced-motion: reduce){
  .whip-strip{animation:none;transform:translateX(-660px)}
  .whip-strip-tall{animation:none;transform:translateX(-520px)}
  .focus-rule{transition:none}
}
```

The drawing is identical — it simply starts on the settled frame. Nobody loses information.

### `results.html` — the live stage marker (3 frames, looping)

The `scoring` chip carries a 24×24 inked spark that steps through three drawn bursts
(4-spoke cross → 6-spoke star rotated 45° → 3 spokes over a solid blot) at 220ms per frame,
`steps(3, jump-none)` on a 48px translate, infinite. It loops because the work it represents
is looping; when scoring finishes the chip becomes a `done` tick and the animation is gone
from the DOM. Under reduced motion it holds frame 1 and reads as a static ink asterisk.

The only other transitions in the system are two 120ms `steps(2, end)` state flips — the
focus rule under the search field, and the same-artist switch knob. Both are two-frame,
both are disabled under reduced motion. There is no easing curve anywhere in this
direction.

---

## 8. Component inventory

### Search bar — *the hero*

**Empty state.** Not a box on a page: a **gash cut across the drawing**. A hand-drawn
wavy-edged shape filled `--void` runs the full width of the composition, straight through
the instrument body and out into open page on both sides. A heavy tapered brush stroke sits
along the top edge and another along the bottom — the lips of the cut. Ox-blood bleeds off
both ends where the blade went in. The three unbroken strings are visibly severed by it.
The `<input>` is positioned in the hole with a transparent background, `autofocus`, bone
text at `clamp(15px, 1.9vw, 21px)`, weight 500, mustard caret. Placeholder, one line:
*"a song that got you — title, artist"*. Focus is a hard 3px mustard rule that snaps in
under the text in two steps — no glow, no browser ring. A small overlay SVG sits above the
input (`pointer-events:none`) with one bone tick at the top-left and one ox-blood bead at
the top-right, both kept out of the vertical band the text occupies, so the bar reads as
physically embedded in the drawing rather than dropped on top of it.

Under the bar, left-aligned to it, one mono line: `try  **The Lovecats — The Cure**`.

**Results state.** Same field, quieter: a `--void` plate with a crooked bone ink frame and
a teal misregistered plate behind it, holding the resolved seed as text. To its right, the
`go looking` button (mustard fill drawn on the pseudo-element so its edges are rough, not a
crisp rectangle) and a small `playlist 3 saved` tab tilted +0.9°.

### Typeahead dropdown row

Not in the mockups (nothing is typed), specified here. The list is a `--void` plate hung
directly off the bottom lip of the gash — no gap, no shadow, the two share an edge so it
reads as the cut opening wider. Each row: a 36px drawn artwork plate, title in body 500,
`artist · year` in `--bone-2` below, and a right-aligned mono stamp naming the source
(`iTunes 6ec8d…`). Highlighted row gets a 3px mustard bar down its left edge and
`--ground-3` behind it — never a full mustard fill, which would kill the text contrast.
Rows are 0°; only the container's frame is crooked. Max 6 rows, scroll after that.

### Stage / progress indicator

A row of six mono chips — `resolve · fingerprint · candidates · verify · scoring · rank` —
each with its own roughened border at its own tilt. Done chips: teal border, bone text, a
teal ✓. Current chip (`scoring`): filled mustard with `--ground` text (10.06:1) plus the
3-frame stepped spark. Pending chip: `--hair` border, `--hair-2` text. Below it, three
channel chips with coloured left rules — `A last.fm · 24 candidates` (teal), `B web search ·
skipped` (ox-blood rule, flare text), `C model prior · 31 candidates` (mustard) — then one
mono stamp carrying the whole funnel: *55 raw → 41 verified against iTunes/Deezer → 14
dropped (C: 11, A: 3)*, with the run timestamp. Results stream in under this; the stage
strip never blocks them.

### Result card

An opaque `--ground-2` plate, square corners, crooked bone frame, teal plate misregistered
5px behind it. Two-column grid: an 88px **artwork plate** (a drawn quadrilateral with
slightly unequal corners, one halftone screen, and a hand-inked glyph — in the shipped app
this frame holds the real iTunes artwork; in these mockups it holds an original drawn mark,
because no image may be sourced from the web) and the content column:

- **Title** — display face, `wdth 80`, 23px.
- **Artist / year** — 14px `--bone-2`, `/` separator in `--hair`, followed by a mono stamp
  naming where the year came from.
- **The `why`** — 16.5px, line-height 1.62, max 52ch, indented behind a 3px deep-teal rule.
  It is the largest block of prose on the card and the only thing given a rule of its own.
- **Controls row** — play button + timer + `save` + `match & evidence`.
- **Meta strip** above a hairline: channel tags (`A last.fm`, `C model prior`, `B cached`),
  a one-line note about why it survived ranking, and the score right-aligned — the number in
  the display face in mustard at 22px, with `model score, 7 dimensions` stamped beside it.

**Play button + 30s ring.** 48px. The ring is a *hand-drawn* circle path — five bezier
segments that don't quite agree — carrying `pathLength="100"`, so elapsed time maps to
`stroke-dasharray` in exact percentage units despite the path being irregular. The playing
card is at 11s of 30s: `stroke-dasharray="36.7 63.3"`, and the stamp beside it says
`ring is 11/30 = 36.7% of the path`. Trough in `--hair`, elapsed arc in mustard, starting at
12 o'clock. Glyph: a filled ink triangle, or two ink bars when playing. **Save**: a bordered
pill, `save` → `saved` with a mustard fill drawn on the pseudo-element. **Disclosure**: a
teal underlined ghost control reading `match & evidence` / `hide the working` — never an
arrow, never a chevron.

**Expandable panel.** Opens under a 2px dashed rule. Two sections with sentence-case
headings in the display face (`where it matches`, `how it got here`).

- *Per-dimension match*: seven rows, *dimension name / 5 discrete ticks / a phrase*.
  The ticks are 11×13px skewed parallelograms through `#rough-nub`, mustard when lit,
  `--hair` when not — five stamped blocks, not a smooth bar, so a 3 and a 4 are countable
  at a glance. Each row's phrase says what actually matched, e.g. *"jump-blues changes
  rather than the seed's minor jazz voicings"*. An eighth row states era distance and says
  in words that it counts toward spread, not toward the score. Below the list, one stamp
  explains how the overall number was formed.
- *Evidence trail*: each entry is a real clickable URL in teal, the surrounding sentence
  quoted underneath in `<q>`, and a stamp naming the channel, the fetch date and the
  apparent enthusiasm. In the mockup: a reddit thread (channel B, marked
  `cached 2026-08-30, before the key was removed`) and a Last.fm similar-tracks page
  (channel A, `rank 14 of 100, match 0.41`).

### Fingerprint panel

Permanently open on the seed card — the user should not have to hunt for what the engine
thinks the song is. A two-column definition list (one column under 640px) with a hairline
between rows. Each row: field name in mono `--stamp` (`rhythmic_character`, exactly as it
appears in the JSON, so the UI and the schema are visibly the same object), a confidence
chip beside it, and the value in 14.5px bone. Long fields (`scene_context`,
`signature_hook`, `rhythmic_character`, crowd tags) span both columns.

**Confidence chips** are 9.5px mono in a 1px box: `high` mustard, `medium` teal, `no data`
flare. Lowercase. Never all-caps, never a filled badge.

**The tempo row is the point of the whole panel.** It reads `unknown` in flare, with no
number anywhere near it, and a stamp: *Deezer bpm 0 · GetSongBPM no match · AcousticBrainz
has no MBID join. no number is being guessed.* Era, by contrast, reads `1983` with
*MusicBrainz first release 1983-10-21* under it. The two rows next to each other are the
product's honesty policy, rendered.

A crowd-tags row shows the Last.fm tags with their 0–100 counts and names the three pivot
tags the model chose. At the foot, one ghost control: `this isn't right` — the disagree
affordance the spec asks for.

### Playlist row

(Specified, not mocked — the results page shows only the `playlist 3 saved` tab.) A shorter
card: drag handle drawn as three uneven ink dashes on the left, 48px artwork plate, title
and artist on one line, a play button with the same `pathLength` ring, and a `remove`
ghost control. Rows sit in one crooked frame as a stack rather than each getting a frame of
its own — a page of them with 20 individually tilted borders would be noise. The stack's
head carries the playlist name in the display face and two links, `plain text` and `JSON`.

### "No preview" state

The card does not disappear and does not grey out. The play button becomes a dashed `--hair`
ring with a hollow outlined triangle and a flare slash through it, `disabled`. Beside it, in
flare: `no preview`, then a stamp: *Deezer and iTunes both returned nothing; the Spotify
embed failed to load. the card stays.* The deep link `open on Spotify` is promoted into the
controls row as a normal bordered pill. The `why` is untouched and full strength — the
recommendation is still the product even when the audio isn't there.

### "Channel skipped" notice

A band of flat ox-blood with roughened edges, rotated −0.75°, sitting between the stage
strip and the seed card like a strip of tape. **The band is rotated; the text inside it is
not.** Bone text on ox-blood at 5.99:1. It names the cause, the consequence and the date
(*"Channel B skipped: no search key. Forum evidence for this run is cache-only — the last
live crawl was 2026-08-30. Scores lean on A and C, and multi-channel agreement is
under-counted until a web-search key is set."*), links to where the key goes, and closes
with a stamp: *degraded run, not an error. nothing below is invented to fill the gap.*

### Same-artist toggle

A drawn switch, off by default: a slightly out-of-square inked slot with a **square** ink
knob (never a circle in a pill — that shape is the SaaS tell), `--hair` when off, mustard
when on, sliding 26px in a single 120ms `steps(2)` flip. Label in body text: `include tracks
by The Cure` — the seed's artist named, not an abstract setting. Next to it, a stamp: *off
by default. a same-artist track has to clear a higher bar and justify itself on musical
grounds alone.* The same control row also carries the ranking receipts: `18 ranked · showing
5 · five decades, five scenes · one track per artist, enforced in code`.

---

## 9. Legibility floor (the non-negotiables this direction ships with)

- Body text minimum measured contrast in either file: **5.18:1** (`--stamp` on
  `--ground-3`), against a 4.5:1 requirement.
- No filter, screen, grain or rotation is applied to any element containing text below 30px.
- The search field and the `why` are the two most protected regions: flat opaque ground,
  no texture, no rotation, no overlap, no animation.
- Every interactive control has a visible non-colour state change (fill, border weight, or a
  hard rule), so colour is never the only signal.
- Focus is always visible and always drawn by us; the UA ring is replaced, never removed
  without a replacement.
- Both files respond correctly at 1280×800 and 390×844 using relative units throughout; the
  empty state swaps between two hand-authored compositions (landscape 980×620, portrait
  420×620) at a 680px breakpoint so the gash never becomes a letterbox slit on a phone.

## 10. Notes for the build

- The two `<svg class="defs">` blocks are identical in both files and should become one
  React component (`<InkDefs/>`) rendered once in the root layout. All filter and pattern
  ids are global.
- The `.inked` frame pattern is the only card chrome; `--tilt` should be derived
  deterministically from the track id (hash → −0.6…+0.6) so a card does not change its tilt
  between renders.
- Filters are the cost centre. Budget: roughly 40 filtered elements per screen. The match
  ticks are the densest use (5 per dimension); if profiling complains, replace `#rough-nub`
  on the ticks with pre-baked `clip-path` polygons.
- Grain is one fixed full-viewport SVG at `z-index:0`. It must never be reparented into a
  card, and any new component that holds text must set an opaque background.
- Progress rings must keep `pathLength="100"`; the elapsed dash is then simply
  `stroke-dasharray: {pct} {100 - pct}` regardless of how irregular the drawn ring is.
- `steps()` is the only permitted timing function in this direction. If a spec change needs
  an eased transition, it needs a conversation first.

---

## 11. Files

- `empty.html` — full-viewport empty state. Landscape and portrait compositions, wordmark
  stencilled below the cut, search bar autofocused in the gash, the 3-frame twang.
- `results.html` — post-search state for **"The Lovecats" — The Cure**: seed card with the
  full fingerprint (tempo `unknown`, era 1983 sourced), stage strip with `scoring` live and
  channels A/B/C, the Channel B skipped band, the same-artist toggle off, and five results —
  Squirrel Nut Zippers *Hell* (playing, ring at 36.7%), Louis Prima *Jump, Jive an' Wail*
  (expanded, seven dimension bars, two evidence links), Caravan Palace *Lone Digger*,
  Cab Calloway *Minnie the Moocher*, The Stranglers *Golden Brown* (no preview).

Both are self-contained: one Google Fonts `<link>`, all CSS in one `<style>`, all
illustration hand-authored inline SVG, no images, no external scripts.
