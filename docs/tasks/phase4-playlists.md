# Phase 4 — playlists UI

Owner: one subagent. Starts after Phase 2 (UI) has landed; the playlist API exists since
Phase 1 task C.

## Read first
`docs/spec.md` (Playlist), `docs/design.md` (playlist row, buttons, edge frames, focus
system), the Phase 2 components under `src/components` and `src/lib/client` (reuse
`PlayButton`, `ProgressRing`, the player store, the edge/frame classes, the drawn
buttons), and the API under `src/app/api/playlists`.

## Goal
- `/playlists`: list of playlists (name, count, updated), create (inline drawn input),
  rename (inline), delete (drawn confirm — an inline "sure? delete" second click, not a
  browser `confirm()`), open.
- `/playlists/[id]`: the playlist view. Rows per the design's playlist-row specimen:
  position, artwork, title, artist · year, the saved `why` (from the run it was saved
  from, if any), play button + ring, remove, drag handle. Reorder by drag (pointer) AND by
  keyboard (focus a row, Alt+↑/↓ moves it); persists via `PATCH /api/playlists/[id]`
  `{ order }`. "Play all" plays previews in sequence (row 1 → 2 → … using the global
  player; a row without a preview is skipped with a mono note); "stop". Export buttons:
  "export text" and "export json" hitting the export route (`<a download>` to the route
  URL — this is a local app, downloads are the user's own action).
- Header link from the main page ("playlists · n") and back link; the same quiet
  post-search visual register (ink outlines, flat fills, grain in the frame only).
- Empty playlist state: one drawn line of copy ("nothing saved yet — go get stung") on an
  opaque patch; no illustration (the empty-state boldness belongs to the search page only).
- Save popover from Phase 2 keeps working; after saving, the header count updates.

## Files you own
```
src/app/playlists/page.tsx, src/app/playlists/[id]/page.tsx
src/components/playlists/**   (PlaylistList, PlaylistRow, PlaylistHeader, ReorderList, PlayAllControl)
src/lib/client/playlists.ts   (fetch helpers + optimistic updates)
```
Shared components from Phase 2 may be extended only additively (new optional props); list
any such change.

## Prove it
typecheck, lint, test, build; headless-Chrome screenshots of both pages at 1280×800 with
three saved tracks (create them through the API with real resolved tracks — The Lovecats
plus two verified candidates via `scripts/verify.ts`); a Node script proving reorder
persists across a reload of `GET /api/playlists/[id]`; the export text output; kill the dev
server.

## Report back
Files, screenshots, the reorder proof, keyboard behaviours, deviations, anything undone.
