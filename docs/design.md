# It Stings — visual design system

**Status: final.** This is the contract for the React build. Two rendered states live at
`docs/design/final/empty.html` and `docs/design/final/results.html`; they are self-contained
apart from one Google Fonts `<link>`. Every hex, size, filter value and path in this document
is copied from those two files. If the document and the files disagree, the files are wrong
and should be corrected to match this document — not the other way round.

Direction: **photocopied zine**, evolved. It is the base that won the two judge reviews, with
grafts from the inkwash and riso proposals named where they land.

---

## 1. Thesis

The *Deadline*-magazine end of the British alt-comic lineage: a page assembled at 2am out of a
brush pen, a photocopier with a dying drum, a scalpel and a Pritt Stick — heavy off-black paper,
ink that reads *light* because this is a copy of a copy, and two colours (an acid highlighter
green and a hot blood red) doing almost all the work. It fits because the engine's whole claim
is that it will find the specific thing in a song and say it out loud in one sentence, and a
zine is the only format that never hedges: one image huge, one sentence with the weight of a
headline, and "here is where this number came from" as a scrawled margin note rather than a
compliance footer. The discipline that keeps it from being a mess is a single law — **the mess
is in the frame, never in the content**: rotation, tearing, halftone and speckle live in the
furniture, and anything you have to *read* sits dead flat at 0° on its own opaque patch.

---

## 2. Palette

Ground is the paper. Ink is light. Ratios are WCAG 2.1 relative-luminance contrast, computed
with a script, not eyeballed.

| Token | Name | Hex | Role | on `--ground` | on `--card` | on `--raised` |
|---|---|---|---|---|---|---|
| `--ground` | Toner Black | `#141210` | The paper. Body background. | — | — | — |
| `--card` | Second Pull | `#1D1A16` | Pasted card / band / panel patch. Every text block sits on one of these. | 1.08 : 1 vs ground (a value step, not a border) | — | — |
| `--raised` | Third Pull | `#241F1A` | Inset well: expanded panel, artwork tiles, tag blocks. | 1.14 : 1 vs ground | — | — |
| `--bone` | Copier Bone | `#EDE9DD` | Primary ink. All body text, all linework. | **15.40** | **14.28** | **13.45** |
| `--dust` | Dust | `#A8A296` | Secondary text: mono labels, sources, metadata. | **7.36** | **6.83** | **6.43** |
| `--acid` | Highlighter Acid | `#D9F227` | The loud colour. Wordmark, headings, the `why` rule, match bars, evidence links, high confidence, focus rings. | **14.84** | **13.77** | **12.97** |
| `--blood` | Blood | `#E33127` | **Graphic marks only.** Cut lines, the notice spine, the wasp's eye, the bead at the stinger, the caret, the typeahead pointer rule. | 4.21 — non-text | 3.91 | 3.68 |
| `--blood-t` | Blood, thinned | `#F04438` | The only red allowed to carry small text (`degraded`, `skipped`). | **4.97** | **4.61** | 4.35 — **never on raised** |
| `--mint` | Dead Mint | `#6FBFB1` | Support tone. Channel C badge, `live` stamp, medium confidence. | **8.69** | **8.06** | **7.59** |
| `--ochre` | Nicotine | `#D89B2A` | Support tone. `cached` stamps, the drop-rate warning, weak dimensions, the no-preview tag, low confidence. | **7.69** | **7.13** | **6.72** |
| `--ink` | Ink | `#17140F` | Text *on* light patches: inside the bone strip, on acid / mint / ochre blocks. | 15.13 on bone · 14.59 on acid · 8.54 on mint · 7.56 on ochre · 7.24 on dust | | |
| `--ink-t` | Ink, thinned | `#5E574B` | Placeholder text and secondary text on bone/acid. | 5.88 on bone · 5.67 on acid | | |

Every live pairing in the two mockups clears **4.5 : 1**. The lowest is `--blood-t` on `--card`
at **4.61 : 1** (the `degraded` label). Two hard rules fall out of the table:

1. `--blood` is a **mark**, not a typeface colour. When red has to be read it is `--blood-t`,
   and never on `--raised`. The one non-text exception where blood must still be *seen* is the
   focus cut-line inside the bone search strip: blood on bone is 3.65 : 1, which clears the
   3 : 1 that WCAG 2.2 SC 1.4.11 asks of a non-text indicator.
2. **Colour never carries meaning alone.** Confidence chips say `high` / `medium` / `low` /
   `no data` in words. Channel badges say `A` / `B` / `C`. Evidence stamps say `live` or
   `cached <date> · not refreshed this run`. The skipped channel is struck as well as tinted.

Anti-brief check: black ground, highlighter lime and hot red accents. No warm cream, no
terracotta, no purple-to-blue.

---

## 3. Type

### 3.1 The link — verified, returns 200

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,200..800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
```

`curl` on that exact URL returns **HTTP 200** and serves three `@font-face` families;
Bricolage Grotesque comes back as `font-weight: 200 800; font-stretch: 75% 100%`. The `opsz`
axis is real on this family — the css2 endpoint returns **400** for an unknown axis and **200**
for `opsz,wdth,wght@96,76,800`, so all three axes are in the served variable font.

### 3.2 Families

| Role | Family | Axes / weights | Used for |
|---|---|---|---|
| Display | **Bricolage Grotesque** (variable) | `opsz 12–96`, `wdth 75–100`, `wght 200–800` | Wordmark, seed title, section headings, the fingerprint heading, the fixed spine |
| Body | **IBM Plex Sans** | 400, 500, 600 | Everything functional: the `why`, fingerprint values, result titles, notices, typeahead titles |
| Data | **IBM Plex Mono** | 400, 500 | Numbers, source attributions, labels, URLs, chips, stamps, the receipt line |

```css
--sans:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--display:"Bricolage Grotesque","Haettenschweiler","Arial Narrow",
          "Helvetica Neue Condensed Bold","Franklin Gothic Medium Cond",Impact,sans-serif;
