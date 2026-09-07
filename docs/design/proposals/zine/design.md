# It Stings — visual direction: **Photocopied Zine**

Proposal. Two rendered states live next to this file: `empty.html`, `results.html`. Open them
directly in a browser; they are self-contained apart from a Google Fonts `<link>`.

---

## 1. Thesis

The *Deadline*-magazine end of the British alt-comic lineage: a page assembled at 2am out of a
brush pen, a photocopier with a dying drum, a scalpel and a Pritt Stick. Everything is drawn or
cut; nothing is rendered. The paper is heavy off-black — this is a copy of a copy, so the ink
reads *light*, bone-white toner on black — and two colours do almost all the work: an
acid highlighter yellow-green and a hot blood red, backed by three dirty support tones.

Why it fits the product. The engine's whole claim is that it will find the *specific* thing in
a song and say so out loud. A zine is the format that never hedges: one image, huge; one
sentence, hand-lettered; a scrawled note in the margin saying where the fact came from. The
one-line `why` is the most important text on the page, and this direction is built to give a
single sentence the weight of a headline. The name is a small wound, so the empty state is a
wasp the size of the screen with the search bar cut through it, and the cursor blinks blood-red.

The discipline that keeps it from being a mess: **the mess is in the frame, never in the
content.** Rotation, tearing, halftone and speckle all live in the furniture — labels, tape,
edges, artwork tiles, the illustration. Anything you have to *read* — the search field, the
`why`, a fingerprint value, a number, a match bar — sits dead flat on an opaque patch at 0°
with no texture behind it.

---

## 2. Palette

Ground is the paper. Ink is light. Six colours plus a three-step black.

| Token | Name | Hex | Role | Contrast on ground `#141210` |
|---|---|---|---|---|
| `--ground` | Toner Black | `#141210` | The paper. Body background. | — |
| `--card` | Second Pull | `#1D1A16` | Pasted card / panel patch. | 1.08 : 1 vs ground (a value step, not a border) |
| `--raised` | Third Pull | `#241F1A` | Inset well: expanded panel, bar troughs, artwork tile. | 1.14 : 1 vs ground |
| `--bone` | Copier Bone | `#EDE9DD` | Primary ink. All body text, all linework. | **15.40 : 1** (14.28 on card, 13.45 on raised) |
| `--dust` | Dust | `#A8A296` | Secondary text: labels, sources, mono metadata. | **7.36 : 1** (6.83 on card, 6.43 on raised) |
| `--acid` | Highlighter Acid | `#D9F227` | The loud colour. Wordmark, headings, wasp stripes, match bars, "high" confidence, evidence links. | **14.84 : 1** (13.77 card, 12.97 raised) |
| `--blood` | Blood | `#E33127` | Graphic marks only: cut lines, tape spine, the wasp's eye, the bead at the stinger, the caret. | 4.21 : 1 — **non-text** (or ≥24px display only) |
| `--blood-t` | Blood, thinned | `#F04438` | The only red allowed to carry small text (the degraded label, "skipped"). | **4.97 : 1** (4.61 on card) — **never on `--raised` (4.35)** |
| `--mint` | Dead Mint | `#6FBFB1` | Support tone. Channel C mark, "medium" confidence. | **8.69 : 1** (8.06 card) |
| `--ochre` | Nicotine | `#D89B2A` | Support tone. Stale/cached markers, "low" confidence, the no-preview state. | **7.69 : 1** (7.13 card) |
| `--ink` | Ink | `#17140F` | Text *on* light patches: inside the bone search strip, on acid/mint/ochre chips. | 15.13 : 1 on bone; 14.59 on acid; 8.54 on mint; 7.56 on ochre; 7.24 on dust |
| `--ink-t` | Ink, thinned | `#5E574B` | Placeholder text and secondary text on bone/acid. | **5.88 : 1** on bone; 5.67 on acid |

Ratios are WCAG 2.1 relative-luminance contrast, computed with a script, not eyeballed. Every
combination the mockups actually use clears **4.5 : 1**; the lowest live pairing on the page is
`--blood-t` on `--card` at **4.61 : 1**.

