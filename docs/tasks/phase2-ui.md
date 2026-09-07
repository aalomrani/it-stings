# Phase 2 — search UI + preview player

Owner: one subagent (UI), plus reviewers. Starts after Phase 1 (core, sources, playlists/
placeholder) has landed. Ships as something the user can open and use with the placeholder
recommender behind it.

## Read first
`docs/spec.md` (Interface, Preview player, Art direction, Anti-brief), `docs/design.md` in
full, the reference mockups `docs/design/final/empty.html` and `results.html` (open them —
they are the visual contract; render them with headless Chrome if you want pixels),
`docs/architecture.md` (Shared types, Streaming protocol, Preview audio), and the routes
Phase 1 built under `src/app/api/`.

## Goal
The single-column app: empty state with the wasp and the hero search bar; typeahead;
selecting a track resolves it, shows the seed card + fingerprint panel, and streams
recommendations from `/api/recommend` into result cards with a working preview player.
Save-to-playlist from any card (minimal chooser; the playlist pages are Phase 4).

## Files you own
```
src/app/layout.tsx, src/app/page.tsx, src/app/globals.css, src/app/fonts.ts
src/components/**            (everything under it)
src/lib/client/**            (browser-side hooks/stores: player, sse, typeahead)
public/                      (only if you need static SVG; prefer inline)
src/components/__tests__/**  (component tests if you add @testing-library — optional)
```
Do not modify `src/lib/**` outside `src/lib/client/`, or any API route. If an API route
needs a change, describe it in your report instead.

## Build to the design system — non-negotiable
- Fonts via `next/font/google`: Bricolage Grotesque (variable, axes opsz/wdth/wght as in
  docs/design.md), IBM Plex Sans 400/500/600, IBM Plex Mono 400/500. Expose them as CSS
  variables in `layout.tsx`. Fallback stacks from the doc.
- Palette, texture law (every text block on its own opaque patch; speckle/halftone never
  under text), the nine-slice `border-image` edge frames, rotated bands not text, the
  focus system, the `why` treatment, the pathLength ring, the halftone-remainder match
  bars, the receipt stage line, the degraded notice, the provenance foot — port each
  component from the mockups. Tailwind is not installed; write CSS in `globals.css` and
  CSS modules (`*.module.css`) next to components.
- Wasp illustration: port the final SVG from `docs/design/final/empty.html` (masked
  speckle, portrait crop under 680 px, the three-frame sting animation with `steps()`, reduced-
  motion fallback pins the last frame). It is the only stepped-motion moment on the empty
  state; the results page has its own single moment (the scoring ink blot).
- The empty state: nothing above the search bar, input auto-focused, the wordmark below the
  strip as in the mockup. After a search, the page goes quiet: the wasp leaves, the small
  vertical wordmark appears at the left margin, the search strip holds the seed.
- Anti-brief applies (no soft-shadow card grid, no eyebrow caps, no arrows on buttons,
  no gradients). If a component would look at home in a SaaS dashboard it is wrong.

## Behaviour
### Search + typeahead (`SearchBar`, `Typeahead`)
- Debounce 200 ms; ignore < 2 chars; `GET /api/search?q=`; show up to 8 rows: artwork
  (200 px), title, artist, year. ARIA combobox/listbox with roving `aria-activedescendant`,
  ↑/↓ to move, Enter to select, Esc to close, click to select. Show a mono "searching
  itunes" hint while pending; "nothing on itunes for that" when empty.
- Selecting a row: `POST /api/resolve` → `TrackRecord`; push `?seed=<key>` into the URL
  (`router.replace`) so a reload restores the run from cache; then open the SSE stream.

### Run + streaming (`useRecommendStream`)
- `EventSource('/api/recommend?seed=…&sameArtist=…[&corrections=…]')`. Reduce events into
  `{ runId, cached, stages, seed, fingerprint, channels, verified, provisional[], final,
  degraded[], stats, error }`. Provisional results render as they arrive (append, keep
  arrival order); when `final` lands, re-sort to its order with a one-step reflow (no
  eased animation). On `error` show the degraded notice with the message; the page never
  blanks.
- Stage line: the receipt-style mono line from the mockup, ticks per stage, the live one
  with the ink blot, channel counts as they arrive (`found`, `verified`, `dropped`), the
  Channel-C drop-rate warning when > 20 %.
- Degraded notice for every `degraded` string (Channel B skipped, placeholder engine, …).