```

The display fallback stack is deliberate: every entry after Bricolage is a real
condensed/compressed grotesque that ships on a real machine (Haettenschweiler and Franklin
Gothic Medium Cond on Windows, Helvetica Neue Condensed Bold on macOS, Arial Narrow and Impact
on both). If the webfont fails, the wordmark degrades to a *different* squashed display face,
never to Arial.

**Why this display face.** Bricolage Grotesque is drawn wrong on purpose — mismatched stem
widths, a lopsided `g`, corners that don't agree with each other, and a width axis that
compresses the letterforms into something that looks trimmed with a scalpel rather than
interpolated. It replaces Permanent Marker, which was costume rather than a drawn face and
whose lowercase renders as small caps, so every heading in the base proposal shouted and
flirted with the all-caps ban. **Headings here are sentence case** — `What it found`,
`What it thinks this is`, `Saved` — and they read as sentence case because this face has real
lowercase.

### 3.3 Axis settings

`font-variation-settings` overrides `font-weight`, so both are set and kept in sync.

| Element | Settings | Size |
|---|---|---|
| Wordmark (`.wordmark`) | `"opsz" 96,"wdth" 76,"wght" 800` | `clamp(3.1rem,11.4vw,7.4rem)`, line-height `.88`, tracking `-.02em` |
| Wordmark ≤680px | same | `clamp(2.9rem,15vw,4.4rem)` |
| Seed title (`h2.title`) | `"opsz" 40,"wdth" 84,"wght" 800` | `clamp(1.7rem,3.8vw,2.5rem)` / 1.02, tracking `-.015em`; `1.62rem` ≤520px |
| Section heading (`.sec h3`) | `"opsz" 32,"wdth" 82,"wght" 800` | `1.6rem`; `1.42rem` ≤520px |
| Fingerprint heading (`.fp-h h4`) | `"opsz" 24,"wdth" 82,"wght" 700` | `1.42rem` |
| Fixed spine (`.spine`) | `"opsz" 24,"wdth" 78,"wght" 800` | `22px`, shown ≥1180px only |

### 3.4 Size scale

Body faces only. Nothing is smaller than 10.5px, and nothing under 12px sets a sentence.

| Step | Size / leading | Face | Where |
|---|---|---|---|
| `why` | **16.5px / 1.62**, max **52ch** | sans 400 | the one-line reason. 15.5px, no max, ≤520px |
| base | 16px / 1.5 | sans 400 | body default |
| result title | `clamp(1.06rem,2.1vw,1.3rem)` / 1.2 | sans 600 | `h3.title` |
| typeahead input | 15px | sans 500 | `.ta-in` |
| fingerprint value | 14.5px / 1.5 | sans 400 | `.v` |
| playlist title | 14.5px | sans 500 | `.plrow .pt` |
| notice / evidence quote | 14px / 1.55 | sans 400 | `.notice p`, `.q` |
| typeahead title | 14px | sans 500 (600 on pointer) | `.ta .tt` |
| byline, dimension value | 12.5px / 12px | mono 400 | `.byline`, `.dv` |
| receipt line, buttons, summary | 12px | mono 400 | `.chan`, `.steps li`, `.btn`, `summary` |
| labels, sources, provenance | 11.5px | mono 400 | `.dn`, `.et`, `.src`, `.prov` |
| chips, stamps, tape | 10.5px | mono 400 | `.chip`, `.stamp`, `.tape` |

Search inputs: `clamp(1.02rem,2.05vw,1.7rem)` weight 500 on the empty state,
`clamp(1rem,1.9vw,1.42rem)` weight 500 on results.

**Never:** body copy in the display face. **Never:** all-caps eyebrow labels — small labels are
lowercase mono (`seed`, `degraded`, `parts · typeahead, not wired here`). Mono never sets a
sentence longer than a line, except the deliberately receipt-like `.drops` and `.cap` blocks.

---

## 4. The texture law, and the exact snippets

> **Texture never falls under a glyph.** Every text block in this system carries its own opaque
> patch — `--card`, `--raised` or `--bone`. That is the mechanism that makes the constraint
> enforceable rather than aspirational, and it is why a page-wide fixed grain overlay is
> **banned**: it would sit on top of every word on the page.

A new component that holds text must set an opaque `background` (or sit inside a parent that
does) before it is allowed to exist. This is a review gate, not a preference.

### 4.1 Paper tooth — the only texture allowed on the body

A flat dot field as an inline SVG data URI. Not a gradient. It only ever shows in margins and
gutters, because of the law above.

```css
body{
  background-color:#141210;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14'%3E%3Ccircle cx='2.5' cy='3' r='0.9' fill='%23EDE9DD' fill-opacity='0.055'/%3E%3Ccircle cx='9.5' cy='8.5' r='0.7' fill='%23EDE9DD' fill-opacity='0.045'/%3E%3Ccircle cx='6' cy='12' r='0.5' fill='%23EDE9DD' fill-opacity='0.035'/%3E%3C/svg%3E");
}
```

### 4.2 The rough-edge filter (`#xerox`)

The single filter that gives the direction its degraded-copy feel. `baseFrequency` is
anisotropic so the wobble is not a uniform ripple; `scale="4"` is about a brush nib at drawing
size — enough to look inked, small enough that a 6px stroke never breaks.

```html
<filter id="xerox" x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.026 0.033" numOctaves="3" seed="17" result="wob"/>
  <feDisplacementMap in="SourceGraphic" in2="wob" scale="4" xChannelSelector="R" yChannelSelector="G"/>
</filter>
```

**Allowed on:** the wasp group, the sting frames, the ink motif inside an artwork tile.
**Forbidden on:** any element containing text, any container edge that surrounds text, the
search strip, the match bars, the progress ring.
**Budget:** ≤ 8 filtered surfaces per rendered page. results.html uses 6 (one motif per card
plus the seed). Never put a filter on a per-row element — the losing proposal put one on 35
match ticks and blew its own budget 2×.

### 4.3 Toner speckle (`#toner`) — masked to the drawing, never a rect

`alpha = 1.6·R − 0.62`, so only the top ~38% of the noise field survives: a scattering of hard
specks, not a grey haze.

```html
<filter id="toner" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.74" numOctaves="4" seed="5" result="n"/>
  <feColorMatrix in="n" type="matrix"
    values="0 0 0 0 0.929  0 0 0 0 0.914  0 0 0 0 0.866  1.6 0 0 0 -0.62"/>
</filter>
```

The base proposal painted this through a rect covering the whole viewBox at 0.5 opacity, which
rendered as **a hard-edged grey card behind the wasp**. It is now masked to the wasp's own
geometry. The mask is a luminance mask over a second `<use>` of the same drawing, so bone masses
take the full speckle, the blood eye takes about a fifth of it, and the knocked-out ground gaps
take none — the speckle *is* the drawing:

```html
<mask id="m-wasp" maskUnits="userSpaceOnUse" x="-300" y="-300" width="2200" height="1600">
  <use href="#wasp-body"/>
</mask>
...
<g mask="url(#m-wasp)" pointer-events="none">
  <rect x="-300" y="-300" width="2200" height="1600" filter="url(#toner)" opacity="0.55"/>
</g>
```

The mask instance is deliberately *not* filtered with `#xerox` while the visible instance is —
the few-pixel disagreement is a misregistered speckle plate, and it costs one filter region
instead of two.