Two hard rules that fall out of the table:

1. `--blood` (`#E33127`) is a **mark**, not a typeface colour. It cuts, underlines, bleeds and
   stains. When red has to be read, it is `--blood-t`, and never on `--raised`.
2. Colour never carries meaning alone. Confidence chips say `high` / `medium` / `low` /
   `no data` in words. Channel badges say `A` / `B` / `C`. The skipped channel is struck as
   well as tinted.

Anti-brief check: the ground is black, the accents are highlighter lime and a hot red. There is
no warm cream, no terracotta, no purple-to-blue anything.

---

## 3. Type

Loaded in one request:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Permanent+Marker&display=swap">
```

| Role | Family | Weights | Used for |
|---|---|---|---|
| Display | **Permanent Marker** | 400 (only weight) | Wordmark, seed title, section headings (`what it found`, `what it thinks this is`, `saved`) |
| Body | **IBM Plex Sans** | 400, 500, 600 | Everything functional: the `why`, fingerprint values, result titles, buttons, notices |
| Data | **IBM Plex Mono** | 400, 500 | Numbers, source attributions, labels, URLs, chips |

**Why the display face is "drawn / slightly wrong."** Permanent Marker is a scan of a chisel-tip
marker: the strokes have blunt entries, wet corners and inconsistent optical weight, the
counters half-close at speed, and the baseline visibly wanders. It is a *bad* typeface by every
metric a text face is judged on, which is exactly the point — it makes the wordmark look
lettered by a person in a hurry rather than set by a designer. It is used at three sizes and
nowhere else. Fallback stack: `"Permanent Marker","Comic Sans MS",cursive` — if the webfont
fails, the honest hand-lettered look degrades to a different hand-lettered look, not to Arial.

**Why the body face is "boring and legible."** IBM Plex Sans is a documentary grotesque with
open apertures, an unfussy `a`/`g`, and a genuinely good 12–14px range. It was drawn for
technical documentation, so it reads as *evidence* rather than as *brand* — which is what the
`why` sentence and the fingerprint values need to be. It is deliberately not Inter: Inter is
the house face of the SaaS dashboard the anti-brief forbids.

IBM Plex Mono is a third family and needs justifying: the spec says every displayed number must
be traceable. Giving numbers, source names and cache timestamps their own machine face makes
"this is a measurement and here is where it came from" a *typographic* distinction, not a
colour one. Mono never sets a sentence longer than a line.

Never: body copy in the display face. Never: all-caps eyebrow labels — small labels are
lowercase mono (`seed`, `degraded`, `parts · typeahead, not wired here`).

---

## 4. Linework

Two techniques, used together.

### 4.1 Hand-authored paths with varying weight

The wasp is not a stroked outline; it is a **filled bone silhouette** with details knocked back
out in ground colour — a fat brush pen leaves masses, not hairlines. Where a stroke is genuinely
a stroke (legs, antennae, wing veins), weight is varied by **splitting one gesture into two or
three sub-paths at different `stroke-width`**, which is how a real pen tapers:

```html
<!-- one antenna, tapering: 14px at the root, 8px at the tip, then a club -->
<g fill="none" stroke="#EDE9DD" stroke-linecap="round">
  <path d="M208 190 C176 156 148 132 120 108" stroke-width="14"/>
  <path d="M120 108 C110 98 100 90 90 82"     stroke-width="8"/>
</g>
<ellipse cx="82" cy="74" rx="16" ry="11" fill="#EDE9DD" transform="rotate(-38 82 74)"/>
```

Curves are cubic Béziers with deliberately uneven control-point spacing; no circles, no
`rx == ry` except where a shape is meant to read as a blob. Nothing in the illustration is
symmetrical about any axis.

### 4.2 The photocopy-wobble filter

Every drawn element then gets shoved around by noise, so no edge is ever mathematically
straight. This is the single filter that gives the whole direction its degraded-copy feel:

```html
<filter id="xerox" x="-6%" y="-6%" width="112%" height="112%"
        color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.026 0.033"
                numOctaves="3" seed="17" result="wob"/>
  <feDisplacementMap in="SourceGraphic" in2="wob" scale="4"
                     xChannelSelector="R" yChannelSelector="G"/>