### Seed card + fingerprint panel
- Seed card exactly as the mockup: artwork, title, artist · year · isrc (each hard value
  with its source stamp; "year unknown" when null), play, "save the seed", deep links
  (Spotify link is the resolved track URL or the keyless search deep link; Deezer; iTunes;
  MusicBrainz when mbid exists).
- Fingerprint panel: the schema keys verbatim as mono labels, `tempo_bpm` and `tempo_feel`
  paired, `unknown` + the reasons when tempo is null (reasons come from
  `track.degraded`/sources — never a number), confidence chips, `grounded_on` chips, and
  the `× wrong` affordance per row. Clicking `wrong` strikes the row and adds the field to
  a `corrections` map; a "re-run with my corrections" button appears (drawn button) and
  re-opens the stream with `corrections` (the placeholder engine ignores them; Phase 3 uses
  them). A second click un-strikes.
- Same-artist toggle (drawn checkbox, off by default, label "include tracks by <artist>",
  the explanatory mono line from the mockup). Toggling re-runs.

### Result cards (`ResultCard`)
- Rank tag, artwork (600 px) with the ink edge, title, artist · year (or "year unknown"),
  the `why` with its rule, play button + ring + `m:ss / 0:30`, save, channel chips + final
  score, `<details>` "show the working" → per-dimension bars with weights and the halftone
  remainder, the score reconstruction line (exact numbers from `rank.ts` constants — import
  them, do not retype), evidence rows with `live`/`cached` stamps and clickable source links
  (`rel="noopener noreferrer"`, open in new tab), flags (same-artist-high-bar, multi-channel).
- "no preview" state: dashed ring, "no preview — open on spotify/deezer" links; the card
  stays.
- Keyboard: cards are a roving-tabindex list; ↑/↓ (and j/k) move focus between cards,
  Space toggles play on the focused card (and must not scroll the page), Enter toggles the
  details, `s` saves. Focus is visible per the design's focus system.

### Preview player (`src/lib/client/player.ts` + `PlayButton`, `ProgressRing`)
- One global `<audio>` element (in `layout.tsx` client provider). Only one card plays at a
  time; starting another stops the current. Progress ring driven by `timeupdate` →
  `stroke-dasharray` on the pathLength=100 ring. Ends at 30 s (or the clip's end) → resets.
- Source order per track: `track.preview.url` (Deezer, with `expiresAt`) → if expired or
  `error` event fires, `GET /api/preview?key=` once and retry → iTunes preview if that was
  not the source already → Spotify embed iframe (only if `track.ids.spotify` exists; render
  the embed in place of the ring, 80 px tall, lazy) → "no preview" state.
- Respect `prefers-reduced-motion` (ring still updates; no boil).

### Save (minimal)
- Save button opens a small drawn popover: list of playlists (`GET /api/playlists`), "new
  playlist" inline input, pick one → `POST /api/playlists/[id]/items` with `trackKey`, `why`,
  `seedKey`. Saved state on the button ("saved · <playlist>"). No playlist pages here.

### Footer / provenance
- The page-foot provenance list from the mockup, generated from the actual sources used in
  the run (`seed.degraded`, keys present via `GET /api/health`), including the mandatory
  credits: "tags and similar tracks powered by Last.fm" (link) when Last.fm is configured,
  "Tempo data by GetSongBPM" (link) when that key is configured, "previews by Deezer / iTunes".

## Prove it
1. `npm run typecheck && npm run lint && npm test && npm run build`.
2. Start dev on port 3123. With headless Chrome
   (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=<path> --window-size=1280,800 <url>`; note macOS floors `--window-size` width at 500 so for the mobile check use a DevTools-emulated width or a CSS check) capture: the empty state at 1280×800; the results page for `?seed=<Lovecats key>` after the placeholder run completes (use a small Node script with `EventSource`/fetch to wait for `final`, or take the screenshot after 20 s); one card expanded. Save screenshots under the scratch dir and list their paths.
3. With a Node script against the dev server: resolve The Lovecats, stream the run, assert
   provisional results arrived before `final`, and that `GET /api/preview?key=` returns a
   URL that responds 200/206 to a Range request.
4. Check the console for hydration warnings or errors (`--enable-logging=stderr` or a
   puppeteer-free approach: `next build` output + a `fetch` of the page HTML must not contain
   "Hydration").
5. Kill the dev server; confirm nothing listens on 3123.

## Report back
Component inventory with file paths; screenshot paths; the streaming assertion output;
keyboard behaviour list you implemented and tested; every place you deviated from the
design or spec with the reason; any API change you need; anything undone.