**Allowed on:** the empty-state illustration, and nowhere else.
**Forbidden:** as a fixed full-page overlay. Ever.

### 4.4 Halftone screens

Three, all rotated off-axis so they read as a misregistered separation rather than a CSS
pattern.

```html
<pattern id="ht-acid" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
  <circle cx="4.5" cy="4.5" r="2.05" fill="#D9F227"/>
</pattern>
<pattern id="ht-bone" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
  <circle cx="3.5" cy="3.5" r="1.35" fill="#EDE9DD"/>
</pattern>
<!-- the unscored remainder of a match bar. Texture doing data work. -->
<pattern id="ht-rem" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
  <circle cx="3" cy="3" r="1.5" fill="#A8A296" fill-opacity="0.40"/>
</pattern>
```

**Allowed on:** the wasp's wings, the collage blocks, artwork tiles inside cards, and the
**unscored remainder of a per-dimension match bar** (grafted from riso — it is the smartest
texture idea in the set because it costs zero legibility).
**Forbidden on:** anything behind a glyph, without exception. The losing proposal set four lines
of body copy on a pink halftone at 0.55 and produced 3.71 : 1. `#ht-rem` is safe precisely
because the number that describes the bar lives in a *separate grid column*, never on the bar.

### 4.5 Misregistration

One move, used three times: a second pull of the same shape in `--blood`, offset a few pixels,
flat, no blur. Under the wordmark (`.ghost` span, `translate(6px,-7px)`), under the fixed spine,
and under both search strips (the torn path drawn once in blood, then again in bone 8px above
it). It is the only offset shape in the system and it is a printing error, not a light source.
Never implement it with `z-index:-1` on a bare pseudo-element — see §5.3.

---

## 5. The `<Edge>` / frame technique

### 5.1 The bug this replaces

The base proposal drew container edges as one 100×100 path stretched with
`preserveAspectRatio="none"`. On a 900px-tall seed card that scales a 3-unit vertical wobble by
9×, so the "hand-drawn" edge bows by ~13px. That is not hand-drawn, that is broken. Both the
zine and riso proposals shipped it.

### 5.2 The fix: nine-slice via `border-image`

Corners are drawn 1 : 1 and never distort. Only the straight runs tile, and they tile along
their own axis only, so vertical deviation is fixed in absolute pixels regardless of card
height. One CSS property, no extra DOM node, no `<svg class="edge">` overlay, no
`pointer-events:none` hazard.

```css
:root{
  --e-fa-bone:url("data:image/svg+xml,…stroke='%23EDE9DD' stroke-width='1.6'…");  /* 100×100 */
  --e-fb-bone:url("…");   /* second geometry, different wobble phase */
  --e-fa-acid:url("…stroke='%23D9F227' stroke-width='1.8'…");
  --e-fb-dust:url("…stroke='%23A8A296' stroke-width='1.4'…");
  --e-fa-blood:url("…stroke='%23E33127' stroke-width='1.8'…");
  --e-ch-dust:url("…60×60, stroke-width 1.4…");   /* chip scale */
  --e-ch-acid:url("…60×60, stroke-width 1.6…");
  --e-ch-bone:url("…60×60, stroke-width 1.4…");
}
.card  { border:10px solid transparent; border-image:var(--e-fa-bone) 10 / 10px / 0 round; }
.btn   { border:6px  solid transparent; border-image:var(--e-ch-dust) 6  / 6px  / 0 round; }
```

Frames slice **10** of 100 with a **10px** border; chips slice **6** of 60 with a **6px**
border. `round` (not `stretch`, not `repeat`) is required: it rescales the tile to fit a whole
number of repeats, so the wobble *wavelength* stays roughly constant across card widths and no
tile is clipped mid-stroke.

**Seamlessness is a property of the source path and must be preserved when new geometries are
authored.** The top run must enter the middle slice at `(10, y₀)` and leave it at `(90, y₀)`
with the same `y₀`; the left run must enter at `(x₀, 10)` and leave at `(x₀, 90)`. Geometry A
uses `y₀ = 3.9` / `x₀ = 3.9`; geometry B uses `4.6` / `4.6`. Get that wrong and every tile join
shows as a step.

The background paints under the border area (`background-clip: border-box`, the default), so the
drawn line sits *on* the card's opaque patch rather than beside it. Container padding must be
≥ the border width; in practice `.card` uses `padding:10px 12px 14px` on top of the 10px border.

### 5.3 The React component

```tsx
type EdgeVariant = 'card' | 'card-alt' | 'seed' | 'panel' | 'notice' | 'chip' | 'chip-on';

// Edge is a *class*, not a wrapper element. It never adds a DOM node.
const EDGE: Record<EdgeVariant, string> = {
  card: 'edge-fa-bone', 'card-alt': 'edge-fb-bone', seed: 'edge-fa-acid',
  panel: 'edge-fb-dust', notice: 'edge-fa-blood',
  chip: 'edge-ch-dust', 'chip-on': 'edge-ch-acid',
};
export const edge = (v: EdgeVariant) => EDGE[v];

// usage
<article className={`card ${edge(i % 2 ? 'card-alt' : 'card')}`}>…</article>
```

Two geometries alternate down the result list so no two adjacent cards share an edge. **To kill
repetition at 15–20 cards** (the real result-set size), generate the variants at build time:
a Node script emits N pre-baked data URIs from a seeded PRNG that jitters the control points of
the four runs by ±1.4 units and the corner curls by ±0.8, writes them as `--e-card-0 … --e-card-N`,
and the component picks `n = hash(track.key) % N`. Runtime cost stays exactly zero — it is still
one `border-image` — and the seed is stable per track, so a card keeps its edge across
re-renders and re-sorts.

**One exception is allowed.** A `<use>`-stretched edge inside a *fixed-aspect* box is fine,
because a square box scales uniformly and cannot amplify anything. That is how artwork tiles
draw their border:

```html
<svg class="art" viewBox="0 0 100 100">…<use href="#tile-edge" stroke="#EDE9DD" stroke-width="1.6" fill="none"/></svg>
```

with `vector-effect="non-scaling-stroke"` on `#tile-edge`. Likewise
`preserveAspectRatio="none"` is legal on the search strip and the `.tear` rule **only because
their height is fixed by CSS**, so a content-sized box can never stretch them. Anywhere else it
is banned.

### 5.4 Stacking guard

Any component that paints a rotated band or a misregistered second pull behind its own text uses
a pseudo-element at `z-index:-1` **plus `isolation:isolate` on the host**. Without the isolation,
the pseudo-element escapes behind the card the first time anyone adds a `transform` to an
ancestor, which is the most likely first change anyone makes. Elements carrying the guard:
`.wordmark`, `.hint`, `.credits`, `.spine`, `.stages`, `.notice`, `.chip`, `.rank` (already a
stacking context via `position:absolute; z-index:3`), `.stamp`, `.tape`, `.tag`, `.toggle`,
`.nop`, `.parts`.