</filter>
```

`baseFrequency` is anisotropic (0.026 × 0.033) so the wobble is not a uniform ripple; `scale="4"`
is about the width of a brush nib at this drawing size — enough to make a line look inked,
small enough that a 6px stroke never breaks. Applied to: the wasp group, the sting frames, the
artwork motifs inside result cards.

**Never applied to:** any element containing text, any container edge that surrounds text, the
search strip, the match bars.

### 4.3 Container edges

Cards, panels, chips and buttons cannot use a filter (they contain text), so their edges are
drawn instead: one path per style, defined once, stretched per instance, with the stroke kept
at a constant 1.6px by `vector-effect`:

```html
<!-- once, in <defs> -->
<path id="edge-a" vector-effect="non-scaling-stroke"
  d="M1.6 2.2 C20 1.0 44 2.4 66 1.4 C80 0.8 92 1.9 98.5 1.8 C99.1 20 98.3 46 98.8 68
     C99.1 82 98.0 94 98.3 98.0 C78 99.2 52 97.8 30 98.8 C16 99.4 6 98.2 1.5 98.4
     C0.9 80 1.8 54 1.2 32 C0.9 18 2.0 6 1.6 2.2 Z"/>

<!-- per card, absolutely positioned, inset:0, pointer-events:none -->
<svg class="edge" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  <use href="#edge-a"/>
</svg>
```

`preserveAspectRatio="none"` means the same path stretches to any card size and the wobble
*changes shape* per card — which is the point: no two boxes have the same edge. Three variants
exist (`edge-a` cards, `edge-b` panels, `edge-c` chips/buttons/tiles) so nothing repeats
visibly. There is not a single `border-radius` in either file.

---

## 5. Texture

### 5.1 Halftone screens

Flat colour, screened. Two pitches, both rotated off-axis so they read as a misregistered
separation rather than a CSS pattern:

```html
<pattern id="ht-acid" width="9" height="9" patternUnits="userSpaceOnUse"
         patternTransform="rotate(18)">
  <circle cx="4.5" cy="4.5" r="2.05" fill="#D9F227"/>
</pattern>

<pattern id="ht-bone" width="7" height="7" patternUnits="userSpaceOnUse"
         patternTransform="rotate(-24)">
  <circle cx="3.5" cy="3.5" r="1.35" fill="#EDE9DD"/>
</pattern>
```

**Allowed on:** the wasp's wings, collage blocks in the empty state, artwork tiles inside cards.
**Forbidden on:** anything behind a glyph.

### 5.2 Toner speckle

Sparse bone dust, generated from noise. The alpha is driven off the red channel so the result
is a scattering of hard specks, not a grey haze:

```html
<filter id="toner" x="0%" y="0%" width="100%" height="100%"
        color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.74" numOctaves="4" seed="5" result="n"/>
  <feColorMatrix in="n" type="matrix"
    values="0 0 0 0 0.929
            0 0 0 0 0.914
            0 0 0 0 0.866
            1.6 0 0 0 -0.62"/>
</filter>
```

`alpha = 1.6·R − 0.62`, so only the top ~38% of the noise field survives → speckle at roughly
one dot per few hundred pixels. Painted as one rect over the illustration at `opacity: 0.5`:

```html
<rect x="0" y="0" width="1100" height="820" filter="url(#toner)"
      opacity="0.5" pointer-events="none"/>