---

## 6. Composition

**Rotations** are quantised to a small set so they look like a person's hand, not a random
function: `−4°` (the rank number only), `−2.2°, −1.6°, −1.4°, −1.2°, −1.1°, −0.8°, −0.5°,
−0.4°, +0.9°, +1.1°, +1.4°`. Nothing exceeds ±2.2° except the rank block.

**Rotate the band, never the text.** This is a system rule, grafted from inkwash. A rotated
container that holds a sentence rotates a `::before` (background + `border-image`) by
0.7–1.5°, and the text stays at 0°. Counter-rotating the text back is not an acceptable
substitute — it costs subpixel antialiasing. Applied to: the degraded notice (`+0.9°`), the
receipt card (`−0.5°`), the parts sheet (`−0.4°`), the toggle (`−0.8°`), the wordmark patch
(`−2.2°`), the hint patch (`−1.1°`), the credits patch (`+1.4°`), confidence chips (`−1.2°`),
evidence stamps (`−1.4°`), tape labels (`−2.2°`), the rank block (`−4°`), the no-preview tag
(`−1.6°`).

Where a rotated band needs a spine as well, the spine is a **second pseudo-element sharing the
same box and origin** (`inset:0; border-left:6px solid var(--blood); transform:rotate(.9deg)`),
not an absolutely-sized strip — a 6px-wide strip rotated about its own centre drifts away from
a full-width band rotated about its.

**Never rotated, no exceptions:** the search field and its paper strip; the `why`; every result
title, artist and year; fingerprint field names and values; per-dimension match bars and their
numbers (*a rotated bar chart is a lie*); the provenance list; section headings — headings get
their crooked feel from the pasted tape beside them, not from tilting the words.

**Overlap.** Pasted things overlap their host by 8–16px and may break the container edge (the
rank number sits `−9px / −11px` outside the artwork tile; the `parts` tag straddles the panel
edge at `top:−11px`). Nothing is ever allowed to overlap a glyph.

**Bleed — the empty state.** The illustration is a full-viewport layer, not a plate on a page:

```css
main{position:relative;height:100dvh;overflow:hidden}
.art{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
```

Two crops of **one** drawing, both `preserveAspectRatio="xMidYMid slice"`:

| Crop | viewBox | Aspect | Shown |
|---|---|---|---|
| landscape | `0 0 1600 1000` | 1.60 | `min-width: 681px` |
| portrait | `900 -30 560 1120` | 0.50 | `max-width: 680px` |

**Safe region: `x 150–1450`, `y 140–905`.** With `slice`, a viewport wider than 1.60 crops the
height and a narrower one crops the width; the region above survives every aspect from 1.30 to
1.97. (Past 1.97 — an unusually wide, short window — only the lower edge of the blood bead
crops; the stinger, the shock ticks and every gaster band stay.) Everything outside the region
is drawn *to be cropped*: an antenna and the far wing run off the left edge, the forewing off
the right and the top, a tarsus off the bottom. At exactly 1280×800 the aspect matches the
viewBox and nothing is lost.

At 390×844 the portrait crop resolves to a visible window of **x 921–1439, y −30–1090**, which
holds the raised gaster, all three acid bands, the blood band, the trailing hind leg, the
stinger and the entire motion moment — and the drawing bleeds off *both* side edges instead of
shrinking into the middle of a black field. The head and thorax are cropped away on purpose:
the mobile view is the business end. The two things that carry the lower half of that crop are
the sting and the **trailing hind leg**, which dangles back under the raised gaster; without it
the bottom third of the phone screen is black.

**The drawing itself.** Filled bone masses with detail knocked back out in ground colour — a fat
brush pen leaves masses, not hairlines. Where a stroke really is a stroke it tapers by splitting
one gesture into sub-paths at different `stroke-width` (antenna: 15 → 9, then a club ellipse).
Cubic Béziers with deliberately uneven control-point spacing; no circles; nothing symmetrical
about any axis. Three near-side legs plus one long trailing hind leg, and **no ghosted far
legs** — a half-opacity duplicate set is visual mud. The legs are drawn *before* the gaster in
document order, so the trailing leg passes behind it. The thorax is a single mass with five hair strokes on the *outside* and **nothing
knocked out of the inside**, because two knocked-out arcs on a thorax read unmistakably as a
closed eye and a smile, and the creature is only allowed one face.

**Density.** The empty state is one object, huge, bleeding off every edge. The results page is
dense and quiet: the drawing is gone, the only illustration left is 56–88px artwork tiles, and
the display face appears four times on the whole page.

---

## 7. The one stepped-motion moment per page

Frame-based, `steps(1,end)`, hard cuts, never tweened. One moment per page, and nothing else on
either page moves.

### 7.1 `empty.html` — the sting

| Frame | Window | Drawn |
|---|---|---|
| 1 | 0 → 70% | stinger held back, a short spike |
| 2 | 70 → 82% | jab to full length, one blood speed tick |
| 3 | 82 → 100% | full jab, a blood bead, two drips, three bone shock ticks |

```css
.fr{opacity:0}
.f1{opacity:1}                    /* the resting frame if animation never starts */
.sting .fr{animation-duration:2.6s;animation-timing-function:steps(1,end);
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
  .f3{opacity:1}                  /* pinned on the punchline */
}
```

2.6s is slow on purpose: a drawing that occasionally moves, not a loading spinner.

Two things about the geometry are load-bearing and must not be "tidied":

- **The sting has to clear the paper strip.** Its base is at the gaster tip under the strip, so
  the strip severs it — but frame 1 runs to `y 668` and frames 2–3 to `y 860`, both well below
  the strip's lower edge at `y 554`. In an earlier cut the resting frame ended at `y 566` and
  was invisible: the one moving thing on the page was hidden behind the search bar.
- **Frame 3's shock ticks are drawn to `y 874` and the bead to `y 901`, inside the 1000-unit
  viewBox and inside the safe region**, so the punchline is never clipped. In the base proposal
  they were drawn to `y 840` in an 820-high viewBox and the joke was cut off.
- The mobile hint patch is narrowed to `max-width:min(58vw,28ch)` at ≤680px for the same
  reason: at full width it covered the stinger.

### 7.2 `results.html` — the scoring blot

The `scoring` marker in the receipt line is an ink blot spreading through three drawn frames
(small round blob → larger with one fleck → largest, irregular, two flecks), 1.2s, three equal
thirds. Reduced motion pins frame 2.

```css
.blot .fr{animation-duration:1.2s;animation-timing-function:steps(1,end);
          animation-iteration-count:infinite}
@keyframes b1{0%,33.32%{opacity:1} 33.33%,100%{opacity:0}}
@keyframes b2{0%,33.32%{opacity:0} 33.33%,66.65%{opacity:1} 66.66%,100%{opacity:0}}
@keyframes b3{0%,66.65%{opacity:0} 66.66%,100%{opacity:1}}
@media (prefers-reduced-motion:reduce){
  .blot .fr{animation:none} .f1,.f3{opacity:0} .f2{opacity:1}
}
```

**Deliberately static:** the 30-second progress ring. In the app it advances with
`audio.currentTime`; in the mock it is frozen at 0:11 so the page has exactly one moving thing.

`steps()` is the only permitted timing function in this direction. A spec change that needs an
eased transition needs a conversation first.

---

## 8. The focus system

Ported wholesale from riso, which had the best keyboard story of the three. **3px acid, offset,
on every interactive element**, plus `:focus-within` on the search bar. The base proposal
shipped its hero search field with `outline:0` and no replacement; that is treated as a
shipping blocker.

```css
.play:focus-visible,
.btn:focus-visible,
.strike:focus-visible,
.bar-clear:focus-visible,
.evi a:focus-visible,
.nop-note a:focus-visible,
.prov a:focus-visible,
summary:focus-visible,
.toggle input:focus-visible + .box{
  outline:3px solid var(--acid);
  outline-offset:3px;
}
/* the hero field: the ring is pushed clear of the bone paper onto the black
   ground, where acid reads at 14.84:1 */
.bar input:focus-visible{outline:3px solid var(--acid);outline-offset:6px}

/* and a drawn mark inside the paper, in blood — acid would vanish on bone */
.bar-rule{position:absolute;z-index:2;left:4%;right:84px;bottom:19%;height:3px;
          background:var(--blood);opacity:0;pointer-events:none}
.bar:focus-within .bar-rule{opacity:1}
```

Rules:

- **No element may set `outline:0` without a drawn replacement on the same element.** Both
  search inputs set `outline:0` in their base rule *and* define a `:focus-visible` outline plus
  a blood cut-line; that is the only sanctioned pattern.
- Acid is never the focus colour *on top of* a bone surface (1.06 : 1). Inside the paper strip
  the indicator is the 3px blood rule (3.65 : 1 on bone, clears SC 1.4.11), and the acid ring is
  offset outward onto the black ground.
- On the empty state the strip is inset by 2.6% (3.2% ≤680px) so the acid ring renders as a
  complete rectangle on the black ground. Both indicators — the ring outside and the blood rule
  inside — are present at once.
- The toggle's real `<input type="checkbox">` is visually hidden and the ring is drawn on the
  adjacent `.box` SVG via `input:focus-visible + .box`.
- `summary` is the disclosure control. It is keyboard-operable natively; do not replace it.

---

## 9. Component inventory

### 9.1 Wordmark

Below the search bar. **Nothing above the search bar, ever.** Text at 0°; the torn opaque patch
underneath is what rotates; a flat blood second pull sits between them.

```html
<h1 class="wordmark"><span class="ghost" aria-hidden="true">It Stings</span>It Stings</h1>
```
```css
.wordmark{position:absolute;left:clamp(14px,4vw,64px);bottom:clamp(76px,13vh,132px);
  margin:0;padding:10px 20px 14px;isolation:isolate;
  font-family:var(--display);font-variation-settings:"opsz" 96,"wdth" 76,"wght" 800;
  font-weight:800;font-size:clamp(3.1rem,11.4vw,7.4rem);line-height:.88;
  letter-spacing:-.02em;color:var(--acid)}
.wordmark::before{content:"";position:absolute;inset:-4px -10px -6px -8px;z-index:-2;
  background:var(--card);transform:rotate(-2.2deg);
  clip-path:polygon(0 7%,4% 0,29% 6%,55% 1%,81% 7%,100% 3%,98% 46%,100% 95%,
                    76% 100%,50% 94%,24% 100%,3% 95%)}
.wordmark .ghost{position:absolute;left:20px;top:10px;z-index:-1;color:var(--blood);
  transform:translate(6px,-7px);pointer-events:none}
```

The patch is required, not decorative: without it the wordmark would be acid text sitting
directly on the illustration, which the texture law forbids.

### 9.2 Search bar — the hero

A strip of photocopy paper laid across the drawing and cut through it. Two torn-edge paths in
one `<svg>` sized `preserveAspectRatio="none"`: the lower in `--blood` offset 8px, the upper in
`--bone` — misregistration, with a red cut-line peeking out at the bottom. The input has a
transparent background and no border of its own: **the paper is the field.**

- Empty state: `top:44%`, `left:2.6%;right:2.6%` (`3.2%` ≤680px),
  `height:clamp(62px,11.4vh,112px)`, `autofocus`, placeholder *"a song that got you — title,
  artist"* in `--ink-t`. A drawn stinger glyph in ink with a blood bead sits at the right end
  (decorative, `pointer-events:none`). The strip is inset rather than bled off the viewport for
  one reason: at `-3%` inside `overflow:hidden` the 3px acid focus ring at `outline-offset:6px`
  rendered as two clipped bars instead of a rectangle.
- Results: `height:clamp(58px,8vw,80px)`, carries the query, with a lowercase mono `clear`
  button at the right (`right:14px`, hover → `--blood`).
- Caret is `--blood`. Text is `--ink` on bone at 15.13 : 1.
- **44% is load-bearing on the empty state**: it is what keeps three acid bands and the blood
  band of the gaster above the cut. Do not move it without re-checking the drawing.

Submit is Enter, or selecting a typeahead row. **There is no `Find` button.**

### 9.3 Typeahead row — three states

The strip stays bone and grows downward: the dropdown is the same sheet of paper, so there is
no shadow and no gap. A 2px ink rule separates the field from the list. Each row is
`34px thumbnail | title over artist | year, right-aligned`.

| State | Treatment |
|---|---|
| default | bone ground, `.tt` 14px/500 ink, `.tb` 11px mono `--ink-t`, `.ty` 11px mono `--ink-t` |
| keyboard-highlighted (`.on`) | **flat acid block**, ink text at 14.59 : 1, `.tb` ink at 0.72 opacity. Never a tinted hover surface, never a shadow, never a rounded pill |
| pointer (`.hov`) | `box-shadow:inset 3px 0 0 0 var(--blood)` — a drawn rule at the left edge — and `.tt` goes to weight 600 |
| field focused | the acid ring, offset clear of the paper (`.ta-in .ring` in the specimen) |