```

**Allowed on:** the empty-state illustration, and nowhere else in these two files.
**Forbidden:** as a full-page fixed overlay. That is the obvious move and it is banned, because
a page-wide grain layer sits *on top of every word on the page*.

### 5.3 Paper tooth

The ground gets a faint dot field as an inline SVG data URI — a pattern, not a gradient:

```css
body{
  background-color:#141210;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14'%3E%3Ccircle cx='2.5' cy='3' r='0.9' fill='%23EDE9DD' fill-opacity='0.055'/%3E%3Ccircle cx='9.5' cy='8.5' r='0.7' fill='%23EDE9DD' fill-opacity='0.045'/%3E%3Ccircle cx='6' cy='12' r='0.5' fill='%23EDE9DD' fill-opacity='0.035'/%3E%3C/svg%3E");
}
```

It only ever shows in the margins and gutters, because **every text block in this system carries
its own opaque patch** (`--card` or `--raised` or `--bone`). That is the mechanism that makes
"texture, never under body text" enforceable rather than aspirational.

### 5.4 Misregistration

One move, used twice: a second pull of the same shape in `--blood`, offset a few pixels, flat,
no blur. On the wordmark (`::before` with the same string, translated 5px / −6px) and under the
search strip (the torn path drawn once in blood, then again in bone 8px above it). It is the
only "shadow" in the system and it is a printing error, not a light source.

---

## 6. Composition

**Rotations.** Quantised to a small set so they look like a person's hand, not a random
function: `−2.6°, −2.2°, −1.6°, −1.4°, −1.2°, −0.8°, −0.5°, +0.7°, +1.1°, +1.4°, +1.8°, +2.2°`.
Nothing exceeds ±2.6°.

**Rotated:** the wordmark, pasted labels and tape, confidence chips, the rank number, the
degraded notice, the stage strip, artwork tiles (alternating sign down the list so the column
reads as hand-pasted), section headings, the parts sheet, the same-artist toggle.

**Perfectly straight, always, no exceptions:**

- the search field and its paper strip
- the `why` sentence and every result title / artist / year
- fingerprint field names and values
- per-dimension match bars and their numbers — *a rotated bar chart is a lie*
- the provenance list

**Overlap.** Pasted things overlap their host by 8–16px and are allowed to break the container
edge (the rank number sits −8px / −10px outside the artwork tile; the `parts` tag straddles the
panel edge at `top:-11px`). Nothing is ever allowed to overlap a glyph.

**Bleed.** In the empty state the illustration is wider than its column (138% at small sizes)
and runs off both edges; a torn strip runs down the left edge of the viewport; a registration
cross sits in the top-right corner. Off-grid, but the search bar is dead centre and level.

**Density.** The empty state is one object, huge, on a lot of black. The results page is dense
and quiet: the drawing is gone, the only illustration left is 64–88px artwork tiles, and the
display face appears three times on the whole page.

---

## 7. The one stepped-motion moment

Frame-based, `steps(1, end)`, three drawn states, hard cuts. One moment per page.

### 7.1 `empty.html` — the sting

The wasp's stinger is drawn three times and the frames are swapped. It holds still for most of
the loop, then jabs.

| Frame | Window | What is drawn |
|---|---|---|
| 1 | 0 → 70% | stinger held back — a short spike |
| 2 | 70 → 82% | jab out to full length, one blood speed-tick |
| 3 | 82 → 100% | jab out, a bead of blood at the tip, two drips, three bone shock-ticks |

```css
.fr{opacity:0}
.f1{opacity:1}                       /* the resting frame, if animation never starts */
.sting .fr{animation-duration:2.6s;
           animation-timing-function:steps(1,end);
           animation-iteration-count:infinite}
.sting .f1{animation-name:frame1}
.sting .f2{animation-name:frame2}
.sting .f3{animation-name:frame3}
@keyframes frame1{0%,69.99%{opacity:1} 70%,100%{opacity:0}}
@keyframes frame2{0%,69.99%{opacity:0} 70%,81.99%{opacity:1} 82%,100%{opacity:0}}
@keyframes frame3{0%,81.99%{opacity:0} 82%,100%{opacity:1}}