The input keeps DOM focus and drives the list with `aria-activedescendant`; arrow keys move,
Enter selects, Escape closes. Debounced 200ms against iTunes Search. `inset` box-shadow is the
only shadow permitted anywhere in this system, and only here.

### 9.4 Stage / receipt line

A pasted card whose band is rotated `−0.5°`. Three lines of mono, because the pipeline is not
linear — three channels resolve independently and results stream in, so a progress bar would be
a lie.

```
resolve ✓  fingerprint ✓  channels ✓  verify ✓  ● scoring  ○ rank  ○ done
channel A last.fm 34 found 29 verified · channel B web search — skipped ·
channel C model prior 31 found 24 verified · 42 unique after dedupe · scoring 5 of 42
dropped in verify — did not resolve to a real track:
A 5 of 34 (14.7%) · C 7 of 31 (22.6% — over the 20% threshold, tighten the Channel C prompt)
```

Glyphs: a wobbly bone tick for `done`, the three-frame acid blot for the running stage
(`aria-current="step"`), a dust hollow circle for `todo`. The drop-rate line is the graft from
riso and it is **not optional** — it surfaces spec §Stage 4's own rule the moment it breaks, in
`--ochre` (7.13 : 1 on card).

### 9.5 Degraded notice

```css
.notice{position:relative;isolation:isolate;padding:18px 20px 18px 24px;margin:0 0 26px}
.notice::before{content:"";position:absolute;inset:0;z-index:-1;background:var(--card);
  transform:rotate(.9deg);
  border:10px solid transparent;border-image:var(--e-fa-blood) 10 / 10px / 0 round}
.notice::after{content:"";position:absolute;inset:0;z-index:-1;
  border-left:6px solid var(--blood);transform:rotate(.9deg)}
.notice p{margin:0;font-size:14px;line-height:1.55;color:var(--bone);max-width:64ch}
.notice .lbl{display:block;font-family:var(--mono);font-size:11px;color:var(--blood-t);margin:0 0 4px}
.notice code{font-family:var(--mono);font-size:13px;color:var(--acid)}
```

`role="status"`. It states the **consequence**, not just the failure, and it reconciles itself
with the cached evidence rows further down the page:

> **degraded**
> **Channel B skipped: no `TAVILY_API_KEY`.** No forum evidence was fetched in this run.
> Candidates below come from Last.fm and the model prior only; anything showing a thread link is
> reading it out of the evidence cache, and no cached mention earns the `+0.05` enthusiasm bonus
> today.

### 9.6 Seed card

`.card.seed` — the acid edge variant, the display-face title, an ISRC in the byline, `save the
seed` and `open on spotify`, and the fingerprint panel below. The seed is the only result-shaped
thing on the page that gets the display face.

### 9.7 Fingerprint panel row

Heading in the display face, acid, sentence case: *What it thinks this is*, with a mono subtitle
naming the model and offering the out: *"strike anything that is wrong."*

**Row labels are the schema keys, verbatim** — `tempo_bpm`, `tempo_feel`, `rhythmic_character`,
`instrumentation`, `vocal_delivery`, `harmonic_language`, `emotional_register`,
`production_texture`, `era`, `scene_context`, `signature_hook`, plus `grounded_on` for the
Last.fm tag block. This ties the UI to the JSON and is honest about being a data structure
without becoming an all-caps eyebrow.

`<div>` grouping inside `<dl>` is used so `tempo_bpm` and `tempo_feel` can sit **side by side**
(grafted from inkwash): the honesty policy is then readable in one glance instead of two rows
eight apart.

```css
.fprow{display:grid;grid-template-columns:1fr;border-bottom:1px solid rgba(237,233,221,.10)}
@media (min-width:760px){
  .fprow{grid-template-columns:172px minmax(0,1fr)}
  .fprow--pair{grid-template-columns:172px minmax(0,1fr) 128px minmax(0,1fr)}
}
```

Every row ends with a confidence chip and a `✕ wrong` strike button — the disagreement
affordance the spec asks for; hover turns it `--blood-t`. Rows whose value is a *measurement*
carry a `.src` line naming the source. The load-bearing row:

```
tempo_bpm   unknown                        [no data]  ✕ wrong
            deezer bpm 0 · no GetSongBPM key · no AcousticBrainz match — not guessed
```

**No number is ever invented, and the row says why there is no number.** `era` shows `1983` with
`itunes releaseDate 1983 · musicbrainz first release 1983 — copied, not inferred`.

**Confidence chip.** 10.5px mono, flat block, band rotated `−1.2°` with the word at 0°, always
carrying the word: `high` ink-on-acid, `medium` ink-on-mint, `low` ink-on-ochre, `no data` a
hollow dust outline.

### 9.8 Same-artist toggle

A real `<input type="checkbox">`, visually hidden, with a hand-drawn 22px box: a wobbly dust
square and an acid tick that is a two-stroke marker gesture, not a geometric check. Label in
mono, `include tracks by The Cure`, state spelled out (`off`) in dust beside it. Beside the
control, a mono note carrying the rule:

> off is the default. Switched on, a same-artist track has to clear 0.85 on its own and justify
> itself on musical grounds — decade and band name do not count.

### 9.9 Result card — collapsed

`--card` patch with a nine-slice bone edge, alternating geometry a/b down the list. Two columns:
88px artwork (64px < 640px, 56px ≤ 520px), then everything else.

- **Artwork.** In the app, the iTunes thumbnail on a `--raised` tile with a halftone screen and
  a drawn tile edge, rotated ±1.4° alternating. In the mocks each tile carries a hand-drawn ink
  motif instead — a hook, a flame, three scratch marks, a crescent, a curl of smoke. A blocky
  acid rank block (`01`…) is pasted over the top-left corner, its band at `−4°`.
- **Title** — IBM Plex Sans 600. *Not* the display face: after the empty state the page goes
  quiet, and five display headlines in a column would be noise.
- **Artist · year** — one mono line in `--dust`, with the year in `--bone` because the year is a
  sourced number.
- **The `why`** — see 9.10.
- **Transport row** — play button, elapsed time, `save`, then right-aligned channel badges and
  the final score. Channel badges are 16px mono squares: `A` on acid, `C` on mint, `B` as a
  dashed outline when that channel contributed nothing.
- **Save** — lowercase mono `save` inside a drawn chip edge; once saved the label becomes
  `saved` and both label and edge go acid. No icon, no arrow, no state colour without a word.

### 9.10 The `why`

Grafted from inkwash, which had the best-designed element in the whole set. Visibly the largest
and most cared-for block on the card, and the only one given a mark of its own.

```css
.why{
  position:relative;
  margin:12px 0 15px;
  padding-left:14px;
  font-size:16.5px;
  line-height:1.62;
  max-width:52ch;
  color:var(--bone);
}
.why::before{content:"";position:absolute;left:0;top:.2em;bottom:.2em;width:3px;
             background:var(--acid)}
```

One pseudo-element, flat, no filter. If the sentence would apply to any two songs in the same
genre, the pipeline is broken and the card should not exist.

### 9.11 Disclosure and the expandable panel

**Native `<details>` / `<summary>`. No JavaScript, keyboard-operable for free.** The label swaps
in CSS; the caret is a drawn ink stroke that rotates 90°.

```css
summary{display:inline-flex;align-items:center;gap:8px;cursor:pointer;list-style:none;
  font-family:var(--mono);font-size:12px;color:var(--bone);padding:8px 13px 9px;
  border:6px solid transparent;border-image:var(--e-ch-dust) 6 / 6px / 0 round}
summary::-webkit-details-marker{display:none}
summary::marker{content:""}
details[open] summary{color:var(--acid);border-image:var(--e-ch-acid) 6 / 6px / 0 round}
details[open] .caret{transform:rotate(90deg)}
.lbl-open{display:none}
details[open] .lbl-open{display:inline}
details[open] .lbl-shut{display:none}
```

Labels: `match & evidence` closed, `hide the working` open. Never an arrow, never a chevron
glyph from an icon set — the caret is a drawn stroke.

The panel opens on a `--raised` well with the dust panel edge. A mono heading states the units
before any number appears: *"per-dimension match against the seed fingerprint — model scores
0.00 to 1.00, with the weight each one carries into the overall."*

**Match bar.** Riso's idea, with the remainder doing data work:

```html
<li><span class="dn">rhythmic_character <span class="w">×3</span></span>
  <svg class="mbar" aria-hidden="true" focusable="false">
    <rect width="100%" height="12" fill="url(#ht-rem)"/>   <!-- unscored remainder -->
    <rect width="94%"  height="12" fill="#D9F227"/>        <!-- scored -->
    <rect x="94%" width="2" height="12" fill="#EDE9DD"/>   <!-- the read-off tick -->
  </svg>
  <span class="dv">0.94</span></li>
```

No `viewBox` on `.mbar`, so percentage widths map to CSS pixels and the halftone dots stay
round. Fill colours: `--acid` normally, `--ochre` below 0.50, `--dust` for `era` (which carries
weight ×0 and counts toward spread, never against a match). Bars and their numbers never rotate,
and **no text is ever set over the halftone remainder** — the value lives in its own grid column.

**Weights and the score line.** The weights are fixed in `engine/score.ts` and identical for
every candidate: `rhythmic_character` ×3, `vocal_delivery` ×3, `emotional_register` ×2,
`scene_context` ×2, `signature_hook` ×2, `instrumentation` ×1, `harmonic_language` ×1,
`production_texture` ×1, `era` ×0 — total weight **15**. They are printed inline next to each
dimension name, and the closing note reconstructs the final score exactly from numbers visible
on screen, using the formula in `docs/architecture.md` §Code-enforced ranking rules:

```
finalScore = modelScore + 0.12 × (channels − 1) + 0.05 if a forum mention is high-enthusiasm,
capped at 1.00
```

> weighted sum **12.30** over total weight **15** = model score **0.82**. Final **0.94** =
> **0.82** + **0.12** × (2 channels − 1) + **0.00** enthusiasm bonus — the reddit mention below
> is high-enthusiasm but it came out of the cache, and channel B did not run today, so it earns
> nothing.

All five cards in the mockup reconstruct exactly: 12.30/15 → 0.82 + 0.12 = **0.94**;
11.85/15 → 0.79 + 0.12 = **0.91**; 11.40/15 → 0.76 + 0.12 = **0.88**; 12.75/15 → 0.85 +
0.00 = **0.85**; 12.15/15 → 0.81 + 0.00 = **0.81**.

### 9.12 Evidence row — `live` or `cached`

**Every row is stamped.** This is the only honest way for "Channel B is skipped" and "here are
two evidence links" to coexist on the same page.

```html
<li>
  <p class="et"><span class="chn"><i class="a">A</i></span>
    <span class="stamp live">live</span>
    last.fm · track.getSimilar · match 0.42 · rank 9 of 100</p>
  <p class="q">…the surrounding sentence…</p>
  <a href="https://…">https://…</a>
</li>
```

`.stamp.live` is ink on `--mint` (8.54 : 1); `.stamp.cached` is ink on `--ochre` (7.56 : 1) and
reads `cached 2026-08-12 · not refreshed this run`. Band rotated `−1.4°`, text at 0°. URLs are
acid with a dimmed acid underline and `word-break:break-all` so they never overflow. A Channel C
row has no URL and says so: *a model prior is a claim, not a source.*

### 9.13 Progress ring

Grafted from inkwash. **A hand-inked wobbly path carrying `pathLength="100"`**, so elapsed maps
to `stroke-dasharray:"{pct} {100-pct}"` regardless of how irregular the path is — no
circumference maths in the component, and no perfect `<circle>` breaking the direction's own
rule.

```html
<path id="ring" pathLength="100"
  d="M24 5.4 C32.2 5.1 42.1 12.6 42.6 23.2 C43.1 34.4 33.6 43.2 23.4 42.6
     C13.2 42 5.1 33.8 5.5 23.4 C5.9 13.4 15.4 5.8 24 5.4 Z"/>
```
```html
<!-- 46px button, 48×48 viewBox. 11s of 30 = 36.7% -->
<use href="#ring" fill="none" stroke="#EDE9DD" stroke-width="4" opacity="0.24"/>
<use href="#ring" fill="none" stroke="#D9F227" stroke-width="4"
     stroke-dasharray="36.7 63.3" stroke-linecap="butt"/>
```

The path is authored starting at 12 o'clock and running clockwise, so **no `rotate(-90)` is
needed**. `stroke-dasharray` and `stroke` are inherited presentation attributes, so both are set
on the `<use>` and the shared path stays neutral. Glyph inside: a drawn triangle when paused,
two bars when playing. Only one card plays at a time; space toggles the focused card, arrows
move between cards.

`const dash = (t, dur) => `${(100*t/dur).toFixed(1)} ${(100-100*t/dur).toFixed(1)}``.

### 9.14 "No preview" state

The card does not disappear and does not grey out, and **the `why` is unchanged and full size**.
The ring becomes the same `#ring` path stroked dust, `stroke-dasharray="5 6"`, with a blood slash
through it; the button is `disabled`. Beside it an ochre `no preview` tag inside a drawn chip
edge, band at `−1.6°`. Below the transport row, one mono line stating exactly what failed and
offering the way out:

> `deezer: no preview · itunes: no previewUrl · spotify embed refused to load.`
> The card stays — **open it on spotify** or **on apple music**.