@media (prefers-reduced-motion:reduce){
  .sting .fr{animation:none}
  .f1,.f2{opacity:0}
  .f3{opacity:1}                     /* pinned on the punchline: bead, drips, ticks */
}
```

The doubled keyframe stops already give hard switches; `steps(1,end)` is belt and braces so no
engine can tween the opacity. 2.6s is slow on purpose — it should read as a drawing that
occasionally moves, not a loading spinner.

### 7.2 `results.html` — the scoring blot

The `scoring` marker in the stage indicator is an ink blot spreading through three frames
(small round blob → larger with one fleck → largest and irregular with two flecks), 1.2s,
three equal thirds. Reduced motion pins frame 2.

```css
@keyframes b1{0%,33.32%{opacity:1} 33.33%,100%{opacity:0}}
@keyframes b2{0%,33.32%{opacity:0} 33.33%,66.65%{opacity:1} 66.66%,100%{opacity:0}}
@keyframes b3{0%,66.65%{opacity:0} 66.66%,100%{opacity:1}}
```

**Deliberately static:** the 30-second progress ring. In the real app it advances with
`audio.currentTime`; in this mock it is frozen at 11 s so the page has exactly one moving thing.

---

## 8. Component inventory

### 8.1 Search bar — *the hero*

A strip of photocopy paper laid across the drawing and cut through it. Two torn-edge paths in
one `<svg>` sized `preserveAspectRatio="none"`: the lower one in `--blood`, offset 8px down, the
upper one in `--bone` — misregistration, and a red cut-line peeking out at the bottom. The input
sits on top with a transparent background and no border of its own: the paper *is* the field.
Text is `--ink` on bone at 15.13 : 1, ~27px on desktop, weight 500. The caret is `--blood`.
Placeholder in `--ink-t`: *"a song that got you — title, artist"*. On focus a 3px blood rule
appears under the text inside the paper — a drawn underline, not a glow ring. At the right end,
a small drawn stinger glyph in ink with a blood bead. `autofocus` on load. Nothing above it.
On results the same strip is shorter (58–80px) with the query in it and a lowercase mono
`clear` at the right.

### 8.2 Typeahead dropdown row

The strip stays bone and grows downward — the dropdown is the same sheet of paper, not a
floating panel, so there is no shadow and no gap. A 2px ink rule separates the field from the
list. Each row: 34px drawn artwork thumbnail | title (15px, weight 500, ink) over artist (11px
mono, `--ink-t`) | year, mono, right-aligned. The active row is a **flat acid block** with ink
text (14.59 : 1) — never a tinted hover surface, never a shadow, never a rounded pill. Debounced
200ms against iTunes Search; arrow keys move, Enter selects, Escape closes. Rendered as a
specimen at the bottom of `results.html`.

### 8.3 Stage / progress indicator

A pasted card rotated −0.5°, two lines. Line one: the seven pipeline stages as lowercase mono
with hand-drawn glyphs — a wobbly bone tick for `done`, the three-frame acid blot for the
running stage (`aria-current="step"`), a bone-dust hollow circle for `todo`. Line two, one line
of mono: per-channel counts and the union. It is a receipt, not a progress bar, because the
pipeline is not linear — three channels resolve independently and results stream in.

```
resolve ✓  fingerprint ✓  channels ✓  verify ✓  ● scoring  ○ rank  ○ done
channel A last.fm 34 found 29 verified · channel B web search — skipped ·
channel C model prior 31 found 26 verified · 43 unique after dedupe · scoring 5 of 43
```

### 8.4 Result card

A `--card` patch with a drawn `edge-a` outline. Two columns: 88px artwork (64px on mobile),
then everything else.

- **Artwork.** In the app, the iTunes thumbnail on a `--raised` tile with a halftone screen and
  a drawn `edge-c` border, rotated ±1.4° alternating down the list. In these mocks nothing loads
  from the network, so each tile carries a hand-drawn ink motif instead — a hook, a flame, a
  trumpet bell, a curl of smoke, three scratch marks, a crescent. A blocky acid rank number
  (`01`…) is pasted over the top-left corner at −4°.
- **Title** — IBM Plex Sans 600, 17–21px, bone. Not the marker face: after the empty state the
  page goes quiet, and five marker headlines in a column would be noise. Only the seed title
  gets the display face.
- **Artist · year** — one mono line, `--dust`, with the year in bone because the year is a
  sourced number.
- **The `why`** — 16–17.5px / 1.52, bone, `max-width: 64ch`, with real space above and below.
  It is the largest body text on the page and the only thing on a card allowed more than one
  line. If it reads like it would apply to any two songs in the same genre, the pipeline is
  broken and the card should not exist.
- **Transport row** — play button, elapsed time, `save`, `why · expand`, then right-aligned
  channel badges and the final score.
- **Play button with 30s ring.** 46px. A bone track circle at 24% opacity, `r = 19`, so
  `C = 2πr = 119.38`. Elapsed is `stroke-dasharray: (fraction × C) (C − fraction × C)` rotated
  −90° about the centre. At 11 s of 30 that is `43.77 75.61`. Butt caps, 4px, acid. Inside:
  a drawn triangle when paused, two bars when playing. Only one card plays at a time; space
  toggles the focused card, arrows move between cards.
- **Save button.** Lowercase mono `save` inside a drawn `edge-c` outline; once saved the label
  becomes `saved` and both label and edge go acid. No icon, no arrow, no state colour without
  a word.
- **Channel badges.** 16px mono squares: `A` on acid, `C` on mint, `B` as a dashed outline when
  that channel contributed nothing.
- **Score.** Bone mono, right-aligned, two decimals. It is the *final* score, and the
  provenance list at the foot of the page says how it was derived from the model score.

### 8.5 Expandable panel

Opens inside the card on a `--raised` well with an `edge-b` outline. A mono heading states the
units before any number appears: *"per-dimension match against the seed fingerprint — model
scores, 0.00 to 1.00"*. Then one row per fingerprint field: name (mono, dust) | trough | value
(mono, bone, right-aligned). The trough is a 13px drawn `edge-c` box; the fill is flat acid with
a torn right edge via `clip-path`, ochre when the dimension is weak, dust for era distance —
which is *not* a fault. Bars and their labels never rotate.

Underneath, a mono note reconciling the numbers: model score, final score, and why the overall
is not the mean of the bars. Then **evidence**: each row is channel badge, source, an optional
staleness tag, the quoted sentence in bone, and the URL in acid with a dimmed acid underline,
`word-break: break-all` so it never overflows. A cached row is stamped with an ochre
`from cache · 2026-08-12 · not re-fetched` tag at −1.4°.

### 8.6 Fingerprint panel

Sits inside the seed card under a marker-face heading in acid, *"what it thinks this is"*, with
a mono subtitle naming the model and offering the out: *"strike anything that is wrong."*

A two-column `<dl>` at ≥720px, stacked below: field name in mono dust, value in 14.5px bone
sans. Each row ends with a confidence chip and a `✕ wrong` strike button (the disagreement
affordance the spec asks for; hovering turns it blood). Rows whose value is a *measurement* get
a third line in mono dust naming the source.

The `tempo` row is the load-bearing one and it reads:

```
tempo    unknown                                            [no data]  ✕ wrong
         deezer bpm = 0 · GETSONGBPM_API_KEY not set ·
         no acousticbrainz mbid match — not guessed
```

No number is invented, and the row says *why* there is no number. `era` shows `1983` with
`itunes releaseDate · musicbrainz first release — copied, not inferred`.

The last row is the Last.fm tag cloud with raw counts, the three tags Channel A pivoted on
shown as flat acid blocks. It shows the mechanism: not "rock", not "80s" — `jazz`, `swing`,
`lounge`.

**Confidence chip.** 10.5px mono, flat block, rotated −1.2°, always carrying the word:
`high` ink-on-acid, `medium` ink-on-mint, `low` ink-on-ochre, `no data` a hollow dust outline.

### 8.7 Playlist row

A shallow `--card` strip, `edge-c`: drag grip (three wobbly bone lines) | 44px artwork at −1.6°
| title in 14.5px sans over a mono line that names the artist, the year **and the seed the track
came from** — the provenance survives into the playlist | `play` and `✕`. Rows reorder by drag;
the header line above carries the playlist name, the count, and `export as txt or json`.

### 8.8 "No preview" state

The card does not disappear and does not grey out. The ring becomes a dashed dust circle with a
blood slash through it; the button is `disabled`. Beside it, an ochre `no preview` tag at −1.6°
inside a drawn outline. Below the transport row, one mono line that says exactly what failed and
offers the way out:

> `deezer: no preview · itunes: no previewUrl · spotify embed refused to load.`
> The card stays — **open it on spotify** or **on apple music**.

The `why` is unchanged and still full size. A track you cannot preview is still an answer.

### 8.9 "Channel skipped" notice

A pasted strip with a 6px blood spine down the left edge, rotated +0.7°, `edge-c` in blood. A
lowercase mono label `degraded`, then a plain-sans sentence with the env var in acid mono:

> **Channel B skipped: no `TAVILY_API_KEY`.** No forum evidence was fetched in this run.
> Candidates below come from Last.fm and the model prior only; anything showing a thread link
> is reading it out of the evidence cache.

It states the consequence, not just the failure, and it reconciles itself with the cached reddit
link that appears further down the page. Degraded results beat an error page, but the user is
told precisely what they are missing.

### 8.10 Same-artist toggle

A real `<input type="checkbox">`, visually hidden, with a hand-drawn 22px box: a wobbly dust
square, and an acid tick that is a two-stroke marker gesture rather than a geometric check.
Label in mono, `include tracks by The Cure`, with the state spelled out (`off`) in dust beside
it. Beside the control, a mono note carrying the rule:

> off is the default. Switched on, a same-artist track has to clear 0.85 on its own and justify
> itself on musical grounds — decade and band name do not count.

### 8.11 Buttons and tape, generally

Every button is lowercase mono text inside a drawn `edge-c` outline, or bare text. No fills, no
icons standing alone, **no arrow appended to any label**. Hover moves the label to acid. Pasted
tape/labels are flat blocks with torn `clip-path` polygons, rotated, and may hang off their
container.

---

## 9. What this direction refuses

- No rounded corners anywhere — zero `border-radius` in either file, verified by the checker.
- No soft shadows, no glassmorphism, no `backdrop-filter`. The only offset shape is a flat
  misregistered second pull.
- No gradients of any kind — verified by the checker.
- No all-caps eyebrow labels. Small labels are lowercase mono.
- No arrow appended to a button label.
- No warm cream, no terracotta, no purple-to-blue.
- No card grid. One column, cards of different heights, rotations alternating.
- No page-wide grain overlay, because it would sit over the text.

---

## 10. Files and how they were checked

| File | What it is |
|---|---|
| `empty.html` | Empty state. Full-viewport wasp, search strip cut through it, autofocused, three-frame sting. Sized against both axes so it never clips at 1280×800 or 390×844. |
| `results.html` | Post-search state for **"The Lovecats" — The Cure (1983)**: stage indicator mid-`scoring`, channel B skipped notice, seed card with the full fingerprint (tempo `unknown`), same-artist toggle off, five results — one playing at 0:11/0:30, one expanded with per-dimension bars and two evidence links, one with no preview — a playlist row, a typeahead specimen, and a provenance list for every number on the page. |

Both were run through a node checker that walks the tag stack, resolves every `url(#…)` and
`href="#…"` and `for=` reference, counts `<style>`/`<svg>`/brace/paren balance, validates every
`d=` attribute, rejects any non-inline asset other than the Google Fonts stylesheet, and asserts
the presence of `prefers-reduced-motion` and the absence of gradients, non-inset shadows,
`backdrop-filter`, `border-radius`, `<img>` and `<script>`. Both pass clean.

The placeholder data is realistic but invented for the mock: five results across 1931, 1956,
1981, 1996 and 2015, one per artist, no Cure tracks, and every `why` naming a specific shared
trait. The final scores shown (0.94 / 0.91 / 0.88 / 0.85 / 0.81) are consistent with the
architecture's rule `finalScore = modelScore + 0.12 × (channels − 1)`, and the funnel arithmetic
(29 + 26 − 12 overlap = 43 unique) checks out. No BPM is shown anywhere, because none was
measured.