The panel note adds the principle: *a track with no preview is scored exactly like one with a
preview; the missing audio is a delivery problem, not a match problem.*

### 9.15 Playlist row

A shallow `--card` strip with the chip edge: drag grip (three wobbly bone lines) | 44px artwork
at `−1.6°` | title in 14.5px sans over a mono line naming the artist, the year **and the seed the
track came from** — provenance survives into the playlist | `play` and `✕`. At ≤520px the action
buttons drop to their own full-width row (`grid-column:1 / -1`). The header line above carries
the playlist name, the count as a pasted tape block, and `export as txt or json`.

### 9.16 Buttons and tape, generally

Every button is lowercase mono text inside a drawn chip edge, or bare text (`.btn.bare`). No
fills, no icons standing alone, **no arrow appended to any label**. Hover moves the label to
acid. Pasted tape/labels are flat blocks whose *band* is rotated, and they may hang off their
container.

### 9.17 Provenance foot

`where every number on this page came from` — a mono `<dl>` that sources every displayed value:
the year, the missing tempo, the raw tag counts, the funnel arithmetic and its drop rates, the
unique count, the weights, the score formula with each model score, the ring maths, the Last.fm
match values, and the cache dates. It is the best single answer to the spec's traceability rule
and it is not optional furniture — if a number appears on the page and not here, one of the two
is a bug.

---

## 10. Responsive rules

Two first-class breakpoints, **1280×800** and **390×844**, plus the ranges between.

| Breakpoint | What changes |
|---|---|
| `max-width:680px` (empty) | landscape crop hidden, portrait crop shown; strip `left/right:-4%`, `height:clamp(60px,9vh,84px)`; wordmark `clamp(2.9rem,15vw,4.4rem)`; hint follows the shorter strip |
| `max-width:520px` (results) | sheet 94vw; artwork 56px; `h2.title` 1.62rem; `.sec h3` 1.42rem; `why` 15.5px and unconstrained width; `.meta` drops to its own full-width row; playlist actions drop to their own row; typeahead thumbnail 30px |
| `max-width:620px` | dimension rows go two-area: `"k v" / "b b"` — name and value on one line, the bar full width beneath |
| `min-width:640px` | artwork 88px; provenance becomes a two-column `<dl>` |
| `min-width:760px` | fingerprint becomes `172px / 1fr`, and the tempo pair becomes `172px / 1fr / 128px / 1fr` |
| `min-width:1180px` | the fixed vertical `It Stings` spine appears in the left gutter |

Hard requirements, checked at 390×844:

- **No horizontal overflow.** `body{overflow-x:hidden}` is a safety net, not the mechanism —
  every grid uses `minmax(0,1fr)` for its flexible column and every long token
  (`overflow-wrap:anywhere` on `.dn`/`.fprow dt`, `word-break:break-all` on evidence URLs) is
  allowed to break.
- **The hero row must not clip.** The results bar sits inside the 94vw sheet; the empty-state
  strip bleeds by design and its content is padded well inside the viewport.
- **Every control is reachable**: the receipt line wraps, the transport row wraps, the toggle and
  its rule note stack.
- The empty-state art *bleeds off both side edges* at 390 rather than shrinking — a 385px-tall
  drawing floating in an 844px black field is the failure mode this replaces.

---

## 11. Do not

- **No page-wide grain or texture overlay.** It would sit on every word.
- **No texture behind any glyph**, including the halftone remainder of a match bar.
- **No `preserveAspectRatio="none"` on a content-sized box.** Only on the search strip and the
  `.tear` rule, whose heights are fixed by CSS. Container frames are nine-slice `border-image`.
- **No `border-radius` anywhere.** Zero in both files, verified by the checker.
- **No gradients, no `backdrop-filter`, no soft shadows.** The only shadow permitted is the
  `inset` rule on a hovered typeahead row. The only offset shape is the flat misregistered
  second pull.
- **No rotated text.** Rotate the band; leave the sentence at 0°. No counter-rotation either.
- **No perfect circles** as progress rings. `pathLength="100"` on a drawn path, always.
- **No filter on a per-row element**, and never more than 8 filtered surfaces on a page.
- **No `z-index:-1` pseudo-element without `isolation:isolate` on the host.**
- **No `outline:0` without a drawn replacement on the same element.**
- **No all-caps eyebrow labels.** Lowercase mono.
- **No arrow appended to a button label.** No `Find` submit button — Enter, or a typeahead row.
- **No icon standing alone** as the only meaning; every state carries a word.
- **No card grid.** One column, cards of different heights.
- **No warm cream, no terracotta, no purple-to-blue.**
- **No `<img>`, no `<script>`, no external asset** other than the one Google Fonts stylesheet.
- **No colour-only state.** `live` / `cached` / `skipped` / `high` / `no data` are words first.
- **No invented number.** Unknown tempo is `unknown` plus the reasons it is unknown.

---

## 12. How the mockups were checked

`docs/design/final/check.py` walks the raw tag stack of both files and asserts open/close
balance on every element, with an explicit report for `<svg>`, `<style>`, `<details>`, `<div>`
and `<section>`; resolves every `url(#…)`, `href="#…"`, `for=` and `aria-controls` reference;
rejects `border-radius`, gradients, non-inset `box-shadow`, `backdrop-filter`, `<img>` and
`<script>`; asserts `prefers-reduced-motion` and `:focus-visible` are present; and rejects any
external asset that is not Google Fonts. Run it whenever either file changes:

```
$ python3 docs/design/final/check.py docs/design/final/*.html

empty.html   (25,778 bytes)   svg 7/7    style 1/1   details 0/0  div 0/0   section 0/0   ALL OK
results.html (93,455 bytes)   svg 78/78  style 1/1   details 5/5  div 53/53 section 4/4   ALL OK
RESULT: ALL CHECKS PASS
```

The Google Fonts URL in both files returns **HTTP 200** and serves Bricolage Grotesque at
`font-weight: 200 800; font-stretch: 75% 100%`, plus both IBM Plex families.

Both files were also rendered in headless Chrome at a true 1280×800 and 390×844 (via the CDP
`Emulation.setDeviceMetricsOverride` — the `--window-size` flag silently floors at 500px on
macOS and will lie to you about the mobile layout), with `prefers-reduced-motion: reduce`
emulated to inspect the pinned final frame of the sting. results.html has zero pixels touching
the right edge of a 390-wide viewport down its full 9,409px height.

The placeholder data is realistic but invented for the mock: five results across 1956, 1981,
1994, 1996 and 2015 — one per artist, no Cure tracks, every `why` naming a concrete shared
trait. No BPM is shown anywhere, because none was measured.
